import { NextRequest } from 'next/server';
import { getJob, enqueueJob } from '@/lib/firestore';

/**
 * POST /api/jobs/[id]/run-all
 *
 * SIMPLIFIED — enqueues the job and kicks the server-side worker.
 * The old SSE-based generation loop has been replaced by /api/jobs/process-queue.
 *
 * This endpoint exists for backwards compatibility (frontend buttons, etc.)
 */

function getInternalBase(): string {
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

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

  // v37: Respond immediately, kick worker in background.
  // The internal fetch creates a new request that keeps the container alive.
  // Must NOT await — process-queue blocks for minutes during generation.
  fetch(`${getInternalBase()}/api/jobs/process-queue`, { method: 'POST' })
    .then(res => console.log(`[RunAll] Worker kick response: ${res.status}`))
    .catch(err => console.warn(`[RunAll] Worker kick failed (non-blocking):`, err));

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
