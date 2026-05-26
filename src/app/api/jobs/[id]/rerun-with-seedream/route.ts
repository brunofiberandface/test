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
import { FieldValue } from '@google-cloud/firestore';
import { getJob, listShots, shotsCol, enqueueJob, updateJobStatus } from '@/lib/firestore';
import { triggerWorker } from '@/lib/worker/trigger';
import { APP_CONFIG } from '@/lib/config';
import { gateJobOnMatrixCell } from '@/lib/job-dispatch';


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

  const shotsRaw = await listShots(jobId);
  if (shotsRaw.length === 0) {
    return new Response(JSON.stringify({ error: 'Job has no shots to rerun' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Skip retired shotTypes (M03/M04) — legacy jobs may have shot docs for
  // them, but the worker no longer dispatches those types. Resetting them
  // to 'pending' would leave them queued forever and block the job from
  // ever completing.
  const activeShotTypes = new Set<string>(APP_CONFIG.shotTypes);
  const shots = (shotsRaw as any[]).filter(s => activeShotTypes.has(s.shotType || ''));
  const skipped = shotsRaw.length - shots.length;
  if (skipped > 0) {
    const skippedTypes = (shotsRaw as any[]).filter(s => !activeShotTypes.has(s.shotType || '')).map(s => s.shotType).join(', ');
    console.log(`[RerunSeedream] Skipping ${skipped} legacy shot(s) (retired shotType): ${skippedTypes}`);
  }
  if (shots.length === 0) {
    return new Response(JSON.stringify({ error: 'Job has no active shotTypes to rerun (all are retired)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Flag every shot for Seedream + reset to pending so the worker picks them up.
  // We intentionally do NOT clear imageUrl — the existing generate route moves
  // the current imageUrl into previousVersions[] on successful rerun.
  //
  // CRITICAL: clear `seedreamModel` field with FieldValue.delete() so this rerun
  // falls back to the global SEEDREAM_MODEL env var default (4.5). Without
  // this, a shot previously set to 5.0 by the per-shot rerun would stay on 5.0
  // even after a "Rerun with Seedream 4.5" — the per-shot field wins precedence
  // over the env var in generate/route.ts.
  // Flag previously-approved shots with wasApproved=true so the UI can show
  // a "Pre-approved — Re-approve" badge on the new version (reviewer can
  // quickly re-bless after eyeballing). Cleared on next approval.
  const batch = (await import('@/lib/firestore')).db.batch();
  let preApprovedCount = 0;
  for (const shot of shots) {
    const ref = shotsCol.doc(shot.id);
    const update: Record<string, unknown> = {
      provider: 'seedream',
      seedreamModel: FieldValue.delete(),  // force fallback to 4.5 default
      status: 'pending',
      progressStep: '',
      progressPct: 0,
      updatedAt: new Date(),
    };
    if ((shot as { status?: string }).status === 'approved') {
      update.wasApproved = true;
      preApprovedCount++;
    }
    batch.update(ref, update);
  }
  await batch.commit();
  if (preApprovedCount > 0) {
    console.log(`[RerunSeedream] Flagged ${preApprovedCount} previously-approved shot(s) with wasApproved=true`);
  }

  // Clear job-level anchor URLs so M03/M04 reruns regenerate them cleanly
  // and M01/M02/M05 pick up the new Seedream anchors in the dependency chain.
  const { updateJob } = await import('@/lib/firestore');
  await updateJob(jobId, { m03AnchorUrl: null, m04AnchorUrl: null });

  // ── Matrix-cell readiness gate (parity with CREATE) ──
  // 2026-05-26: rerun endpoints previously skipped this check, causing the
  // M61G infinite-retry loop on missing cells. Now matches CREATE behavior.
  const wardrobe = job.wardrobe as { shoe?: { itemId?: string } } | undefined;
  const shoeId = wardrobe?.shoe?.itemId;
  const modelId = job.modelId as string | undefined;
  if (shoeId && modelId) {
    const gate = await gateJobOnMatrixCell(jobId, shoeId, modelId);
    if (gate.parked) {
      triggerWorker('rerun-seedream-awaiting-matrix').catch(() => { /* logged in helper */ });
      return new Response(JSON.stringify({
        ok: true,
        jobId,
        provider: 'seedream',
        shotsRequeued: shots.length,
        status: 'awaiting-matrix',
        awaitingCell: { shoeId, modelId, batchName: gate.awaitingCellBatchName },
      }), { headers: { 'Content-Type': 'application/json' } });
    }
  }

  await updateJobStatus(jobId, 'generating');

  const jobName = (job.jobName || job.designNumber || jobId) as string;
  const result = await enqueueJob(jobId, jobName);
  console.log(`[RerunSeedream] Enqueued ${jobName}: slot=${result.slot}, position=${result.position}`);

  triggerWorker('rerun-seedream').catch(() => { /* logged in helper */ });

  return new Response(JSON.stringify({
    ok: true,
    jobId,
    provider: 'seedream',
    shotsRequeued: shots.length,
    slot: result.slot,
    position: result.position,
  }), { headers: { 'Content-Type': 'application/json' } });
}
