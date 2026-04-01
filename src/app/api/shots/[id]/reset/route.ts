import { NextRequest, NextResponse } from 'next/server';
import { shotsCol, jobsCol } from '@/lib/firestore';

/**
 * POST /api/shots/[id]/reset
 *
 * Resets a stuck/failed shot back to 'queued' so run-all can pick it up.
 * Also ensures the parent job is set to 'generating' so run-all triggers.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: shotId } = await params;

  try {
    // Parse optional body (may be empty for legacy callers)
    let incrementVersion = false;
    try {
      const body = await req.json();
      incrementVersion = body?.incrementVersion === true;
    } catch { /* no body — that's fine */ }

    const shotDoc = await shotsCol.doc(shotId).get();
    if (!shotDoc.exists) {
      return NextResponse.json({ error: 'Shot not found' }, { status: 404 });
    }

    const shotData = shotDoc.data() as Record<string, unknown>;
    const currentVersion = (shotData.version as number) || 1;
    const nextVersion = incrementVersion ? currentVersion + 1 : currentVersion;

    // Reset shot to queued — clear stale progress text so UI doesn't show old state
    await shotsCol.doc(shotId).update({
      status: 'queued',
      error: null,
      progressStep: '',
      progressPct: 0,
      version: nextVersion,
      updatedAt: new Date(),
    });

    // Ensure parent job is set to generating (so run-all will fire)
    if (shotData.jobId) {
      try {
        await jobsCol.doc(shotData.jobId as string).update({
          status: 'generating',
          updatedAt: new Date(),
        });
      } catch { /* non-blocking */ }
    }

    return NextResponse.json({ success: true, shotId, status: 'queued' });
  } catch (error) {
    console.error(`[ShotReset] Failed to reset shot ${shotId}:`, error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
