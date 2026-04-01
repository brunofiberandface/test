import { NextRequest, NextResponse } from 'next/server';
import { createComment, listComments, listUsers, getJob } from '@/lib/firestore';
import { sendCommentNotification } from '@/lib/email';

// GET /api/comments?jobId=xxx — list all comments for a job
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 });
  }
  try {
    const comments = await listComments(jobId);
    return NextResponse.json({ comments });
  } catch (error) {
    console.error('[Comments] List failed:', error);
    return NextResponse.json({ error: 'Failed to list comments' }, { status: 500 });
  }
}

// POST /api/comments — create a new comment + notify other thread participants
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jobId, shotId, shotType, authorEmail, authorName, text } = body;

    if (!jobId || !authorEmail || !text?.trim()) {
      return NextResponse.json({ error: 'jobId, authorEmail, and text are required' }, { status: 400 });
    }

    // Save comment
    const comment = await createComment({
      jobId,
      shotId: shotId || null,
      shotType: shotType || null,
      authorEmail,
      authorName: authorName || authorEmail.split('@')[0],
      text: text.trim(),
    });

    // Notify other participants in the thread
    // Collect unique emails: all commenters on this job + all admin users
    try {
      const [existingComments, allUsers, job] = await Promise.all([
        listComments(jobId),
        listUsers(),
        getJob(jobId),
      ]);

      const jobName = (job as any)?.jobName || (job as any)?.designNumber || jobId;

      // Unique emails from thread participants + admins, excluding the author
      const recipientSet = new Set<string>();
      existingComments.forEach((c: any) => {
        if (c.authorEmail && c.authorEmail !== authorEmail) {
          recipientSet.add(c.authorEmail);
        }
      });
      // Also notify admins who haven't commented
      allUsers.forEach((u: any) => {
        if (u.role === 'admin' && u.email !== authorEmail && u.active !== false) {
          recipientSet.add(u.email);
        }
      });

      const recipients = Array.from(recipientSet);
      if (recipients.length > 0) {
        // Fire and forget — don't block the response
        sendCommentNotification({
          recipients,
          authorName: authorName || authorEmail.split('@')[0],
          authorEmail,
          jobName,
          jobId,
          shotType: shotType || undefined,
          commentText: text.trim(),
        }).catch(err => console.error('[Comments] Notification error:', err));
      }
    } catch (notifyErr) {
      console.error('[Comments] Notification setup failed (non-blocking):', notifyErr);
    }

    return NextResponse.json({ comment });
  } catch (error) {
    console.error('[Comments] Create failed:', error);
    return NextResponse.json({ error: 'Failed to create comment' }, { status: 500 });
  }
}
