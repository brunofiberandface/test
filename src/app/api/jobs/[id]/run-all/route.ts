import { NextRequest } from 'next/server';
import { getJob, enqueueJob } from '@/lib/firestore';
import { triggerWorker } from '@/lib/worker/trigger';

/**
 * POST /api/jobs/[id]/run-all
 *
 * SIMPLIFIED — enqueues the job and kicks the server-side worker.
 * The old SSE-based generation loop has been replaced by /api/jobs/process-queue.
 *
 * This endpoint exists for backwards compatibility (frontend buttons, etc.)
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
