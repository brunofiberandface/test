import { NextRequest, NextResponse } from 'next/server';
import { createJob, listJobs, getJob, createShot, updateJobStatus, jobsCol, wardrobeCol, createWardrobeItem, enqueueJob } from '@/lib/firestore';
import { buildGenerationPrompt } from '@/lib/prompts';
import { SHOT_DESCRIPTIONS } from '@/lib/config';
import { uploadGarmentImage } from '@/lib/gcs';

function getInternalBase(): string {
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

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

    // v40: modelIds no longer required — generation uses generic body, not specific models
    if (!designNumber || !garmentCategory || !description) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    // Default to a placeholder model ID if none provided (v40: no model selection)
    const effectiveModelIds = modelIds?.length ? modelIds : ['generic'];

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
      modelIds: effectiveModelIds,
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
    // v40: Only M03 is queued — all others are held until user activates them
    const shotIds: string[] = [];
    for (const modelId of effectiveModelIds) {
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

        // v40: ONLY M03 generates immediately — everything else waits for user activation
        const initialStatus = shotType === 'M03' ? 'queued' : 'held';

        const shotId = await createShot({
          jobId,
          modelId,
          shotType,
          variant,
          prompt,
          status: initialStatus,
        });
        shotIds.push(shotId);
      }
    }

    // Update job status to generating
    await updateJobStatus(jobId, 'generating');

    // Enqueue the job in the worker queue and kick the worker
    const jName = (jobName || designNumber) as string;
    const enqueueResult = await enqueueJob(jobId, jName);
    console.log(`[Job] Enqueued job ${jobId} ("${jName}"): slot=${enqueueResult.slot}, position=${enqueueResult.position}`);

    console.log(`[Job] Created ${shotIds.length} shots for job ${jobId}. Kicking worker...`);

    // v37: Respond to client FIRST, then kick worker.
    // The worker kick is a separate internal request that keeps the Cloud Run container alive.
    // We must NOT await it here — process-queue blocks until generation completes (minutes).
    // Using fetch().catch() is safe here because the RESPONSE has already been sent,
    // and the internal fetch creates a new request that keeps the container running.
    const response = NextResponse.json({
      success: true,
      jobId,
      shotsCreated: shotIds.length,
    });

    // Fire the worker kick AFTER building the response — don't await it
    fetch(`${getInternalBase()}/api/jobs/process-queue`, { method: 'POST' })
      .then(res => console.log(`[Job] Worker kick response: ${res.status}`))
      .catch(err => console.warn(`[Job] Worker kick failed (non-blocking):`, err));

    return response;
  } catch (error) {
    console.error('Error creating job:', error);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }
}
