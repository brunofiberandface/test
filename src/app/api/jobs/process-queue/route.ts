/**
 * POST /api/jobs/process-queue — v3 parallel pipeline worker.
 *
 * Processes generation queue with shot dependency chain:
 * M03 → M04 → M01 + M02 (parallel) → M05
 *
 * Each job's shots are generated sequentially within a slot,
 * respecting dependencies. Only one worker runs at a time.
 *
 * Parallel generation: N API keys = N jobs in parallel.
 * Each job checks out a key from the pool. When all keys are
 * in use, remaining jobs wait in queue until a key frees up.
 * Uses Generative Language API (per-key rate limits) instead
 * of Vertex AI (per-project rate limits).
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
const SHOT_COOLDOWN_MS = 5_000;   // 5s between shots (reduced — each key has its own rate limit)
const STALE_THRESHOLD_MS = 720_000;
const IDLE_CHECK_MS = 10_000;
const MAX_IDLE_CYCLES = 30;       // Exit after 5 min idle

// Shot dependency order — M03 first, then M04, then M01+M02, then M05
const SHOT_ORDER = APP_CONFIG.shotOrder; // ['M03', 'M04', 'M01', 'M02', 'M05']

// ── API Key Pool with checkout/checkin ──
// Each key is an independent rate limit pool on the Generative Language API.
// A job checks out a key when it starts, returns it when done.
// If all keys are in use, remaining jobs wait in queue.
const KEY_POOL = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
].filter(Boolean) as string[];

// In-memory key tracking (single worker process — safe for in-memory)
const checkedOutKeys = new Map<string, string>(); // jobId → apiKey

function checkoutKey(jobId: string): string | null {
  // Already has a key?
  const existing = checkedOutKeys.get(jobId);
  if (existing) return existing;
  // Find first available key
  const inUse = new Set(checkedOutKeys.values());
  const available = KEY_POOL.find(k => !inUse.has(k));
  if (!available) return null;
  checkedOutKeys.set(jobId, available);
  const keyHint = `...${available.slice(-4)}`;
  console.log(`[Worker] Key ${keyHint} checked out → job ${jobId} (${checkedOutKeys.size}/${KEY_POOL.length} in use)`);
  return available;
}

function checkinKey(jobId: string): void {
  const key = checkedOutKeys.get(jobId);
  if (key) {
    checkedOutKeys.delete(jobId);
    const keyHint = `...${key.slice(-4)}`;
    console.log(`[Worker] Key ${keyHint} returned ← job ${jobId} (${checkedOutKeys.size}/${KEY_POOL.length} in use)`);
  }
}

/**
 * Get the next shot to generate for a job, respecting dependency chain.
 * Returns null if all shots are done or if dependencies aren't met.
 */
async function getNextShot(jobId: string): Promise<{ shotId: string; shotType: string; useDressedBase?: boolean } | null> {
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

    // Only 'pending' and 'queued' are eligible for generation.
    // 'failed' is terminal — the worker's 5xx retry block re-sets to 'pending'
    // for its one-shot retry, but once a shot is marked 'failed' by generate/route.ts
    // we must NOT re-pick it, or 4xx errors (e.g. BytePlus 400 on oversized ref)
    // will cause an infinite retry loop.
    if (status !== 'pending' && status !== 'queued') continue;

    // Check dependencies
    const deps = APP_CONFIG.shots[shotType as keyof typeof APP_CONFIG.shots]?.dependsOn || [];
    const depsMet = deps.every((dep: string) => {
      const depShot = shotsByType[dep];
      return depShot && ((depShot as any).status === 'done' || (depShot as any).status === 'approved');
    });

    if (depsMet) {
      return {
        shotId: (shot as any).shotId || (shot as any).id,
        shotType,
        ...((shot as any).useDressedBase ? { useDressedBase: true } : {}),
      };
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
async function processSlot(jobId: string, apiKey?: string): Promise<void> {
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
          apiKey,
          ...(next.useDressedBase ? { useDressedBase: true } : {}),
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

  // Return API key to pool, release slot, pull next job from queue
  checkinKey(jobId);
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

  console.log(`[Worker] Claimed worker role — ${KEY_POOL.length} API key(s) → max ${KEY_POOL.length} parallel job(s)`);

  try {
    let idleCycles = 0;
    const runningJobs = new Map<string, Promise<void>>();

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

      // Try to check out a key for each active slot.
      // Jobs that get a key run in parallel. Jobs without a key wait.
      const jobsWithKeys: { jobId: string; apiKey: string }[] = [];
      const waitingJobs: string[] = [];

      for (const slot of activeSlots) {
        if (!slot) continue;
        const key = checkoutKey(slot.jobId);
        if (key) {
          jobsWithKeys.push({ jobId: slot.jobId, apiKey: key });
        } else {
          waitingJobs.push(slot.jobId);
        }
      }

      if (waitingJobs.length > 0) {
        console.log(`[Worker] ${jobsWithKeys.length} job(s) running, ${waitingJobs.length} waiting for a free key`);
      }

      if (jobsWithKeys.length > 0) {
        // Launch NEW jobs (not already running) as background promises.
        // Already-running jobs just get re-checked-out (idempotent) — skip them.
        for (const { jobId, apiKey } of jobsWithKeys) {
          if (!runningJobs.has(jobId)) {
            console.log(`[Worker] Launching job ${jobId} in background`);
            const p = processSlot(jobId, apiKey)
              .then(() => updateWorkerHeartbeat())
              .finally(() => runningJobs.delete(jobId));
            runningJobs.set(jobId, p);
          }
        }
      }

      // Re-check for new jobs every 5s, even while existing jobs are running.
      // This is what enables parallel: the loop discovers new queued jobs
      // and launches them with separate API keys while others are in-flight.
      if (runningJobs.size > 0) {
        await Promise.race([
          ...runningJobs.values(),
          new Promise(r => setTimeout(r, 5000)),
        ]).catch(() => {});
      } else {
        await new Promise(r => setTimeout(r, IDLE_CHECK_MS));
      }
    }
  } catch (err) {
    console.error('[Worker] Fatal error:', err);
  } finally {
    // Return all checked-out keys on exit
    for (const jobId of [...checkedOutKeys.keys()]) {
      checkinKey(jobId);
    }
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
