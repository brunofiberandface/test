/**
 * POST /api/jobs/process-queue — v2 Pro pipeline worker.
 *
 * Processes generation queue with shot dependency chain:
 * M03 → M04 → M01 + M02 (parallel) → M05
 *
 * Each job's shots are generated sequentially within a slot,
 * respecting dependencies. Only one worker runs at a time.
 */
import { NextRequest } from 'next/server';
import {
  getQueueState,
  claimWorker,
  releaseWorker,
  updateWorkerHeartbeat,
  updateSlotProgress,
  incrementRetryPass,
  releaseSlot,
  listShots,
  getJob,
  updateJobStatus,
  shotsCol,
} from '@/lib/firestore';
import { APP_CONFIG } from '@/lib/config';

function getInternalBase(): string {
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

const MAX_RETRY_PASSES = 2;
const SHOT_TIMEOUT_MS = 540_000;  // 9 min per shot (Pro takes 80-130s but with retries)
const SHOT_COOLDOWN_MS = 10_000;  // 10s between shots to reduce 429s
const STALE_THRESHOLD_MS = 720_000;
const IDLE_CHECK_MS = 10_000;
const MAX_IDLE_CYCLES = 30;       // Exit after 5 min idle

// Shot dependency order — M03 first, then M04, then M01+M02, then M05
const SHOT_ORDER = APP_CONFIG.shotOrder; // ['M03', 'M04', 'M01', 'M02', 'M05']

/**
 * Get the next shot to generate for a job, respecting dependency chain.
 * Returns null if all shots are done or if dependencies aren't met.
 */
async function getNextShot(jobId: string): Promise<{ shotId: string; shotType: string } | null> {
  const shots = await listShots(jobId);
  if (shots.length === 0) return null;

  // Build a map of shot status by type
  const shotsByType: Record<string, any> = {};
  for (const s of shots) {
    const st = (s as any).shotType;
    shotsByType[st] = s;
  }

  // Walk through shot order, find the first pending/failed shot whose dependencies are met
  for (const shotType of SHOT_ORDER) {
    const shot = shotsByType[shotType];
    if (!shot) continue;

    const status = (shot as any).status;
    if (status === 'done' || status === 'approved' || status === 'generating') continue;

    // Check if status is pending or failed (eligible for generation)
    if (status !== 'pending' && status !== 'failed' && status !== 'queued') continue;

    // Check dependencies
    const deps = APP_CONFIG.shots[shotType as keyof typeof APP_CONFIG.shots]?.dependsOn || [];
    const depsMet = deps.every((dep: string) => {
      const depShot = shotsByType[dep];
      return depShot && ((depShot as any).status === 'done' || (depShot as any).status === 'approved');
    });

    if (depsMet) {
      return { shotId: (shot as any).shotId || (shot as any).id, shotType };
    }
  }

  return null;
}

/**
 * Check if all shots for a job are terminal (done/approved/failed).
 */
async function isJobComplete(jobId: string): Promise<boolean> {
  const shots = await listShots(jobId);
  return shots.length > 0 && shots.every(
    (s: any) => s.status === 'done' || s.status === 'approved' || s.status === 'failed'
  );
}

/**
 * Process a single slot — generates shots for the assigned job sequentially.
 */
async function processSlot(jobId: string): Promise<void> {
  const job = await getJob(jobId) as any;
  if (!job) {
    console.warn(`[Worker] Job ${jobId} not found — releasing slot`);
    await releaseSlot(jobId);
    return;
  }

  console.log(`[Worker] Processing job ${jobId} (${job.jobName || jobId})`);

  // Reset any stale 'generating' shots (stuck from previous worker crash)
  const shots = await listShots(jobId);
  for (const shot of shots) {
    const s = shot as any;
    if (s.status === 'generating') {
      const age = Date.now() - new Date(s.updatedAt || s.createdAt).getTime();
      if (age > STALE_THRESHOLD_MS) {
        console.log(`[Worker] Resetting stale shot ${s.shotType} (${Math.round(age / 60000)}min old)`);
        await shotsCol.doc(s.shotId || s.id).update({ status: 'pending', updatedAt: new Date() });
      }
    }
  }

  // Process shots in dependency order
  let consecutiveFailures = 0;
  while (true) {
    const next = await getNextShot(jobId);
    if (!next) {
      // No more shots to generate — check if job is complete
      if (await isJobComplete(jobId)) {
        const allShots = await listShots(jobId);
        const allDone = allShots.every((s: any) => s.status === 'done' || s.status === 'approved');
        await updateJobStatus(jobId, allDone ? 'review' : 'failed');
        console.log(`[Worker] Job ${jobId} complete — status: ${allDone ? 'review' : 'failed'}`);
      }
      break;
    }

    console.log(`[Worker] Generating ${next.shotType} for job ${jobId}`);
    await updateSlotProgress(jobId, next.shotType);

    try {
      // Call the generate endpoint internally
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SHOT_TIMEOUT_MS);

      const res = await fetch(`${getInternalBase()}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shotId: next.shotId,
          jobId,
          shotType: next.shotType,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        console.error(`[Worker] ${next.shotType} failed: ${res.status} — ${errorText.substring(0, 200)}`);
        consecutiveFailures++;

        // Retry once on 5xx
        if (res.status >= 500 && consecutiveFailures <= 1) {
          console.log(`[Worker] Retrying ${next.shotType} after 5xx...`);
          await shotsCol.doc(next.shotId).update({ status: 'pending', updatedAt: new Date() });
          await new Promise(r => setTimeout(r, SHOT_COOLDOWN_MS));
          continue;
        }
      } else {
        consecutiveFailures = 0;
        console.log(`[Worker] ${next.shotType} completed successfully`);
      }
    } catch (err) {
      const msg = (err as Error).message || '';
      console.error(`[Worker] ${next.shotType} error: ${msg.substring(0, 200)}`);
      consecutiveFailures++;

      if (msg.includes('abort')) {
        console.error(`[Worker] ${next.shotType} timed out after ${SHOT_TIMEOUT_MS / 1000}s`);
      }
    }

    await updateWorkerHeartbeat();

    // Cooldown between shots
    await new Promise(r => setTimeout(r, SHOT_COOLDOWN_MS));
  }

  // Release slot, pull next job from queue
  const next = await releaseSlot(jobId);
  if (next) {
    console.log(`[Worker] Next job from queue: ${next.jobId}`);
  }
}

export async function POST(req: NextRequest) {
  // Claim worker role
  const claimed = await claimWorker();
  if (!claimed) {
    return new Response(JSON.stringify({ message: 'Another worker is active' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log('[Worker] Claimed worker role — starting loop');

  try {
    let idleCycles = 0;

    while (idleCycles < MAX_IDLE_CYCLES) {
      const state = await getQueueState();
      const activeSlots = state.slots.filter(s => s !== null);

      if (activeSlots.length === 0) {
        idleCycles++;
        if (idleCycles >= MAX_IDLE_CYCLES) {
          console.log('[Worker] Idle timeout — exiting');
          break;
        }
        await new Promise(r => setTimeout(r, IDLE_CHECK_MS));
        continue;
      }

      idleCycles = 0;

      // Process active slots sequentially (one at a time to avoid race conditions)
      for (const slot of activeSlots) {
        if (slot) {
          await processSlot(slot.jobId);
          await updateWorkerHeartbeat();
        }
      }

      // Brief pause before checking for more work
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) {
    console.error('[Worker] Fatal error:', err);
  } finally {
    await releaseWorker();
    console.log('[Worker] Released worker role');
  }

  return new Response(JSON.stringify({ message: 'Worker finished' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET handler for Cloud Scheduler pings
export async function GET(req: NextRequest) {
  return POST(req);
}
