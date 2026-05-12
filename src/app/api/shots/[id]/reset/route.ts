import { NextRequest, NextResponse } from 'next/server';
import { shotsCol, jobsCol, enqueueJob } from '@/lib/firestore';
import { FieldValue } from '@google-cloud/firestore';

/**
 * POST /api/shots/[id]/reset
 *
 * Resets a stuck/failed shot back to 'queued' so run-all can pick it up.
 * Also ensures the parent job is set to 'generating' so run-all triggers.
 *
 * 2026-05-10: also re-enqueues the job into the queue/slot system. When a
 * shot fails, `checkAndFinalizeJob` marks the job 'failed' and calls
 * `releaseSlot` — removing the job from `system/generationQueue.slots`. A
 * subsequent reset on a single shot would set status back to 'queued' but
 * the worker's `getQueueState().slots` would no longer contain this job, so
 * the rerun would silently never start. `enqueueJob` is idempotent (returns
 * existing slot if already present) so calling it on an active job is safe.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: shotId } = await params;

  try {
    // Parse optional body (may be empty for legacy callers)
    let incrementVersion = false;
    let useDressedBase: boolean | undefined;
    try {
      const body = await req.json();
      incrementVersion = body?.incrementVersion === true;
      if (body?.useDressedBase === true) useDressedBase = true;
    } catch { /* no body — that's fine */ }

    const shotDoc = await shotsCol.doc(shotId).get();
    if (!shotDoc.exists) {
      return NextResponse.json({ error: 'Shot not found' }, { status: 404 });
    }

    const shotData = shotDoc.data() as Record<string, unknown>;
    const currentVersion = (shotData.version as number) || 1;
    const nextVersion = incrementVersion ? currentVersion + 1 : currentVersion;

    // Reset shot to queued — clear stale progress text so UI doesn't show old state
    const updateData: Record<string, unknown> = {
      status: 'queued',
      error: null,
      progressStep: '',
      progressPct: 0,
      version: nextVersion,
      updatedAt: new Date(),
    };
    // Set or clear the useDressedBase flag — prevents stale flags from previous resets
    updateData.useDressedBase = useDressedBase === true ? true : FieldValue.delete();
    await shotsCol.doc(shotId).update(updateData);

    // Ensure parent job is set to generating + re-enqueue so the worker picks up
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
        console.warn(`[ShotReset] enqueueJob failed for ${jobId} (non-blocking):`, e);
      }
    }

    return NextResponse.json({ success: true, shotId, status: 'queued' });
  } catch (error) {
    console.error(`[ShotReset] Failed to reset shot ${shotId}:`, error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
