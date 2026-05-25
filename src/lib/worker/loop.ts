/**
 * Worker loop — shared between two execution environments:
 *   1. In-proc inside the Next.js HTTP service (current behavior, `WORKER_MODE=inproc`)
 *      Invoked by `/api/jobs/process-queue` POST. Runs until idle, then exits the
 *      handler. Same Cloud Run container as the HTTP routes — subject to
 *      CPU-throttling-during-await (LEARNING #78).
 *   2. Cloud Run Job (Phase 2, `WORKER_MODE=job`). Invoked by `cloud-run-job-worker/`'s
 *      entrypoint. Runs in its own always-on-CPU container. Calls back into the
 *      main service's `/api/generate` over HTTPS via INTERNAL_BASE_URL env var.
 *
 * The loop body is identical in both. The only difference is the base URL used
 * for the per-shot generate call:
 *   - inproc → http://localhost:${PORT} (loopback inside the same container)
 *   - job    → INTERNAL_BASE_URL (public service URL of the gstar-ai-studio service)
 *
 * Phase 1 reliability guards (LEARNING #91) live here too:
 *   - resetStaleInflight: scans runningShots Map for entries stuck past
 *     STALE_INFLIGHT_THRESHOLD_MS — defensive in case AbortController fails.
 *   - resetStaleShots: scans Firestore for `generating` shots NOT in our
 *     runningShots — defensive against PREVIOUS-worker crashes leaving state.
 */
import {
  getQueueState,
  claimWorker,
  releaseWorker,
  updateWorkerHeartbeat,
  updateSlotProgress,
  releaseSlot,
  listShots,
  updateJobStatus,
  shotsCol,
  jobsCol,
  enqueueJob,
} from '@/lib/firestore';
import { FieldValue } from '@google-cloud/firestore';
import { APP_CONFIG } from '@/lib/config';
import { isMatrixCellComplete, VIEWS } from '@/lib/qa/shoe-matrix';
import { qaShoeMatrixCol } from '@/lib/firestore';

// ── Constants ──
const SHOT_TIMEOUT_MS = 540_000;  // 9 min per shot
const STALE_THRESHOLD_MS = 720_000;
const IDLE_CHECK_MS = 10_000;
const MAX_IDLE_CYCLES = 30;       // Exit after 5 min idle

// Phase 1 watchdog threshold for in-flight stuck entries. Generous over real
// shot durations (80-180s typical) so we don't kill healthy slow shots.
const STALE_INFLIGHT_THRESHOLD_MS = 720_000;
const STALE_INFLIGHT_WATCHDOG_ENABLED = process.env.WORKER_STALE_INFLIGHT_WATCHDOG !== '0';

const SHOT_ORDER = APP_CONFIG.shotOrder; // ['M03', 'M04', 'M01', 'M02', 'M05']

/**
 * Resolve the base URL for the `/api/generate` callback.
 *
 * In-proc mode: localhost loopback inside the Cloud Run service container.
 * Cloud Run Job mode: must be the public service URL, set via INTERNAL_BASE_URL
 * env var. The Job container can't reach localhost — it must HTTPS-call the
 * service.
 */
