import { NextRequest, NextResponse } from 'next/server';
import { getJob, listJobs, jobsCol, createShot, updateJobStatus } from '@/lib/firestore';
import { buildGenerationPrompt } from '@/lib/prompts';
import { SHOT_DESCRIPTIONS } from '@/lib/config';

// POST /api/jobs/[id]/clone — clone a job with auto-incremented name
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const original = await getJob(id) as any;
    if (!original) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    const baseName = original.designNumber || 'Job';

    // Strip existing " Clone N" suffix to get the true base name
    const cleanBase = baseName.replace(/ Clone \d+$/, '');

    // Find the highest existing clone number for this base name
    const allJobs = await listJobs();
    const clonePattern = new RegExp(`^${cleanBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} Clone (\\d+)$`);
    let maxClone = 0;
    for (const j of allJobs as any[]) {
      const match = (j.designNumber || '').match(clonePattern);
      if (match) maxClone = Math.max(maxClone, parseInt(match[1], 10));
    }
    const cloneName = `${cleanBase} Clone ${maxClone + 1}`;

    // Create the cloned job document
    const ref = jobsCol.doc();
    const newJobId = ref.id;
    await ref.set({
      jobId: newJobId,
      designNumber: cloneName,
      creatorEmail: original.creatorEmail || '',
      garmentCategory: original.garmentCategory || 'pants',
      description: original.description || '',
      metadata: original.metadata || {},
      modelIds: original.modelIds || [],
      flatImageUrl: original.flatImageUrl || '',
      image360Urls: original.image360Urls || [],
      wardrobeItemIds: original.wardrobeItemIds || {},
      status: 'generating',
      clonedFrom: id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create shot records for each model × shot type (same as original job creation)
    const modelDescriptions: Record<string, string> = original.modelDescriptions || {};
    for (const modelId of (original.modelIds || [])) {
      const modelDesc = modelDescriptions[modelId] || '';
      for (const [shotKey, shotDescription] of Object.entries(SHOT_DESCRIPTIONS)) {
        const shotType = shotKey.replace('-A', '').replace('-B', '');
        const variant = shotKey.includes('-B') ? 'B' : 'A';
        const prompt = buildGenerationPrompt({
          modelDescription: modelDesc,
          garmentDescription: original.description || '',
          shotDescription: shotDescription as string,
          garmentCategory: original.garmentCategory || 'pants',
          metadata: original.metadata || {},
          shotType,
        });
        await createShot({ jobId: newJobId, modelId, shotType, variant, prompt });
      }
    }

    return NextResponse.json({ success: true, jobId: newJobId, designNumber: cloneName });
  } catch (error) {
    console.error('Clone error:', error);
    return NextResponse.json({ error: 'Clone failed' }, { status: 500 });
  }
}
