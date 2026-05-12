/**
 * POST/GET /api/admin/unstick
 *
 * Phase 1 reliability watchdog (LEARNING #91). Independent of the in-process
 * worker. Scans for stuck shots and resets them, kicks the worker to pick up
 * the queued shots.
 *
 * Designed to be called every 5 min by Cloud Scheduler as a belt-and-suspenders
 * guard against the in-worker watchdog missing a stuck shot (e.g. worker
 * instance is dead — its watchdog isn't running either).
 *
 * Two patterns this catches:
 *   1. Shots in `generating` >STALE_GENERATING_MS — request hung
 *   2. Shots in `pending` >STALE_PENDING_MS — worker never picked them up
 *      (likely because the parent job got removed from active slots)
 *
 * Recovery action per stuck shot:
 *   - Reset status to `queued` (worker will re-pick)
 *   - Set parent job to `generating` and re-enqueue (if not in active slots)
 *   - Clear stale progressStep
 *
 * Disable with env var `EXTERNAL_UNSTICK_ENABLED=0`.
 *
 * Returns a JSON summary of what was reset for monitoring.
 */
import { NextResponse } from 'next/server';
import { shotsCol, jobsCol, enqueueJob, getQueueState } from '@/lib/firestore';
import { FieldValue } from '@google-cloud/firestore';
import { triggerWorker } from '@/lib/worker/trigger';

// Thresholds — generous over typical timings so we don't kill healthy slow shots.
const STALE_GENERATING_MS = 900_000;  // 15 min — beyond any real shot's wall time
const STALE_PENDING_MS = 600_000;     // 10 min in 'pending' without worker pickup

const ENABLED = process.env.EXTERNAL_UNSTICK_ENABLED !== '0';

interface UnstickReport {
  enabled: boolean;
  scanStartedAt: string;
  stuckGenerating: Array<{ shotId: string; shotType: string; jobId: string; ageMinutes: number }>;
  stuckPending: Array<{ shotId: string; shotType: string; jobId: string; ageMinutes: number }>;
  reEnqueuedJobs: string[];
  workerKickStatus: number | null;
}

async function scanAndUnstick(): Promise<UnstickReport> {
  const report: UnstickReport = {
    enabled: ENABLED,
    scanStartedAt: new Date().toISOString(),
    stuckGenerating: [],
    stuckPending: [],
    reEnqueuedJobs: [],
    workerKickStatus: null,
  };

  if (!ENABLED) return report;

  const now = Date.now();

  // Scan for stuck generating + stuck pending shots
  // (Firestore collection-group; status field is indexed via wardrobeCol indexes)
  const [genSnap, pendSnap] = await Promise.all([
    shotsCol.where('status', '==', 'generating').get(),
    shotsCol.where('status', '==', 'pending').get(),
  ]);

  const jobsToEnqueue = new Set<string>();
  const activeSlotJobIds = new Set<string>();
  try {
    const state = await getQueueState();
    for (const slot of state.slots) {
      if (slot) activeSlotJobIds.add(slot.jobId);
    }
  } catch { /* non-blocking — defaults to empty set, all stuck jobs get re-enqueued */ }

  // Bucket 1: stuck generating
  for (const doc of genSnap.docs) {
    const data = doc.data();
    const updatedAt = data.updatedAt as { toDate?: () => Date } | Date | undefined;
    if (!updatedAt) continue; // missing timestamp — refuse to touch
    const ms = typeof (updatedAt as any).toDate === 'function'
      ? (updatedAt as { toDate: () => Date }).toDate().getTime()
      : new Date(updatedAt as Date).getTime();
    if (!ms || isNaN(ms) || ms < 1577836800000) continue; // pre-2020 timestamp = bogus, skip
    const age = now - ms;
    if (age > STALE_GENERATING_MS) {
      const shotId = doc.id;
      const shotType = (data.shotType as string) || '?';
      const jobId = (data.jobId as string) || '';
      report.stuckGenerating.push({ shotId, shotType, jobId, ageMinutes: Math.round(age / 60000) });
      // Reset to pending so the worker re-picks it
      await shotsCol.doc(shotId).update({
        status: 'pending',
        progressStep: 'reset by external watchdog',
        progressPct: 0,
        updatedAt: new Date(),
      });
      if (jobId && !activeSlotJobIds.has(jobId)) jobsToEnqueue.add(jobId);
    }
  }

  // Bucket 2: stuck pending — worker probably never picked it up
  for (const doc of pendSnap.docs) {
    const data = doc.data();
    const updatedAt = data.updatedAt as { toDate?: () => Date } | Date | undefined;
    if (!updatedAt) continue; // missing timestamp — refuse to touch
    const ms = typeof (updatedAt as any).toDate === 'function'
      ? (updatedAt as { toDate: () => Date }).toDate().getTime()
      : new Date(updatedAt as Date).getTime();
    if (!ms || isNaN(ms) || ms < 1577836800000) continue; // pre-2020 timestamp = bogus, skip
    const age = now - ms;
    if (age > STALE_PENDING_MS) {
      const shotId = doc.id;
      const shotType = (data.shotType as string) || '?';
      const jobId = (data.jobId as string) || '';
      report.stuckPending.push({ shotId, shotType, jobId, ageMinutes: Math.round(age / 60000) });
      // Bump to 'queued' so the eligibility check picks it up (treats pending
      // and queued identically — but the touched updatedAt resets the staleness)
      await shotsCol.doc(shotId).update({
        status: 'queued',
        progressStep: '',
        progressPct: 0,
        updatedAt: new Date(),
      });
      if (jobId && !activeSlotJobIds.has(jobId)) jobsToEnqueue.add(jobId);
    }
  }

  // Re-enqueue jobs that had stuck shots but aren't in active slots
  for (const jobId of jobsToEnqueue) {
    try {
      const jobDoc = await jobsCol.doc(jobId).get();
      if (!jobDoc.exists) continue;
      const jobName = (jobDoc.data()?.jobName as string) || jobId;
      await jobsCol.doc(jobId).update({ status: 'generating', updatedAt: FieldValue.serverTimestamp() });
      await enqueueJob(jobId, jobName);
      report.reEnqueuedJobs.push(jobId);
    } catch (e) {
      console.warn(`[Unstick] re-enqueue failed for ${jobId}:`, e);
    }
  }

  // Kick the worker (fire-and-forget — Cloud Run will keep the worker alive
  // past this response if it's processing). 5s max wait — the worker often
  // doesn't respond quickly because it's busy. Returning 200 after a short
  // wait is fine.
  if (report.stuckGenerating.length > 0 || report.stuckPending.length > 0) {
    // triggerWorker branches on WORKER_MODE — inproc fetch or Cloud Run Job
    try {
      await triggerWorker('unstick');
      report.workerKickStatus = 200;
    } catch (e) {
      console.warn(`[Unstick] worker trigger failed:`, e);
    }
  }

  console.log(`[Unstick] gen=${report.stuckGenerating.length} pending=${report.stuckPending.length} re-enq=${report.reEnqueuedJobs.length} kick=${report.workerKickStatus}`);
  return report;
}

export async function GET() {
  // GET for easy curl/manual invocation + Cloud Scheduler default-GET tasks
  const report = await scanAndUnstick();
  return NextResponse.json(report);
}

export async function POST() {
  const report = await scanAndUnstick();
  return NextResponse.json(report);
}
