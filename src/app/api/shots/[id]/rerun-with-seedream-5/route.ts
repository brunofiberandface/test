/**
 * POST /api/shots/[id]/rerun-with-seedream-5
 *
 * Per-shot 5.0 rerun. Sets provider='seedream', seedreamModel='seedream-5-0-260128'
 * on the shot, increments version, resets status to 'queued', kicks the worker.
 *
 * For M01/M02 (cropped shots): the caller (UI) should rerun the M03/M04 anchor
 * with 5.0 instead, since M01/M02 are crops of the anchor — running just the
 * crop wouldn't pick up a 5.0 anchor unless M03/M04 was also rerun. Endpoint
 * still works on M01/M02 if called, but the result will be a crop of whatever
 * M04 anchor currently exists.
 */
import { NextRequest, NextResponse } from 'next/server';
import { shotsCol, jobsCol, enqueueJob } from '@/lib/firestore';
import { FieldValue } from '@google-cloud/firestore';
import { SEEDREAM_MODEL_5_0 } from '@/lib/pipeline/seedream-client';
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
  const currentVersion = (shotData.version as number) || 1;

  // Reset to queued + flip provider/model + bump version. Existing generate
  // route preserves the prior imageUrl in previousVersions[] when it writes
  // the new one, so rollback is automatic.
  await shotsCol.doc(shotId).update({
    provider: 'seedream',
    seedreamModel: SEEDREAM_MODEL_5_0,
    status: 'queued',
    error: null,
    progressStep: '',
    progressPct: 0,
    version: currentVersion + 1,
    // Drop dressed-base flag if it was set — irrelevant for seedream pipeline
    useDressedBase: FieldValue.delete(),
    updatedAt: new Date(),
  });

  // Set parent job to 'generating' + re-enqueue so the worker picks up.
  // Without re-enqueue, finalized jobs (any shot failed or all done) have an
  // empty slot in `system/generationQueue` — kicking the worker idles out.
  // enqueueJob is idempotent.
  if (shotData.jobId) {
    const jobId = shotData.jobId as string;
    try {
      await jobsCol.doc(jobId).update({
        status: 'generating',
        updatedAt: new Date(),
      });
    } catch { /* non-blocking */ }

    try {
      const jobDoc = await jobsCol.doc(jobId).get();
      const jobName = (jobDoc.data()?.jobName as string) || jobId;
      await enqueueJob(jobId, jobName);
    } catch (e) {
      console.warn(`[ShotRerun5] enqueueJob failed for ${jobId} (non-blocking):`, e);
    }
  }

  triggerWorker('shot-rerun-5').catch(() => { /* logged in helper */ });

  return NextResponse.json({
    success: true,
    shotId,
    provider: 'seedream',
    seedreamModel: SEEDREAM_MODEL_5_0,
    nextVersion: currentVersion + 1,
  });
}
