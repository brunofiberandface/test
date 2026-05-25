import { NextRequest, NextResponse } from 'next/server';
import { getJob, listShots, updateJobStatus, updateJob, getWardrobeItem, archiveJob, deleteJob, shotsCol, jobsCol, releaseSlot, removeFromQueue } from '@/lib/firestore';
import { FieldValue } from '@google-cloud/firestore';

// GET /api/jobs/[id] — get job details with all shots
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = await getJob(id) as any;
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const shots = await listShots(id);

    // ── Auto-fix stuck job status ──
    // If job is 'generating'/'uploading' but all ACTIVE shots are in terminal
    // states, advance it. Retired shotTypes (M03/M04) on legacy jobs are
    // ignored — the worker never dispatches them so they'd block forever.
    const { APP_CONFIG } = await import('@/lib/config');
    const activeShotTypes = new Set<string>(APP_CONFIG.shotTypes);
    const activeShots = (shots as any[]).filter(s => activeShotTypes.has(s.shotType));
    const stuckStatuses = ['generating', 'uploading'];
    if (stuckStatuses.includes(job.status) && activeShots.length > 0) {
      const terminalStatuses = ['done', 'approved'];
      const allTerminal = activeShots.every((s: any) => terminalStatuses.includes(s.status));
      const allApproved = activeShots.every((s: any) => s.status === 'approved');

      if (allApproved) {
        await updateJobStatus(id, 'complete');
        job.status = 'complete';
      } else if (allTerminal) {
        await updateJobStatus(id, 'review');
        job.status = 'review';
      }
    }

    // ── Auto-reset stale shots: if a shot has been "generating" for >5 min, reset to queued ──
    const STALE_MS = 5 * 60 * 1000;
    const now = Date.now();
    let resetCount = 0;
    for (const s of shots as any[]) {
      if (s.status === 'generating') {
        const updAt = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
        const age = now - updAt;
        if (age > STALE_MS || updAt === 0) {
          try {
            await shotsCol.doc(s.shotId || s.id).update({
              status: 'queued',
              error: null,
              progressStep: '',
              progressPct: 0,
              updatedAt: new Date(),
            });
            s.status = 'queued';
            s.progressStep = '';
            s.progressPct = 0;
            resetCount++;
            console.log(`[StaleGuard] Auto-reset shot ${s.shotType}_${s.variant || 'A'} (${s.shotId || s.id}) — stuck ${Math.round(age / 60000)}min`);
          } catch (e) {
            console.error(`[StaleGuard] Failed to reset ${s.shotId || s.id}:`, e);
          }
        }
      }
    }
    // If we reset any shots, ensure job is in 'generating' so run-all can pick them up
    if (resetCount > 0 && !['generating'].includes(job.status)) {
      try {
        await updateJobStatus(id, 'generating' as any);
        job.status = 'generating';
      } catch { /* non-blocking */ }
    }

    // Resolve wardrobe item names for display on results page
    if (job.wardrobeItemIds && Object.keys(job.wardrobeItemIds).length > 0) {
      const wardrobeItemNames: Record<string, string> = {};
      await Promise.all(
        Object.entries(job.wardrobeItemIds as Record<string, string>).map(async ([cat, id]) => {
          try {
            const item = await getWardrobeItem(id) as any;
            if (item?.name) wardrobeItemNames[cat] = item.name;
          } catch { /* non-blocking */ }
        })
      );
      job.wardrobeItemNames = wardrobeItemNames;
    }

    // Resolve focus item's front 0° fit-model image — surfaced on the results
    // page as the "Original" reference next to the AI deliverables. Bruno
    // 2026-05-07: visual A/B vs the source garment was missing. Falls back to
    // flatFrontUrl when fitModels.front is missing (legacy items).
    // Also surface focusSlot ('top'/'bottom'/'shoe') so the UI can gate
    // top-focus-only features (e.g. M05 camera variant menu).
    try {
      const w = (job.wardrobe || {}) as any;
      const focusEntryWithKey = (['shoe', 'top', 'bottom'] as const)
        .map(k => ({ slot: k, v: w[k] }))
        .find(x => x.v?.isFocus);
      if (focusEntryWithKey?.v?.itemId) {
        job.focusSlot = focusEntryWithKey.slot;
        const item = await getWardrobeItem(focusEntryWithKey.v.itemId) as any;
        if (item) {
          const front = item.fitModels?.front || item.flatFrontUrl;
          if (front) job.focusFitModelFrontUrl = front;
        }
      }
    } catch { /* non-blocking */ }

    return NextResponse.json({ job, shots });
  } catch (error) {
    console.error('Error fetching job:', error);
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 });
  }
}

// DELETE /api/jobs/[id] — permanently delete job + all associated shots & modifications
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = await getJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    // Release queue slot / remove from queue BEFORE deleting the job
    try {
      await releaseSlot(id);
      await removeFromQueue(id);
    } catch { /* non-blocking — job may not be in queue */ }

    await deleteJob(id);
    console.log(`[Jobs] Deleted job ${id} and all associated data (queue cleaned up)`);
    return NextResponse.json({ success: true, deleted: id });
  } catch (error) {
    console.error('Error deleting job:', error);
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 });
  }
}

// PATCH /api/jobs/[id] — update job fields (e.g. archive/unarchive)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { archived, clearGarmentDNA, jobName } = body;

    if (archived !== undefined) {
      await archiveJob(id, archived);
    }

    // Update job name
    if (jobName !== undefined) {
      await updateJob(id, { jobName, updatedAt: new Date() });
      console.log(`[Jobs] Updated jobName for job ${id} to "${jobName}"`);
    }

    // Clear cached garment DNA so next generation re-analyzes
    if (clearGarmentDNA) {
      await jobsCol.doc(id).update({
        garmentDna: FieldValue.delete(),
      });
      console.log(`[Jobs] Cleared garmentDNA cache for job ${id}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating job:', error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}
