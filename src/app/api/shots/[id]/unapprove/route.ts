import { NextRequest, NextResponse } from 'next/server';
import { updateShot, shotsCol, updateJobStatus, listShots, jobsCol } from '@/lib/firestore';

/**
 * POST /api/shots/[id]/unapprove
 *
 * Toggle the inverse of approve: reverts an approved shot back to 'done' so
 * the operator can re-evaluate. If the parent job is 'complete' (all shots
 * had been approved), bumps the job back to 'review' so it shows up correctly
 * on the dashboard again.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await updateShot(id, { status: 'done' });

    // If the parent job is 'complete', revert to 'review' since not all shots
    // are approved anymore.
    try {
      const shotDoc = await shotsCol.doc(id).get();
      const jobId = shotDoc.data()?.jobId;
      if (jobId) {
        const jobDoc = await jobsCol.doc(jobId).get();
        const jobStatus = jobDoc.data()?.status;
        if (jobStatus === 'complete' || jobStatus === 'completed' || jobStatus === 'done') {
          const allShots = await listShots(jobId);
          const allApproved = allShots.length > 0 && allShots.every((s: any) => s.status === 'approved');
          if (!allApproved) {
            await updateJobStatus(jobId, 'review');
            console.log(`[Unapprove] Reverted job ${jobId} to 'review' (not all shots approved)`);
          }
        }
      }
    } catch (statusErr) {
      console.error('[Unapprove] Job status check failed (non-blocking):', statusErr);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error unapproving shot:', error);
    return NextResponse.json({ error: 'Failed to unapprove' }, { status: 500 });
  }
}
