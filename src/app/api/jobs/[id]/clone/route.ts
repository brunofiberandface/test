/**
 * POST /api/jobs/[id]/clone — clone a job (v2 Pro pipeline).
 * Copies wardrobe selections, model, and prompt revisions from the original.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getJob, listJobs, jobsCol, createShot, updateJobStatus, getActivePrompt, enqueueJob } from '@/lib/firestore';
import { APP_CONFIG } from '@/lib/config';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const original = await getJob(id) as any;
    if (!original) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    const baseName = original.jobName || 'Job';
    const cleanBase = baseName.replace(/ Clone \d+$/, '');

    // Find highest clone number
    const allJobs = await listJobs();
    const clonePattern = new RegExp(`^${cleanBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} Clone (\\d+)$`);
    let maxClone = 0;
    for (const j of allJobs as any[]) {
      const match = (j.jobName || '').match(clonePattern);
      if (match) maxClone = Math.max(maxClone, parseInt(match[1], 10));
    }
    const cloneName = `${cleanBase} Clone ${maxClone + 1}`;

    // Get current active prompt revisions
    const promptRevisions: Record<string, number> = {};
    for (const st of APP_CONFIG.shotTypes) {
      const active = await getActivePrompt(st);
      promptRevisions[st] = active?.revision || 1;
    }

    // Create cloned job
    const ref = jobsCol.doc();
    const newJobId = ref.id;
    await ref.set({
      jobId: newJobId,
      jobName: cloneName,
      creatorEmail: original.creatorEmail || '',
      modelId: original.modelId || '',
      wardrobe: original.wardrobe || {},
      promptRevisions,
      status: 'pending',
      clonedFrom: id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create shot records
    for (const shotType of APP_CONFIG.shotTypes) {
      await createShot({
        jobId: newJobId,
        modelId: original.modelId || '',
        shotType,
        prompt: '',
        promptRevision: promptRevisions[shotType],
        status: 'pending',
      });
    }

    // Enqueue + kick worker (respond-then-fire pattern)
    await updateJobStatus(newJobId, 'generating');
    await enqueueJob(newJobId, cloneName);

    const response = NextResponse.json({ success: true, jobId: newJobId, jobName: cloneName });

    const port = process.env.PORT || '3000';
    fetch(`http://localhost:${port}/api/jobs/process-queue`, { method: 'POST' })
      .then(res => console.log(`[Clone] Worker kick: ${res.status}`))
      .catch(err => console.warn(`[Clone] Worker kick failed (non-blocking):`, err));

    return response;
  } catch (error) {
    console.error('Clone error:', error);
    return NextResponse.json({ error: 'Clone failed' }, { status: 500 });
  }
}
