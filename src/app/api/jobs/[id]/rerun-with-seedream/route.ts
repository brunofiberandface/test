/**
 * POST /api/jobs/[id]/rerun-with-seedream
 *
 * One-shot override: re-runs all 5 shots of an existing job through
 * Seedream 4.5, regardless of the job's current provider. Sets
 * `shot.provider = 'seedream'` on each shot doc, then resets status to
 * 'pending' and enqueues the job.
 *
 * The existing generate/route.ts branches on shot.provider > job.provider,
 * so no other changes needed — the queue worker picks up from here.
 *
 * Previous versions are preserved via the existing version-history logic
 * in generate/route.ts (moves imageUrl + provider to previousVersions[]
 * before writing the new one).
 */
import { NextRequest } from 'next/server';
import { getJob, listShots, shotsCol, enqueueJob, updateJobStatus } from '@/lib/firestore';

function getInternalBase(): string {
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await params;

  const job = await getJob(jobId) as any;
  if (!job) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const shots = await listShots(jobId);
  if (shots.length === 0) {
    return new Response(JSON.stringify({ error: 'Job has no shots to rerun' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Flag every shot for Seedream + reset to pending so the worker picks them up.
  // We intentionally do NOT clear imageUrl — the existing generate route moves
  // the current imageUrl into previousVersions[] on successful rerun.
  const batch = (await import('@/lib/firestore')).db.batch();
  for (const shot of shots) {
    const ref = shotsCol.doc(shot.id);
    batch.update(ref, {
      provider: 'seedream',
      status: 'pending',
      progressStep: '',
      progressPct: 0,
      updatedAt: new Date(),
    });
  }
  await batch.commit();

  // Clear job-level anchor URLs so M03/M04 reruns regenerate them cleanly
  // and M01/M02/M05 pick up the new Seedream anchors in the dependency chain.
  const { updateJob } = await import('@/lib/firestore');
  await updateJob(jobId, { m03AnchorUrl: null, m04AnchorUrl: null });

  await updateJobStatus(jobId, 'generating');

  const jobName = (job.jobName || job.designNumber || jobId) as string;
  const result = await enqueueJob(jobId, jobName);
  console.log(`[RerunSeedream] Enqueued ${jobName}: slot=${result.slot}, position=${result.position}`);

  // Respond-then-fire kick pattern — see jobs/route.ts comments.
  fetch(`${getInternalBase()}/api/jobs/process-queue`, { method: 'POST' })
    .then(res => console.log(`[RerunSeedream] Worker kick: ${res.status}`))
    .catch(err => console.warn(`[RerunSeedream] Worker kick failed (non-blocking):`, err));

  return new Response(JSON.stringify({
    ok: true,
    jobId,
    provider: 'seedream',
    shotsRequeued: shots.length,
    slot: result.slot,
    position: result.position,
  }), { headers: { 'Content-Type': 'application/json' } });
}
