import { NextRequest } from 'next/server';
import {
  getQueueState,
  claimWorker,
  releaseWorker,
  updateWorkerHeartbeat,
  updateSlotProgress,
  incrementRetryPass,
  releaseSlot,
  enqueueJob,
  listShots,
  getJob,
  jobsCol,
  shotsCol,
} from '@/lib/firestore';

/**
 * POST /api/jobs/process-queue
 *
 * Server-side worker that processes the generation queue.
 * Runs as a long-lived request — generates shots across 2 parallel slots
 * until the queue is empty, then exits.
 *
 * Each slot processes ONE job at a time. Each job's shots are generated
 * sequentially within that slot — no parallel shot generation within a job.
 * This avoids race conditions between shots in the same job.
 *
 * Triggered by:
 *   1. Cloud Scheduler (every 3 min — safety net)
 *   2. Frontend "Start Generation" button
 *   3. Enqueueing a new job
 *
 * Only one worker runs at a time (Firestore-based claim with heartbeat).
 * If the worker dies (container recycle), the next scheduler ping restarts it.
 */

function getInternalBase(): string {
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

const MAX_RETRY_PASSES = 2;       // up to 2 retry passes for failed shots
const SHOT_TIMEOUT_MS = 540_000;  // 9 min per shot
const SHOT_COOLDOWN_MS = 10_000;  // 10s cooldown between shots to reduce 429s
const STALE_THRESHOLD_MS = 720_000; // 12 min — must be > SHOT_TIMEOUT_MS to avoid resetting active shots
const IDLE_CHECK_MS = 10_000;     // Check for new work every 10s when idle
const MAX_IDLE_CYCLES = 30;       // Exit after 5 min of no work (30 × 10s)

const shotOrder = ['M03', 'M01', 'M02', 'M04', 'M05'];

interface ShotResult {
  shotLabel: string;
  ok: boolean;
  elapsed: number;
  error?: string;
}

/**
 * Generate a single shot by calling /api/generate internally.
 * Returns success/failure — does NOT throw.
 */
async function generateOneShot(
  jobId: string,
  jobData: Record<string, unknown>,
  shotData: Record<string, unknown>,
  slotIdx: number,
): Promise<ShotResult> {
  const shotLabel = `${shotData.shotType}_${shotData.variant || 'A'}`;
  const shotId = (shotData.shotId || shotData.id) as string;
  const startTime = Date.now();

  console.log(`[Worker][Slot${slotIdx}] Generating ${shotLabel} (${shotId}) for job ${jobData.jobName || jobId}`);

  // Update slot progress in queue state (for UI)
  await updateSlotProgress(jobId, shotLabel);

  // Claim the shot atomically — mark it as generating with our slot ID
  // This prevents the other slot from touching it
  try {
    await shotsCol.doc(shotId).update({
      status: 'generating',
      claimedBySlot: slotIdx,
      updatedAt: new Date(),
    });
  } catch {
    console.warn(`[Worker][Slot${slotIdx}] Could not claim shot ${shotLabel} — skipping`);
    return { shotLabel, ok: false, elapsed: 0, error: 'Could not claim shot' };
  }

  const internalBase = getInternalBase();

  // Attempt generation with 1 immediate retry on 5xx
  for (let attempt = 0; attempt <= 1; attempt++) {
    if (attempt > 0) {
      console.log(`[Worker][Slot${slotIdx}] Retrying ${shotLabel} (attempt ${attempt + 1})...`);
      await new Promise(r => setTimeout(r, 30_000));
    }

    try {
      const abortCtrl = new AbortController();
      const timeoutId = setTimeout(() => abortCtrl.abort(), SHOT_TIMEOUT_MS);

      const res = await fetch(`${internalBase}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortCtrl.signal,
        body: JSON.stringify({
          shotId,
          jobId,
          designNumber: jobData.designNumber,
          modelId: shotData.modelId,
          shotType: shotData.shotType,
          variant: shotData.variant || 'A',
          prompt: shotData.prompt || '',
          flatFrontUrl: jobData.flatFrontUrl || jobData.flatImageUrl || '',
          flatBackUrl: jobData.flatBackUrl || '',
          image360Urls: jobData.image360Urls || [],
          garmentCategory: jobData.garmentCategory,
          version: shotData.version || 1,
        }),
      });
      clearTimeout(timeoutId);

      const elapsed = Math.round((Date.now() - startTime) / 1000);

      if (res.ok) {
        console.log(`[Worker][Slot${slotIdx}] ✓ ${shotLabel} done (${elapsed}s)`);
        // Clear slot claim on success
        try { await shotsCol.doc(shotId).update({ claimedBySlot: null }); } catch { /* */ }
        return { shotLabel, ok: true, elapsed };
      }

      let errMsg = `HTTP ${res.status}`;
      try {
        const errData = await res.json();
        errMsg = errData.error || errMsg;
      } catch { /* */ }

      // Don't retry 4xx — it's a client error (bad prompt, missing refs, etc.)
      if (res.status >= 400 && res.status < 500) {
        console.error(`[Worker][Slot${slotIdx}] ✗ ${shotLabel} failed (${elapsed}s, 4xx): ${errMsg}`);
        try { await shotsCol.doc(shotId).update({ claimedBySlot: null }); } catch { /* */ }
        return { shotLabel, ok: false, elapsed, error: errMsg };
      }

      // 5xx — retry once
      if (attempt === 1) {
        console.error(`[Worker][Slot${slotIdx}] ✗ ${shotLabel} failed after retry (${elapsed}s): ${errMsg}`);
        try { await shotsCol.doc(shotId).update({ claimedBySlot: null }); } catch { /* */ }
        return { shotLabel, ok: false, elapsed, error: errMsg };
      }
    } catch (e) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (attempt === 1) {
        console.error(`[Worker][Slot${slotIdx}] ✗ ${shotLabel} exception after retry (${elapsed}s): ${e}`);
        try { await shotsCol.doc(shotId).update({ claimedBySlot: null }); } catch { /* */ }
        return { shotLabel, ok: false, elapsed, error: String(e) };
      }
      // Will retry
    }
  }

  // Should not reach here, but safety net
  try { await shotsCol.doc((shotData.shotId || shotData.id) as string).update({ claimedBySlot: null }); } catch { /* */ }
  return { shotLabel, ok: false, elapsed: Math.round((Date.now() - startTime) / 1000), error: 'Unknown error' };
}

/**
 * Main worker loop: fills slots, generates shots, loops until queue is empty.
 */
async function workerLoop(): Promise<string[]> {
  const actions: string[] = [];
  let idleCycles = 0;

  // ── ORPHAN RECOVERY: find "generating" jobs not in any slot and re-enqueue them ──
  try {
    const initState = await getQueueState();
    const slottedJobIds = new Set(initState.slots.filter(s => s !== null).map(s => s!.jobId));
    const queuedJobIds = new Set(initState.queue.map(e => e.jobId));
    const orphanSnap = await jobsCol.where('status', '==', 'generating').limit(10).get();
    for (const doc of orphanSnap.docs) {
      if (!slottedJobIds.has(doc.id) && !queuedJobIds.has(doc.id)) {
        const jData = doc.data();
        const jName = (jData.jobName || jData.designNumber || doc.id) as string;
        console.log(`[Worker] Orphan detected: "${jName}" (${doc.id}) — re-enqueueing`);
        await enqueueJob(doc.id, jName);
        actions.push(`Recovered orphan job "${jName}"`);
      }
    }
  } catch (e) {
    console.warn('[Worker] Orphan recovery failed:', e);
  }

  while (idleCycles < MAX_IDLE_CYCLES) {
    let state = await getQueueState();

    // ── FILL EMPTY SLOTS from queue before processing ──
    for (let i = 0; i < state.slots.length; i++) {
      if (state.slots[i] === null && state.queue.length > 0) {
        const next = state.queue[0];
        const result = await enqueueJob(next.jobId, next.jobName);
        if (result.slot !== null) {
          console.log(`[Worker] Filled slot ${result.slot} with "${next.jobName}"`);
          actions.push(`Filled slot ${result.slot} with "${next.jobName}"`);
        }
        // Re-read state after mutation
        state = await getQueueState();
      }
    }

    let didWork = false;

    // Process occupied slots — PARALLEL when different jobs, sequential same-job safety
    const slotTasks: Array<{ slotIdx: number; slot: NonNullable<typeof state.slots[0]> }> = [];
    for (let i = 0; i < state.slots.length; i++) {
      const slot = state.slots[i];
      if (slot) slotTasks.push({ slotIdx: i, slot });
    }

    const processSlot = async (slotIdx: number, slot: NonNullable<typeof state.slots[0]>) => {
      // Guard: check if job still exists (user may have deleted it)
      const jobDoc = await getJob(slot.jobId);
      if (!jobDoc) {
        console.log(`[Worker] Job "${slot.jobName}" (${slot.jobId}) deleted — releasing slot ${slotIdx}`);
        actions.push(`Released slot ${slotIdx} — job "${slot.jobName}" was deleted`);
        await releaseSlot(slot.jobId);
        return true;
      }

      // Check if this job still needs work
      const shots = await listShots(slot.jobId);
      const needsWork = shots.some((s: Record<string, unknown>) =>
        s.status === 'queued' || s.status === 'failed'
      );

      if (!needsWork) {
        // Check if any shots are still generating (being processed right now)
        const stillGenerating = shots.some((s: Record<string, unknown>) => s.status === 'generating');
        if (stillGenerating) {
          return true; // still working
        }

        // Job is done — set status and release slot
        try {
          await jobsCol.doc(slot.jobId).update({
            status: 'review',
            updatedAt: new Date(),
            completedAt: new Date(),
          });
        } catch (e) {
          console.warn(`[Worker] Could not update job ${slot.jobId} status (may be deleted):`, e);
        }
        actions.push(`Job "${slot.jobName}" completed (slot ${slotIdx})`);
        await releaseSlot(slot.jobId);
        console.log(`[Worker] Released slot ${slotIdx} — ${slot.jobName} done`);
        return true;
      }

      // Job needs work — generate next shot
      await processOneSlot(slot.jobId, slot, slotIdx, actions);
      return true;
    };

    if (slotTasks.length > 0) {
      didWork = true;
      // Run slots in parallel — each slot has a different job, so no race conditions
      await Promise.all(slotTasks.map(({ slotIdx, slot }) => processSlot(slotIdx, slot)));
    }

    await updateWorkerHeartbeat();

    // Check if ANY slots are occupied or queue has items
    const freshState = await getQueueState();
    const anyWork = freshState.slots.some(s => s !== null) || freshState.queue.length > 0;

    if (!anyWork && !didWork) {
      idleCycles++;
      if (idleCycles >= MAX_IDLE_CYCLES) break;
      await new Promise(r => setTimeout(r, IDLE_CHECK_MS));
    } else {
      idleCycles = 0;
    }
  }

  return actions;
}

/**
 * Process one shot from a slot's job. Called sequentially per slot.
 * Each call generates exactly one shot, then returns.
 */
async function processOneSlot(
  jobId: string,
  slot: { jobId: string; jobName: string; retryPass: number },
  slotIdx: number,
  actions: string[],
): Promise<void> {
  const job = await getJob(jobId);
  if (!job) {
    actions.push(`Job ${jobId} not found — releasing slot ${slotIdx}`);
    await releaseSlot(jobId);
    return;
  }

  const jobData = job as Record<string, unknown>;
  const jobName = (jobData.jobName || jobData.designNumber || jobId) as string;

  // Update job status
  try {
    await jobsCol.doc(jobId).update({ status: 'generating', updatedAt: new Date() });
  } catch { /* */ }

  // Reset shots stuck in "generating" from a DEAD worker (>12 min old)
  // Threshold is intentionally > SHOT_TIMEOUT_MS (9 min) to avoid resetting active shots
  const shots = await listShots(jobId);
  for (const shot of shots) {
    const s = shot as Record<string, unknown>;
    if (s.status === 'generating') {
      const updatedAt = s.updatedAt ? new Date(s.updatedAt as string).getTime() : 0;
      if (Date.now() - updatedAt > STALE_THRESHOLD_MS) {
        console.log(`[Worker][Slot${slotIdx}] Resetting stale shot ${s.shotType}_${s.variant || 'A'} (>${STALE_THRESHOLD_MS / 60000}min old)`);
        await shotsCol.doc(s.id as string).update({
          status: 'queued',
          updatedAt: new Date(),
          error: null,
          claimedBySlot: null,
        });
      }
    }
  }

  // Find all queued shots (not claimed by another slot)
  const queuedShots = shots
    .filter((s: Record<string, unknown>) =>
      s.status === 'queued' && (s.claimedBySlot === null || s.claimedBySlot === undefined)
    )
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const aIdx = shotOrder.indexOf(a.shotType as string);
      const bIdx = shotOrder.indexOf(b.shotType as string);
      return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
    }) as Record<string, unknown>[];

  if (queuedShots.length > 0) {
    // STRICT SEQUENTIAL: Generate exactly 1 shot at a time within a job.
    // M03 is the front garment anchor reused by later shots — it MUST complete
    // before M01/M02/M04/M05 start. Parallelism is only safe between jobs, not within.
    const shot = queuedShots[0];
    const result = await generateOneShot(jobId, jobData, shot, slotIdx);
    actions.push(`${result.ok ? '✓' : '✗'} ${result.shotLabel} (${result.elapsed}s) — ${jobName}`);
    // Cooldown between shots to reduce Vertex AI 429 rate-limit hits
    await new Promise(r => setTimeout(r, SHOT_COOLDOWN_MS));
    return;
  }

  // No queued shots — check if there are failed shots to retry
  const failedShots = shots.filter((s: Record<string, unknown>) => s.status === 'failed');

  if (failedShots.length > 0 && slot.retryPass < MAX_RETRY_PASSES) {
    // Start retry pass
    const newPass = await incrementRetryPass(jobId);
    console.log(`[Worker][Slot${slotIdx}] Job "${jobName}" — retry pass ${newPass} for ${failedShots.length} failed shots`);

    // Reset failed shots to queued
    for (const shot of failedShots) {
      const s = shot as Record<string, unknown>;
      await shotsCol.doc(s.id as string).update({
        status: 'queued',
        updatedAt: new Date(),
        error: null,
        claimedBySlot: null,
      });
    }

    // Wait 30s before retry to let rate limits cool
    await new Promise(r => setTimeout(r, 30_000));

    // Pick first retry shot
    const freshShots = await listShots(jobId);
    const retryShot = freshShots
      .filter((s: Record<string, unknown>) => s.status === 'queued')
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
        const aIdx = shotOrder.indexOf(a.shotType as string);
        const bIdx = shotOrder.indexOf(b.shotType as string);
        return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
      })[0] as Record<string, unknown> | undefined;

    if (retryShot) {
      const result = await generateOneShot(jobId, jobData, retryShot, slotIdx);
      actions.push(`${result.ok ? '✓' : '✗'} ${result.shotLabel} retry (${result.elapsed}s) — ${jobName}`);
      await new Promise(r => setTimeout(r, SHOT_COOLDOWN_MS));
    }
    return;
  }

  // No more work for this job — it will be picked up as "done" in the next loop iteration
}

// ── HTTP Handlers ──

export async function POST(req: NextRequest) {
  try {
    // Try to claim worker role
    const claimed = await claimWorker();

    if (!claimed) {
      // Another worker is already running
      return new Response(JSON.stringify({
        ok: true,
        status: 'already_running',
        message: 'Worker is already active',
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    console.log('[Worker] Claimed worker role — starting loop');

    // Run the worker loop (long-lived — may run for many minutes)
    let actions: string[];
    try {
      actions = await workerLoop();
    } finally {
      await releaseWorker();
      console.log('[Worker] Released worker role — loop exited');
    }

    return new Response(JSON.stringify({
      ok: true,
      status: 'completed',
      actions,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[Worker] Fatal error:', err);
    await releaseWorker();
    return new Response(JSON.stringify({
      ok: false,
      error: String(err),
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// GET handler for Cloud Scheduler (which sends GET by default)
export async function GET(req: NextRequest) {
  // Check if there's any work to do before claiming
  const state = await getQueueState();
  const hasWork = state.slots.some(s => s !== null) || state.queue.length > 0;

  if (!hasWork) {
    return new Response(JSON.stringify({
      ok: true,
      status: 'idle',
      message: 'No jobs in queue',
      slots: state.slots,
      queueLength: state.queue.length,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // There's work — delegate to POST handler
  return POST(req);
}
