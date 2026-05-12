/**
 * POST /api/jobs/[id]/rerun-with-seedream-5
 *
 * One-shot override: re-runs all 5 shots of an existing job through
 * Seedream 5.0 Lite (model `seedream-5-0-260128`), regardless of the job's
 * current provider OR the global SEEDREAM_MODEL env var.
 *
 * Sets `shot.provider = 'seedream'` AND `shot.seedreamModel = 'seedream-5-0-260128'`
 * on each shot doc, then resets status to 'pending' and enqueues the job.
 *
 * The generate/route.ts reads shot.seedreamModel → ctx.model → seedream-client
 * uses 5.0 model. Tee-edit is automatically skipped for 5.0 (see
 * needsTeeEdit() in seedream-tee-edit.ts) since 5.0 handles tucked-in tops
 * natively.
 *
 * Previous versions are preserved via the existing version-history logic
 * in generate/route.ts.
 */
import { NextRequest } from 'next/server';
import { getJob, listShots, shotsCol, enqueueJob, updateJobStatus } from '@/lib/firestore';
import { SEEDREAM_MODEL_5_0 } from '@/lib/pipeline/seedream-client';
import { triggerWorker } from '@/lib/worker/trigger';

export async function POST(
  _req: NextRequest,
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

  // Flag every shot for Seedream 5.0 + reset to pending. We intentionally do
  // NOT clear imageUrl — the existing generate route moves the current
  // imageUrl into previousVersions[] on successful rerun.
  const batch = (await import('@/lib/firestore')).db.batch();
  for (const shot of shots) {
    const ref = shotsCol.doc(shot.id);
    batch.update(ref, {
      provider: 'seedream',
      seedreamModel: SEEDREAM_MODEL_5_0,
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
  console.log(`[RerunSeedream5] Enqueued ${jobName}: slot=${result.slot}, position=${result.position}`);

  // Respond-then-fire kick pattern — see jobs/route.ts comments.
  triggerWorker('rerun-seedream-5').catch(() => { /* logged in helper */ });

  return new Response(JSON.stringify({
    ok: true,
    jobId,
    provider: 'seedream',
    seedreamModel: SEEDREAM_MODEL_5_0,
    shotsRequeued: shots.length,
    slot: result.slot,
    position: result.position,
  }), { headers: { 'Content-Type': 'application/json' } });
}
