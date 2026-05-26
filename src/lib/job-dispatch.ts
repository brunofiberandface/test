/**
 * Job dispatch helpers — shared between job CREATE and the three rerun
 * endpoints (run-all, rerun-with-seedream, rerun-with-seedream-5).
 *
 * The original gate logic lives inline in `src/app/api/jobs/route.ts` (CREATE).
 * This module is a SECOND copy of the gate, designed for the rerun paths
 * that previously didn't gate at all — leading to the M61G infinite-retry
 * loop on a missing Tier-2 cell (2026-05-26).
 *
 * Why a separate file instead of refactoring CREATE: CREATE works. Adding a
 * shared helper without touching CREATE keeps the existing behavior on the
 * primary path while extending the same safety net to reruns.
 */

import { updateJob } from '@/lib/firestore';
import { isMatrixCellComplete } from '@/lib/qa/shoe-matrix';
import { getCurrentBatchJob, submitSingleCellBatch } from '@/lib/qa/shoe-matrix-batch';

export interface GateResult {
  /** True iff the job was parked in 'awaiting-matrix'. Caller should return
   *  early without enqueuing the job. False = cell is ready, proceed. */
  parked: boolean;
  /** When parked: name of the single-cell batch we submitted (if any).
   *  Surfaced in the API response for observability. */
  awaitingCellBatchName?: string;
}

/**
 * Check the (shoe × model) Tier-2 cell. If incomplete, park the job in
 * 'awaiting-matrix' state, best-effort submit a single-cell batch to
 * render the missing views, and return `{parked: true}`. The worker's
 * awaiting-matrix scan will resume the job once all 4 views land.
 *
 * When `parked=true`, the caller MUST return early — do not enqueue.
 *
 * Failure modes:
 * - shoeId / modelId missing: caller should validate before calling.
 * - Single-cell batch submit fails: logged, non-blocking. Job stays parked;
 *   worker will retry or a later sync run will pick up the pending cell.
 */
export async function gateJobOnMatrixCell(
  jobId: string,
  shoeId: string,
  modelId: string,
): Promise<GateResult> {
  const cellReady = await isMatrixCellComplete(shoeId, modelId);

  if (cellReady) {
    return { parked: false };
  }

  console.log(`[JobDispatch] Matrix cell missing for (${shoeId} × ${modelId}) on job ${jobId.substring(0,8)} — parking in awaiting-matrix`);

  // Best-effort single-cell batch submit. Only one batch can be live at a
  // time per the Gemini Pro Batch API contract — if another job already
  // kicked one, the worker will resume once that batch lands.
  let awaitingCellBatchName: string | undefined;
  try {
    const existingBatch = await getCurrentBatchJob();
    const live = existingBatch && (existingBatch.state === 'PENDING' || existingBatch.state === 'RUNNING');
    if (!live) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        const submitResult = await submitSingleCellBatch(shoeId, modelId, apiKey);
        awaitingCellBatchName = submitResult.name;
        console.log(`[JobDispatch] Submitted single-cell batch ${submitResult.name} for missing cell`);
      } else {
        console.warn('[JobDispatch] GEMINI_API_KEY not set — cannot submit single-cell batch. Job will wait for an external batch.');
      }
    } else {
      console.log(`[JobDispatch] Batch ${existingBatch.name} is ${existingBatch.state} — job will wait for it to finish`);
    }
  } catch (submitErr) {
    console.error('[JobDispatch] Single-cell batch submit failed (non-blocking — worker will retry):', submitErr);
  }

  await updateJob(jobId, {
    status: 'awaiting-matrix',
    awaitingCell: {
      shoeId,
      modelId,
      parkedAt: Date.now(),
      ...(awaitingCellBatchName ? { batchName: awaitingCellBatchName } : {}),
    },
  });

  return { parked: true, awaitingCellBatchName };
}