function getInternalBase(): string {
  if (process.env.INTERNAL_BASE_URL) return process.env.INTERNAL_BASE_URL;
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

// ── Key Pools ──
function loadKeyPool(prefix: string): string[] {
  const keys: string[] = [];
  const first = process.env[prefix];
  if (first) keys.push(first);
  for (let i = 2; i <= 20; i++) {
    const k = process.env[`${prefix}_${i}`];
    if (k) keys.push(k);
  }
  return keys;
}

const KEY_POOL = loadKeyPool('GEMINI_API_KEY');
const BYTEPLUS_KEY_POOL = loadKeyPool('BYTEPLUS_API_KEY');

const checkedOutKeys = new Map<string, string>();
const checkedOutBytePlusKeys = new Map<string, string>();

function checkoutKeyForShot(shotId: string): string | null {
  const existing = checkedOutKeys.get(shotId);
  if (existing) return existing;
  const inUse = new Set(checkedOutKeys.values());
  const available = KEY_POOL.find(k => !inUse.has(k));
  if (!available) return null;
  checkedOutKeys.set(shotId, available);
  const keyHint = `...${available.slice(-4)}`;
  console.log(`[Worker] Gemini ${keyHint} → shot ${shotId.substring(0,8)} (${checkedOutKeys.size}/${KEY_POOL.length})`);
  return available;
}

function checkinKeyForShot(shotId: string): void {
  const key = checkedOutKeys.get(shotId);
  if (key) {
    checkedOutKeys.delete(shotId);
    const keyHint = `...${key.slice(-4)}`;
    console.log(`[Worker] Gemini ${keyHint} ← shot ${shotId.substring(0,8)} (${checkedOutKeys.size}/${KEY_POOL.length})`);
  }
}

function checkoutBytePlusKeyForShot(shotId: string): string | null {
  const existing = checkedOutBytePlusKeys.get(shotId);
  if (existing) return existing;
  const inUse = new Set(checkedOutBytePlusKeys.values());
  const available = BYTEPLUS_KEY_POOL.find(k => !inUse.has(k));
  if (!available) return null;
  checkedOutBytePlusKeys.set(shotId, available);
  const keyHint = `...${available.slice(-4)}`;
  console.log(`[Worker] BytePlus ${keyHint} → shot ${shotId.substring(0,8)} (${checkedOutBytePlusKeys.size}/${BYTEPLUS_KEY_POOL.length})`);
  return available;
}

function checkinBytePlusKeyForShot(shotId: string): void {
  const key = checkedOutBytePlusKeys.get(shotId);
  if (key) {
    checkedOutBytePlusKeys.delete(shotId);
    const keyHint = `...${key.slice(-4)}`;
    console.log(`[Worker] BytePlus ${keyHint} ← shot ${shotId.substring(0,8)} (${checkedOutBytePlusKeys.size}/${BYTEPLUS_KEY_POOL.length})`);
  }
}

// ── Types ──
interface EligibleShot {
  shotId: string;
  jobId: string;
  shotType: string;
  version: number;
  useDressedBase?: boolean;
}

// ── Eligibility ──
async function getEligibleShotsForJob(jobId: string): Promise<EligibleShot[]> {
  const shots = await listShots(jobId);
  if (shots.length === 0) return [];

  const shotsByType: Record<string, any> = {};
  for (const s of shots) {
    const st = (s as any).shotType;
    shotsByType[st] = s;
  }

  const eligible: EligibleShot[] = [];
  for (const shotType of SHOT_ORDER) {
    const shot = shotsByType[shotType];
    if (!shot) continue;

    const status = (shot as any).status;
    if (status === 'done' || status === 'approved' || status === 'generating') continue;
    if (status !== 'pending' && status !== 'queued') continue;

    const deps = APP_CONFIG.shots[shotType as keyof typeof APP_CONFIG.shots]?.dependsOn || [];
    const depsMet = deps.every((dep: string) => {
      const depShot = shotsByType[dep];
      return depShot && ((depShot as any).status === 'done' || (depShot as any).status === 'approved');
    });
    if (!depsMet) continue;

    eligible.push({
      shotId: (shot as any).shotId || (shot as any).id,
      jobId,
      shotType,
      version: (shot as any).version || 1,
      ...((shot as any).useDressedBase ? { useDressedBase: true } : {}),
    });
  }
  return eligible;
}

async function isJobComplete(jobId: string): Promise<boolean> {
  const shots = await listShots(jobId);
  // Filter out retired shotTypes (M03/M04) — legacy jobs may have shot docs
  // for them but the worker never dispatches those types. Counting them as
  // outstanding work would block job completion forever.
  const activeShotTypes = new Set<string>(APP_CONFIG.shotTypes);
  const activeShots = shots.filter((s: any) => activeShotTypes.has(s.shotType));
  return activeShots.length > 0 && activeShots.every(
    (s: any) => s.status === 'done' || s.status === 'approved' || s.status === 'failed'
  );
}

// ── Watchdogs ──
async function resetStaleInflight(
  runningShots: Map<string, Promise<void>>,
): Promise<number> {
  if (!STALE_INFLIGHT_WATCHDOG_ENABLED) return 0;
  if (runningShots.size === 0) return 0;
  const now = Date.now();
  let dropped = 0;
  for (const shotId of Array.from(runningShots.keys())) {
    try {
      const doc = await shotsCol.doc(shotId).get();
      if (!doc.exists) {
        console.warn(`[Worker] Stale-inflight watchdog: shot ${shotId} doc not found, dropping from map`);
        checkinKeyForShot(shotId);
        checkinBytePlusKeyForShot(shotId);
        runningShots.delete(shotId);
        dropped++;
        continue;
      }
      const data = doc.data()!;
      const updatedAt = (data.updatedAt as { toDate?: () => Date } | Date | undefined);
      const updatedAtMs = updatedAt
        ? (typeof (updatedAt as any).toDate === 'function'
          ? (updatedAt as { toDate: () => Date }).toDate().getTime()
          : new Date(updatedAt as Date).getTime())
        : now;
      const age = now - updatedAtMs;
      if (age > STALE_INFLIGHT_THRESHOLD_MS) {
        const shotType = (data.shotType as string) || '?';
        const status = (data.status as string) || '?';
        console.warn(`[Worker] STALE-INFLIGHT watchdog: ${shotType} ${shotId.substring(0,8)} stuck ${Math.round(age/60000)}min (status=${status}). Dropping from runningShots, resetting to pending.`);
        await shotsCol.doc(shotId).update({
          status: 'pending',
          progressStep: 'reset by watchdog (stuck >' + Math.round(age/60000) + 'min)',
          progressPct: 0,
          updatedAt: new Date(),
        });
        checkinKeyForShot(shotId);
        checkinBytePlusKeyForShot(shotId);
        runningShots.delete(shotId);
        dropped++;
      }
    } catch (e) {
      console.warn(`[Worker] Stale-inflight watchdog: error checking shot ${shotId}:`, e);
    }
  }
  return dropped;
}

async function resetStaleShots(jobId: string, runningShotIds: Set<string>): Promise<void> {
  const shots = await listShots(jobId);
  for (const shot of shots) {
    const s = shot as any;
    const sid = s.shotId || s.id;
    if (s.status === 'generating' && !runningShotIds.has(sid)) {
      const age = Date.now() - new Date(s.updatedAt || s.createdAt).getTime();
      if (age > STALE_THRESHOLD_MS) {
        console.log(`[Worker] Resetting stale shot ${s.shotType} (${Math.round(age / 60000)}min old)`);
        await shotsCol.doc(sid).update({ status: 'pending', updatedAt: new Date() });
      }
    }
  }
}

// ── Per-shot processing ──
async function processShot(shot: EligibleShot, geminiKey: string, bytePlusKey: string): Promise<void> {
  console.log(`[Worker] Generating ${shot.shotType} v${shot.version} for ${shot.jobId.substring(0,8)}`);
  await updateSlotProgress(shot.jobId, shot.shotType);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHOT_TIMEOUT_MS);

  try {
    const res = await fetch(`${getInternalBase()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shotId: shot.shotId,
        jobId: shot.jobId,
        shotType: shot.shotType,
        version: shot.version,
        apiKey: geminiKey,
        seedreamApiKey: bytePlusKey,
        ...(shot.useDressedBase ? { useDressedBase: true } : {}),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      console.error(`[Worker] ${shot.shotType} (${shot.jobId.substring(0,8)}) failed: ${res.status} — ${errorText.substring(0, 200)}`);
      if (res.status >= 500) {
        // 2026-05-12: detect PERMANENT errors (data validation — missing model
        // card, missing fit-model refs, missing wardrobe items, etc.). These
        // throw inside generate/route.ts before any external API call. The
        // catch block re-throws as 500 which previously triggered an infinite
        // retry loop (status reset to 'pending' → re-pickup → same fail).
        //
        // Trigger case: job B7MCDg2G + model F8 (F8 had no referenceImageUrl).
        // M03/M04/M06 spun 3+ retries per second for ~30+ min, burning Cloud
        // Run CPU + key checkouts. See BUGS_AND_FIXES "May 12, 2026 — F8
        // infinite retry loop" + LEARNING note.
        //
        // Match pattern is conservative — only well-known permanent strings.
        // On match, mark 'failed' (terminal, won't be re-picked). On no
        // match, fall through to 'pending' (transient — Seedream rate limit,
        // network, etc.).
        const PERMANENT_ERROR_PATTERNS = /reference image not found|no model card for|model front ref missing|model card missing|model card not found|fitModels\.(front|back) missing|fitModels missing|no bottom \(pants\)|no top item|no shoe in wardrobe|wardrobe item not found|bottom garment not found|top garment not found|no back reference/i;
        if (PERMANENT_ERROR_PATTERNS.test(errorText)) {
          console.error(`[Worker] ${shot.shotType} (${shot.jobId.substring(0,8)}) — PERMANENT error detected, marking 'failed' (no retry).`);
          await shotsCol.doc(shot.shotId).update({
            status: 'failed',
            error: errorText.substring(0, 500),
            updatedAt: new Date(),
          });
        } else {
          await shotsCol.doc(shot.shotId).update({ status: 'pending', updatedAt: new Date() });
        }
      }
    } else {
      console.log(`[Worker] ${shot.shotType} (${shot.jobId.substring(0,8)}) ✓`);
    }
  } catch (err) {
    clearTimeout(timeout);
    const msg = (err as Error).message || '';
    console.error(`[Worker] ${shot.shotType} (${shot.jobId.substring(0,8)}) error: ${msg.substring(0, 200)}`);
    if (msg.includes('abort')) {
      console.error(`[Worker] ${shot.shotType} timed out after ${SHOT_TIMEOUT_MS / 1000}s`);
    }
  } finally {
    await updateWorkerHeartbeat();
  }
}

// ── Awaiting-matrix resume ────────────────────────────────────────────────
//
// Stage 4 (2026-05-17): jobs that were created against a missing Tier-2
// (shoe × model) cell sit in status='awaiting-matrix' with `awaitingCell`
// pointing at the cell. Each worker tick scans those jobs; for each whose
// cell is now complete, flip the job to 'generating', clear awaitingCell,
// and enqueue it for normal processing.
//
// Worker doesn't drain batches — the existing /api/qa/shoe-matrix/batch-check
// endpoint handles that and triggers the worker on completion. This scan is
// lightweight: one query + one isMatrixCellComplete per parked job.
async function resumeAwaitingMatrixJobsTick(): Promise<{ resumed: number; waiting: number }> {
  let resumed = 0;
  let waiting = 0;

  // Self-healing: before we check for ready cells, sweep `batch-pending`
  // cells that actually have all 4 images and promote them to 'done'.
  // Defends against the batch-check status-promotion bug (2026-05-19,
  // shoe-matrix-batch.ts:643) where cells whose final views landed in a
  // different batch-check call from their result-line processing would
  // stay 'batch-pending' forever. Cheap query — rare for many cells to
  // be in this state at once.
  try {
    const pending = await qaShoeMatrixCol.where('status', '==', 'batch-pending').get();
    for (const cellSnap of pending.docs) {
      const data = cellSnap.data() as { viewsCompleted?: string[]; images?: Record<string, string>; archived?: boolean; blocked?: boolean };
      if (data.archived || data.blocked) continue;
      const completed = new Set(data.viewsCompleted || []);
      const allImages = VIEWS.every(v => completed.has(v) && !!data.images?.[v]);
      if (allImages) {
        await cellSnap.ref.update({ status: 'done', updatedAt: new Date() });
        console.log(`[Worker] Promoted stale batch-pending cell ${cellSnap.id} → done (self-healing sweep)`);
      }
    }
  } catch (sweepErr) {
    console.warn('[Worker] batch-pending self-healing sweep failed:', sweepErr);
  }

  try {
    const snap = await jobsCol.where('status', '==', 'awaiting-matrix').get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const cell = data.awaitingCell as { shoeId?: string; modelId?: string; parkedAt?: number } | undefined;
      if (!cell?.shoeId || !cell?.modelId) {
        console.warn(`[Worker] awaiting-matrix job ${doc.id} has no awaitingCell — marking failed`);
        await doc.ref.update({ status: 'failed', error: 'awaitingCell missing on awaiting-matrix job', updatedAt: new Date() });
        continue;
      }
      let ready = false;
      try {
        ready = await isMatrixCellComplete(cell.shoeId, cell.modelId);
      } catch (err) {
        console.warn(`[Worker] isMatrixCellComplete failed for job ${doc.id}:`, err);
      }
      if (!ready) {
        waiting++;
        continue;
      }
      try {
        await doc.ref.update({
          status: 'generating',
          awaitingCell: FieldValue.delete(),
          updatedAt: new Date(),
        });
        await enqueueJob(doc.id, (data.jobName as string) || doc.id);
        resumed++;
        console.log(`[Worker] Resumed awaiting-matrix job ${doc.id.substring(0,8)} — cell (${cell.shoeId}_${cell.modelId}) landed`);
      } catch (resumeErr) {
        console.error(`[Worker] Failed to resume awaiting-matrix job ${doc.id}:`, resumeErr);
        // Leave in awaiting-matrix; next tick retries.
      }
    }
  } catch (queryErr) {
    console.warn('[Worker] awaiting-matrix scan failed:', queryErr);
  }
  return { resumed, waiting };
}

// ── Job finalization ──
async function checkAndFinalizeJob(jobId: string): Promise<void> {
  if (await isJobComplete(jobId)) {
    const allShots = await listShots(jobId);
    const anySucceeded = allShots.some((s: any) => s.status === 'done' || s.status === 'approved');
    const finalStatus = anySucceeded ? 'review' : 'failed';
    await updateJobStatus(jobId, finalStatus);
    const failedCount = allShots.filter((s: any) => s.status === 'failed').length;
    console.log(`[Worker] Job ${jobId.substring(0,8)} complete — ${finalStatus}${failedCount > 0 ? ` (${failedCount} shot(s) failed)` : ''}`);
    const next = await releaseSlot(jobId);
    if (next) console.log(`[Worker] Next job from queue: ${next.jobId.substring(0,8)}`);
  }
}

// ── Main loop ──
export interface RunWorkerLoopOptions {
  /** Identifier for log lines (e.g. 'inproc', 'job'). */
  workerName?: string;
}

export interface RunWorkerLoopResult {
  claimed: boolean;
  message: string;
}

/**
 * Run the worker loop until idle. Identical behaviour in both inproc and
 * Cloud Run Job environments — the only difference is `getInternalBase()`
 * resolving to localhost vs INTERNAL_BASE_URL.
 *
 * Caller should typically NOT re-invoke until this returns — the worker
 * singleton lock (claimWorker / releaseWorker) prevents two concurrent runs.
 */
export async function runWorkerLoop(opts: RunWorkerLoopOptions = {}): Promise<RunWorkerLoopResult> {
  const workerName = opts.workerName || 'worker';
  const claimed = await claimWorker();
  if (!claimed) {
    return { claimed: false, message: `Another worker is active (${workerName} skipped)` };
  }

  const maxParallel = Math.min(KEY_POOL.length, BYTEPLUS_KEY_POOL.length);
  console.log(`[Worker:${workerName}] Claimed worker role — Per-shot parallel: ${KEY_POOL.length} Gemini × ${BYTEPLUS_KEY_POOL.length} BytePlus → up to ${maxParallel} shots in flight`);

  const runningShots = new Map<string, Promise<void>>();

  try {
    let idleCycles = 0;

    while (idleCycles < MAX_IDLE_CYCLES) {
      // Stage 4 — promote awaiting-matrix jobs whose cells just landed.
      // Cheap: one indexed query + per-doc cell check. Worker is otherwise
      // blind to these jobs (they're not in the queue slots until resumed).
      const awaitingResult = await resumeAwaitingMatrixJobsTick();
      if (awaitingResult.resumed > 0 || awaitingResult.waiting > 0) {
        console.log(`[Worker:${workerName}] awaiting-matrix scan: resumed=${awaitingResult.resumed}, still-waiting=${awaitingResult.waiting}`);
      }

      const state = await getQueueState();
      const activeSlots = state.slots.filter(s => s !== null);

      if (activeSlots.length === 0 && runningShots.size === 0) {
        // If awaiting-matrix jobs are still parked, keep ticking — their cells
        // might land between idle cycles. Without this the worker would exit
        // after 5 min and the jobs would stall until an external trigger.
        if (awaitingResult.waiting === 0) {
          idleCycles++;
          if (idleCycles >= MAX_IDLE_CYCLES) {
            console.log(`[Worker:${workerName}] Idle timeout — exiting`);
            break;
          }
        } else {
          idleCycles = 0;  // keep alive while waiting for matrix cells
        }
        await new Promise(r => setTimeout(r, IDLE_CHECK_MS));
        continue;
      }
      idleCycles = 0;

      await resetStaleInflight(runningShots);

      const runningShotIds = new Set(runningShots.keys());
      for (const slot of activeSlots) {
        if (slot) await resetStaleShots(slot.jobId, runningShotIds);
      }

      const allEligible: EligibleShot[] = [];
      for (const slot of activeSlots) {
        if (!slot) continue;
        const eligible = await getEligibleShotsForJob(slot.jobId);
        allEligible.push(...eligible);
      }

      let launched = 0;
      for (const shot of allEligible) {
        if (runningShots.has(shot.shotId)) continue;

        const geminiKey = checkoutKeyForShot(shot.shotId);
        if (!geminiKey) break;
        const bytePlusKey = checkoutBytePlusKeyForShot(shot.shotId);
        if (!bytePlusKey) {
          checkinKeyForShot(shot.shotId);
          break;
        }

        const p = processShot(shot, geminiKey, bytePlusKey)
          .finally(() => {
            checkinKeyForShot(shot.shotId);
            checkinBytePlusKeyForShot(shot.shotId);
            runningShots.delete(shot.shotId);
          });
        runningShots.set(shot.shotId, p);
        launched++;
      }

      if (launched > 0 || runningShots.size > 0) {
        console.log(`[Worker:${workerName}] In flight: ${runningShots.size} shot(s) | Eligible-but-waiting: ${Math.max(0, allEligible.length - runningShots.size)}`);
      }

      if (runningShots.size > 0) {
        await Promise.race([
          ...runningShots.values(),
          new Promise(r => setTimeout(r, 5000)),
        ]).catch(() => {});
      } else if (activeSlots.length > 0) {
        await new Promise(r => setTimeout(r, 2000));
      } else {
        await new Promise(r => setTimeout(r, IDLE_CHECK_MS));
      }

      for (const slot of activeSlots) {
        if (slot) await checkAndFinalizeJob(slot.jobId);
      }
    }
  } catch (err) {
    console.error(`[Worker:${workerName}] Fatal error:`, err);
  } finally {
    if (runningShots.size > 0) {
      console.log(`[Worker:${workerName}] Waiting for ${runningShots.size} in-flight shot(s) to finish before releasing worker`);
      await Promise.allSettled(runningShots.values());
    }
    for (const shotId of [...checkedOutKeys.keys()]) checkinKeyForShot(shotId);
    for (const shotId of [...checkedOutBytePlusKeys.keys()]) checkinBytePlusKeyForShot(shotId);
    await releaseWorker();
    console.log(`[Worker:${workerName}] Released worker role`);
  }

  return { claimed: true, message: 'Worker finished' };
}
