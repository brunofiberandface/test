import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from '@google-cloud/firestore';
import { shotsCol, updateJobStatus, listShots } from '@/lib/firestore';

// POST /api/shots/[id]/approve
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Approve + clear wasApproved (set during rerun to flag "previously approved").
    // Direct doc().update() so FieldValue.delete is accepted (updateShot's
    // typed signature doesn't model the field).
    await shotsCol.doc(id).update({
      status: 'approved',
      wasApproved: FieldValue.delete(),
      updatedAt: new Date(),
    });

    // Check if all shots for the job are now approved → mark job complete
    try {
      const shotDoc = await shotsCol.doc(id).get();
      const jobId = shotDoc.data()?.jobId;
      if (jobId) {
        const allShots = await listShots(jobId);
        const allApproved = allShots.length > 0 && allShots.every((s: any) => s.status === 'approved');
        if (allApproved) {
          await updateJobStatus(jobId, 'complete');
          console.log(`[Approve] All shots approved — job ${jobId} marked complete`);
        } else {
          // Ensure job is at least in 'review' (not stuck on 'generating')
          const jobDoc = await (await import('@/lib/firestore')).jobsCol.doc(jobId).get();
          const jobStatus = jobDoc.data()?.status;
          if (jobStatus === 'generating' || jobStatus === 'uploading') {
            await updateJobStatus(jobId, 'review');
          }
        }
      }
    } catch (statusErr) {
      console.error('[Approve] Job status check failed (non-blocking):', statusErr);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error approving shot:', error);
    return NextResponse.json({ error: 'Failed to approve' }, { status: 500 });
  }
}
