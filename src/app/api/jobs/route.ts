import { NextRequest, NextResponse } from 'next/server';
import { createJob, listJobs, getJob, createShot, updateJobStatus, jobsCol, wardrobeCol, createWardrobeItem } from '@/lib/firestore';
import { buildGenerationPrompt } from '@/lib/prompts';
import { SHOT_DESCRIPTIONS } from '@/lib/config';
import { uploadGarmentImage } from '@/lib/gcs';

// Maps garment category → wardrobe category (for auto-save)
const GARMENT_TO_WARDROBE: Record<string, string> = {
  pants: 'pants',
  jackets: 'jacket',
  tops: 'shirt',
  knitwear: 'shirt',
};

// GET /api/jobs — list jobs (filtered by creator for non-admins)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const includeArchived = searchParams.get('includeArchived') === 'true';

    const allJobs = await listJobs();
    // Filter out archived jobs unless explicitly requested
    const jobs = includeArchived ? allJobs : allJobs.filter((j: any) => !j.archived);

    // ── Auto-fix any jobs stuck on 'generating'/'uploading' ──
    // Check shots for stuck jobs and update status. Run in parallel, non-blocking.
    const stuckJobs = jobs.filter((j: any) => j.status === 'generating' || j.status === 'uploading');
    if (stuckJobs.length > 0) {
      const { listShots, updateJobStatus } = await import('@/lib/firestore');
      await Promise.all(stuckJobs.map(async (job: any) => {
        try {
          const jobId = job.jobId || job.id;
          const shots = await listShots(jobId);
          if (shots.length === 0) return;
          const allApproved = shots.every((s: any) => s.status === 'approved');
          const allTerminal = shots.every((s: any) => s.status === 'done' || s.status === 'approved');
          if (allApproved) {
            await updateJobStatus(jobId, 'complete');
            job.status = 'complete';
          } else if (allTerminal) {
            await updateJobStatus(jobId, 'review');
            job.status = 'review';
          }
        } catch { /* non-blocking */ }
      }));
    }

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('Error listing jobs:', error);
    return NextResponse.json({ error: 'Failed to list jobs' }, { status: 500 });
  }
}

