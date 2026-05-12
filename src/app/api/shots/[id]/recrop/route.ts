/**
 * POST /api/shots/[id]/recrop
 *
 * Re-crop M01 from current m03AnchorUrl (or M02 from m04AnchorUrl) without
 * rerunning the parent. Cheap operation — no Seedream/Gemini calls, just a
 * waist-line crop of the existing anchor.
 *
 * Use case: Bruno reran M03 and got a clean version, but M01 is still showing
 * the old crop. Hitting this endpoint re-cuts M01 from the latest M03 anchor.
 *
 * Behavior:
 *   1. Validate shot is M01 or M02
 *   2. Confirm the parent anchor URL exists on the job (m03AnchorUrl /
 *      m04AnchorUrl)
 *   3. Bump shot.version (preserves the prior crop in previousVersions[]
 *      via the existing generate-route logic)
 *   4. Set shot.status = 'queued', clear seedreamModel/error/progress
 *   5. Set parent job to 'generating' so the worker picks up
 *   6. Kick the worker
 *
 * The worker calls seedreamM01 / seedreamM02 which already does the right
 * thing — pulls ctx.m03AnchorUrl / m04AnchorUrl and runs cropWaistFromFullBody.
 * No new generation logic needed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { shotsCol, jobsCol, enqueueJob } from '@/lib/firestore';
import { FieldValue } from '@google-cloud/firestore';
import { triggerWorker } from '@/lib/worker/trigger';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: shotId } = await params;

  const shotDoc = await shotsCol.doc(shotId).get();
  if (!shotDoc.exists) {
    return NextResponse.json({ error: 'Shot not found' }, { status: 404 });
  }
  const shotData = shotDoc.data() as Record<string, unknown>;
  const shotType = shotData.shotType as string | undefined;
  if (shotType !== 'M01' && shotType !== 'M02') {
    return NextResponse.json(
      { error: `recrop is only valid for M01 / M02; got ${shotType}` },
      { status: 400 },
    );
  }

  const jobId = shotData.jobId as string | undefined;
  if (!jobId) {
    return NextResponse.json({ error: 'Shot has no jobId' }, { status: 400 });
  }
  const jobDoc = await jobsCol.doc(jobId).get();
  if (!jobDoc.exists) {
    return NextResponse.json({ error: 'Parent job not found' }, { status: 404 });
  }
  const jobData = jobDoc.data() as Record<string, unknown>;

  const requiredAnchor = shotType === 'M01' ? 'm03AnchorUrl' : 'm04AnchorUrl';
  const anchorUrl = jobData[requiredAnchor] as string | undefined;
  if (!anchorUrl) {
    return NextResponse.json(
      {
        error: `Cannot re-crop: parent ${shotType === 'M01' ? 'M03' : 'M04'} has not been generated yet (no ${requiredAnchor} on the job).`,
      },
      { status: 400 },
    );
  }

  const currentVersion = (shotData.version as number) || 1;

  await shotsCol.doc(shotId).update({
    status: 'queued',
    error: null,
    progressStep: '',
    progressPct: 0,
    version: currentVersion + 1,
    // Drop dressed-base flag — irrelevant for crop path
    useDressedBase: FieldValue.delete(),
    updatedAt: new Date(),
  });

  // Kick the parent job to generating so the worker picks up.
  try {
    await jobsCol.doc(jobId).update({
      status: 'generating',
      updatedAt: new Date(),
    });
  } catch { /* non-blocking */ }

  // Re-enqueue so the worker sees the job in `system/generationQueue.slots`.
  // After a finalized job (any shot failed or all done) the slot was released;
  // without this re-enqueue, the worker scans empty slots and idles out.
  // enqueueJob is idempotent — returns existing slot when the job is already
  // in flight, so safe to call unconditionally.
  try {
    const jobName = (jobData.jobName as string) || jobId;
    await enqueueJob(jobId, jobName);
  } catch (e) {
    console.warn(`[Recrop] enqueueJob failed for ${jobId} (non-blocking):`, e);
  }

  triggerWorker('recrop').catch(() => { /* logged in helper */ });

  return NextResponse.json({
    success: true,
    shotId,
    shotType,
    anchorUrl,
    nextVersion: currentVersion + 1,
  });
}
