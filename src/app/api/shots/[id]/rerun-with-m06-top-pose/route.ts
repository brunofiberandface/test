/**
 * POST /api/shots/[id]/rerun-with-m06-top-pose
 *
 * Re-render an M06 shot with a specific top-focus pose (t01-t05).
 * Only applies when the parent job's focusSlot is 'top'.
 *
 * Body: { poseId: 't01' | 't02' | 't03' | 't04' | 't05' }
 *   t01 — Hands at sides
 *   t02 — Relaxed asymmetric
 *   t03 — Both hands pockets
 *   t04 — One hand pocket
 *   t05 — Pockets relaxed
 *
 * Sets `shot.m06TopPoseId` (read by /api/generate when building the
 * SeedreamGenerationContext → forwarded into gemini-m06.ts top-focus path),
 * resets status to queued + bumps version, re-enqueues the job, kicks
 * the worker.
 *
 * Mirror of /api/shots/[id]/rerun-with-m05-variant — same lifecycle.
 */
import { NextRequest, NextResponse } from 'next/server';
import { shotsCol, jobsCol, enqueueJob, getJob } from '@/lib/firestore';
import { FieldValue } from '@google-cloud/firestore';
import { triggerWorker } from '@/lib/worker/trigger';
import { getFocusSlot } from '@/types';
import { M06_TOP_POSE_IDS } from '@/lib/m06-top-poses';

const ALLOWED = new Set<string>(M06_TOP_POSE_IDS as readonly string[]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: shotId } = await params;
  const body = await req.json().catch(() => ({}));
  const poseId = body?.poseId;
  if (!poseId || !ALLOWED.has(poseId)) {
    return NextResponse.json({ error: `poseId must be one of ${[...ALLOWED].join(', ')}` }, { status: 400 });
  }

  const shotDoc = await shotsCol.doc(shotId).get();
  if (!shotDoc.exists) {
    return NextResponse.json({ error: 'Shot not found' }, { status: 404 });
  }
  const shotData = shotDoc.data() as Record<string, unknown>;
  if (shotData.shotType !== 'M06') {
    return NextResponse.json({ error: 'Only M06 shots support top-pose rerun' }, { status: 400 });
  }
  const jobId = shotData.jobId as string;
  const job = await getJob(jobId) as any;
  if (!job) return NextResponse.json({ error: 'Parent job not found' }, { status: 404 });
  const focusSlot = getFocusSlot(job.wardrobe);
  if (focusSlot !== 'top') {
    return NextResponse.json({ error: 'M06 top-pose override only applies to top-focus jobs' }, { status: 400 });
  }

  const currentVersion = (shotData.version as number) || 1;

  await shotsCol.doc(shotId).update({
    m06TopPoseId: poseId,
    status: 'queued',
    error: null,
    progressStep: '',
    progressPct: 0,
    version: currentVersion + 1,
    useDressedBase: FieldValue.delete(),
    updatedAt: new Date(),
  });

  try {
    await jobsCol.doc(jobId).update({ status: 'generating', updatedAt: new Date() });
  } catch { /* non-blocking */ }

  try {
    await enqueueJob(jobId, job.jobName || jobId);
  } catch (e) {
    console.warn(`[M06TopPose] enqueueJob failed for ${jobId} (non-blocking):`, e);
  }

  triggerWorker('m06-top-pose-rerun').catch(() => { /* logged */ });

  return NextResponse.json({
    success: true,
    shotId,
    poseId,
    nextVersion: currentVersion + 1,
  });
}
