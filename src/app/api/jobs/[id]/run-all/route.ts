import { NextRequest } from 'next/server';
import { getJob, enqueueJob } from '@/lib/firestore';
import { triggerWorker } from '@/lib/worker/trigger';
import { gateJobOnMatrixCell } from '@/lib/job-dispatch';

/**
 * POST /api/jobs/[id]/run-all
 *
 * SIMPLIFIED — enqueues the job and kicks the server-side worker.
 * The old SSE-based generation loop has been replaced by /api/jobs/process-queue.
 *
 * 2026-05-26: matrix-cell gate added. CREATE has this gate (route.ts); reruns
 * didn't. Result: job M61G with missing fullBody views hit matrixPaint
 * directly, threw, retried every ~1s, burned quota. Gate parks the job
 * in 'awaiting-matrix' if the (shoe × model) cell is incomplete and lets
 * the worker resume scan pick it up when views land.
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await params;

  const job = await getJob(jobId);
  if (!job) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const jobData = job as Record<string, unknown>;
  const jobName = (jobData.jobName || jobData.designNumber || jobId) as string;

  // ── Matrix-cell readiness gate (same pattern as CREATE in route.ts:364) ──
  const wardrobe = jobData.wardrobe as { shoe?: { itemId?: string } } | undefined;
  const shoeId = wardrobe?.shoe?.itemId;
  const modelId = jobData.modelId as string | undefined;
  if (shoeId && modelId) {
    const gate = await gateJobOnMatrixCell(jobId, shoeId, modelId);
    if (gate.parked) {
      // Job is parked in 'awaiting-matrix'. Don't enqueue. Worker's
      // awaiting-matrix scan will resume the job once the cell lands.
      triggerWorker('run-all-awaiting-matrix').catch(() => { /* logged in helper */ });
      return new Response(JSON.stringify({
        ok: true,
        jobId,
        jobName,
        status: 'awaiting-matrix',
        awaitingCell: { shoeId, modelId, batchName: gate.awaitingCellBatchName },
      }), { headers: { 'Content-Type': 'application/json' } });
    }
  }

  // Enqueue the job
  const result = await enqueueJob(jobId, jobName);
  console.log(`[RunAll] Enqueued ${jobName}: slot=${result.slot}, position=${result.position}`);

  // v37: Respond immediately, kick worker in background. triggerWorker
  // branches on WORKER_MODE env var — inproc (default) or job (Phase 2
  // Cloud Run Job). Helper logs success/failure internally.
  triggerWorker('run-all').catch(() => { /* logged in helper */ });

  return new Response(JSON.stringify({
    ok: true,
    jobId,
    jobName,
    slot: result.slot,
    position: result.position,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
