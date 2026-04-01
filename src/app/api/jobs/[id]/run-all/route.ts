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

  // Kick the worker (fire-and-forget — don't await the long-running response)
  fetch(`${getInternalBase()}/api/jobs/process-queue`, { method: 'POST' }).catch(() => {});

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