// POST /api/jobs — create a new generation job
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      designNumber,
      jobName,
      creatorEmail,
      garmentCategory,
      description,
      metadata,
      modelIds,
      modelDescriptions,
      // NEW: garment images as base64
      flatImageBase64,      // base64 encoded flat product image
      flatImageMimeType,    // e.g. "image/jpeg"
      images360Base64,      // array of base64 encoded 360° images (optional, send best few)
      wardrobeItemIds,      // { shoes?: id, shirt?: id, jacket?: id, pants?: id }
      // Passthrough: pre-existing GCS URLs (e.g. from wardrobe picker — skip re-upload)
      flatFrontUrl: flatFrontUrlPassthrough,
      flatBackUrl: flatBackUrlPassthrough,
      flatImageUrl: flatImageUrlPassthrough, // legacy compat
    } = body;

    if (!designNumber || !garmentCategory || !description || !modelIds?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Upload flat front image to GCS if provided, or use passthrough GCS URL directly
    let flatFrontUrl = flatFrontUrlPassthrough || flatImageUrlPassthrough || '';
    if (!flatFrontUrl && flatImageBase64) {
      const flatBuffer = Buffer.from(flatImageBase64, 'base64');
      const mime = flatImageMimeType || 'image/jpeg';
      const ext = mime.includes('png') ? 'png' : 'jpg';
      flatFrontUrl = await uploadGarmentImage(
        designNumber, 'flat', `flat_front.${ext}`, flatBuffer, mime
      );
      console.log(`[Job] Flat front image uploaded: ${flatFrontUrl}`);
    }
    let flatBackUrl = flatBackUrlPassthrough || '';

    // Create job with garment image URLs
    const jobId = await createJob({
      designNumber,
      jobName: jobName || designNumber,
      creatorEmail,
      garmentCategory,
      description,
      metadata: metadata || {},
      modelIds,
    });

    // Store garment image URLs and wardrobe selections on the job document
    const jobUpdate: Record<string, any> = {};
    if (flatFrontUrl) jobUpdate.flatFrontUrl = flatFrontUrl;
    if (flatBackUrl) jobUpdate.flatBackUrl = flatBackUrl;
    if (wardrobeItemIds && Object.keys(wardrobeItemIds).length > 0) {
      jobUpdate.wardrobeItemIds = wardrobeItemIds;
    }
    if (Object.keys(jobUpdate).length > 0) {
      await jobsCol.doc(jobId).update(jobUpdate);
    }

    // ── Auto-save garment as wardrobe item ──
    // When images are uploaded, automatically create/update a wardrobe item
    // so the garment can be reused across future jobs without re-uploading.
    const wardrobeCategory = GARMENT_TO_WARDROBE[garmentCategory];
    if (wardrobeCategory && flatFrontUrl) {
      try {
        // Check if a wardrobe item for this design number already exists
        const existing = await wardrobeCol
          .where('name', '==', designNumber)
          .limit(1)
          .get();

        if (existing.empty) {
          // Create new wardrobe item using the already-uploaded GCS URLs (no re-upload)
          const garmentWardrobeId = await createWardrobeItem({
            name: designNumber,
            category: wardrobeCategory,
            description: description.slice(0, 400),
            fitModelUrls: [],
            flatFrontUrl: flatFrontUrl || undefined,
            flatBackUrl: flatBackUrl || undefined,
            thumbnailUrl: flatFrontUrl || '',
          });
          await jobsCol.doc(jobId).update({ garmentWardrobeId });
          console.log(`[Job] Auto-created wardrobe item ${garmentWardrobeId} for ${designNumber}`);
        } else {
          // Update existing item with fresh images if we have them
          const existingId = existing.docs[0].id;
          const wardrobeUpdate: Record<string, any> = { updatedAt: new Date() };
          if (flatFrontUrl) {
            wardrobeUpdate.flatFrontUrl = flatFrontUrl;
            wardrobeUpdate.thumbnailUrl = flatFrontUrl;
          }
          if (flatBackUrl) wardrobeUpdate.flatBackUrl = flatBackUrl;
          await wardrobeCol.doc(existingId).update(wardrobeUpdate);
          await jobsCol.doc(jobId).update({ garmentWardrobeId: existingId });
          console.log(`[Job] Updated wardrobe item ${existingId} for ${designNumber}`);
        }
      } catch (wardrobeErr) {
        // Non-blocking — wardrobe failure must not break job creation
        console.error('[Job] Auto-wardrobe save failed (non-blocking):', wardrobeErr);
      }
    }

    // Create shot records for each model × shot type
    const shotIds: string[] = [];
    for (const modelId of modelIds) {
      const modelDesc = modelDescriptions?.[modelId] || '';

      for (const [shotKey, shotDescription] of Object.entries(SHOT_DESCRIPTIONS)) {
        const shotType = shotKey.replace('-A', '').replace('-B', '');
        const variant = shotKey.includes('-B') ? 'B' : 'A';

        const prompt = buildGenerationPrompt({
          modelDescription: modelDesc,
          garmentDescription: description,
          shotDescription,
          garmentCategory,
          metadata: metadata || {},
          shotType,
        });

        const shotId = await createShot({
          jobId,
          modelId,
          shotType,
          variant,
          prompt,
        });
        shotIds.push(shotId);
      }
    }

    // Update job status to generating
    await updateJobStatus(jobId, 'generating');

    // Generation is now triggered by the results page (client-driven orchestration).
    // The results page polls every 8s and triggers /api/generate for queued shots
    // one at a time. This avoids the Cloud Run container termination issue with setTimeout.
    console.log(`[Job] Created ${shotIds.length} shots for job ${jobId}. Generation will be triggered by the results page.`);

    return NextResponse.json({
      success: true,
      jobId,
      shotsCreated: shotIds.length,
    });
  } catch (error) {
    console.error('Error creating job:', error);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }
}
