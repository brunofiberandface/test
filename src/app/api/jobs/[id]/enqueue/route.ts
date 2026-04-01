import { NextRequest } from 'next/server';
import { getJob, enqueueJob } from '@/lib/firestore';

/**
 * POST /api/jobs/[id]/enqueue
 *
 * Add a job to the generation queue. If a slot is free, it gets assigned immediately.
 * Otherwise it enters the queue and the worker will pick it up.
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

  const result = await enqueueJob(jobId, jobName);

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
