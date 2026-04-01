import { NextRequest, NextResponse } from 'next/server';
import { getJob, listShots, updateJobStatus, getWardrobeItem, archiveJob, deleteJob, shotsCol } from '@/lib/firestore';

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
    // If job is 'generating'/'uploading' but all shots are in terminal states, advance it
    const stuckStatuses = ['generating', 'uploading'];
    if (stuckStatuses.includes(job.status) && shots.length > 0) {
      const terminalStatuses = ['done', 'approved'];
      const allTerminal = shots.every((s: any) => terminalStatuses.includes(s.status));
      const allApproved = shots.every((s: any) => s.status === 'approved');

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
    await deleteJob(id);
    console.log(`[Jobs] Deleted job ${id} and all associated data`);
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
    const { archived } = body;

    if (archived !== undefined) {
      await archiveJob(id, archived);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating job:', error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}
