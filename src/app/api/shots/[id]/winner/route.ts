/**
 * POST /api/shots/[id]/winner
 *
 * Toggles the `isWinner` flag on a shot. Used by the new /v2 views
 * (chronological feed, tile modal, job detail) to let reviewers star
 * the current version of a shot as the picked winner.
 *
 * Body: { isWinner: boolean }
 *
 * Response: { success: true, isWinner: boolean }
 *
 * 2026-05-27 (Phase 1 of dashboard redesign).
 */
import { NextRequest, NextResponse } from 'next/server';
import { shotsCol } from '@/lib/firestore';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const isWinner = body.isWinner === true;

    const shotDoc = await shotsCol.doc(id).get();
    if (!shotDoc.exists) {
      return NextResponse.json({ error: 'Shot not found' }, { status: 404 });
    }

    await shotsCol.doc(id).update({
      isWinner,
      updatedAt: new Date(),
    });

    return NextResponse.json({ success: true, isWinner });
  } catch (error) {
    console.error('[Winner] Failed to toggle:', error);
    return NextResponse.json({ error: 'Failed to update winner state' }, { status: 500 });
  }
}
