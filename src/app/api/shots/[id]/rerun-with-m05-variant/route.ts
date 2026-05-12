/**
 * POST /api/shots/[id]/rerun-with-m05-variant
 *
 * Re-render an M05 shot with a specific top-focus camera variant.
 * Only applies when the parent job's focus is on the top (jacket/shirt/etc.).
 * For bottom-focus jobs, M05 has only one canonical shot — this endpoint
 * returns 400 if called on a bottom-focus job.
 *
 * Body: { variantId: 'A' | 'B' | 'C' }
 *   A — Side profile shoulder (90°)
 *   B — 3/4 rear-side over-shoulder (135°)
 *   C — 3/4 front-side shoulder (45°)
 *
 * Sets `shot.m05TopVariantId` (read by /api/generate when building the
 * Seedream context), resets status to queued + bumps version, re-enqueues
 * the job, kicks the worker.
 */
import { NextRequest, NextResponse } from 'next/server';
import { shotsCol, jobsCol, enqueueJob, getJob } from '@/lib/firestore';
import { FieldValue } from '@google-cloud/firestore';
import { triggerWorker } from '@/lib/worker/trigger';
import { getFocusSlot } from '@/types';

const ALLOWED = new Set(['A', 'B', 'C']);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: shotId } = await params;
  const body = await req.json().catch(() => ({}));
  const variantId = body?.variantId;
  if (!variantId || !ALLOWED.has(variantId)) {
    return NextResponse.json({ error: 'variantId must be one of A, B, C' }, { status: 400 });
  }

  const shotDoc = await shotsCol.doc(shotId).get();
  if (!shotDoc.exists) {
    return NextResponse.json({ error: 'Shot not found' }, { status: 404 });
  }
  const shotData = shotDoc.data() as Record<string, unknown>;
  if (shotData.shotType !== 'M05') {
    return NextResponse.json({ error: 'Only M05 shots support top variant rerun' }, { status: 400 });
  }
  const jobId = shotData.jobId as string;
  const job = await getJob(jobId) as any;
  if (!job) return NextResponse.json({ error: 'Parent job not found' }, { status: 404 });
  const focusSlot = getFocusSlot(job.wardrobe);
  if (focusSlot !== 'top') {
    return NextResponse.json({ error: 'M05 variant override only applies to top-focus jobs' }, { status: 400 });
  }

  const currentVersion = (shotData.version as number) || 1;

  await shotsCol.doc(shotId).update({
    m05TopVariantId: variantId,
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
    console.warn(`[M05Variant] enqueueJob failed for ${jobId} (non-blocking):`, e);
  }

  triggerWorker('m05-variant-rerun').catch(() => { /* logged */ });

  return NextResponse.json({
    success: true,
    shotId,
    variantId,
    nextVersion: currentVersion + 1,
  });
}
