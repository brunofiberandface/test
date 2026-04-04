/**
 * Jobs API — v2 Pro pipeline.
 *
 * GET: List jobs
 * POST: Create job with 3 wardrobe items + focus + model selection
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  createJob, listJobs, createShot, updateJobStatus, updateJob,
  enqueueJob, getActivePrompt, getWardrobeItem,
} from '@/lib/firestore';
import { downloadGarmentImage } from '@/lib/gcs';
import { analyzeSilhouette } from '@/lib/pipeline/silhouette';
import { APP_CONFIG } from '@/lib/config';
import type { ShotType, JobWardrobe, FitModelAngles } from '@/types';
import { normalizeWardrobeItem } from '@/lib/wardrobe-compat';

function getInternalBase(): string {
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

// GET /api/jobs
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const includeArchived = searchParams.get('includeArchived') === 'true';

    const allJobs = await listJobs();
    const jobs = includeArchived ? allJobs : allJobs.filter((j: any) => !j.archived);

    // Auto-fix stuck jobs
    const stuckJobs = jobs.filter((j: any) => j.status === 'generating');
    if (stuckJobs.length > 0) {
      const { listShots } = await import('@/lib/firestore');
      await Promise.all(stuckJobs.map(async (job: any) => {
        try {
          const jobId = job.jobId || job.id;
          const shots = await listShots(jobId);
          if (shots.length === 0) return;
          const allDone = shots.every((s: any) => s.status === 'done' || s.status === 'approved');
          if (allDone) {
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
      jobName,
      creatorEmail,
      modelId,
      wardrobe,  // { shoe: { itemId, isFocus }, top: { itemId, isFocus }, bottom: { itemId, isFocus } }
    } = body;

    if (!creatorEmail || !modelId || !wardrobe) {
      return NextResponse.json({ error: 'Missing required fields: creatorEmail, modelId, wardrobe' }, { status: 400 });
    }

    // Validate wardrobe structure
    const w = wardrobe as JobWardrobe;
    if (!w.shoe?.itemId || !w.top?.itemId || !w.bottom?.itemId) {
      return NextResponse.json({ error: 'Wardrobe must include shoe, top, and bottom items' }, { status: 400 });
    }

    // Ensure exactly one focus
    const focusCount = [w.shoe, w.top, w.bottom].filter(x => x.isFocus).length;
    if (focusCount !== 1) {
      return NextResponse.json({ error: 'Exactly one wardrobe item must be marked as focus' }, { status: 400 });
    }

    // Get active prompt revisions
    const promptRevisions: Record<string, number> = {};
    for (const st of APP_CONFIG.shotTypes) {
      const active = await getActivePrompt(st);
      if (!active) {
        return NextResponse.json(
          { error: `No active prompt found for ${st}. Upload prompts to the vault first.` },
          { status: 400 }
        );
      }
      promptRevisions[st] = active.revision;
    }

    // Create job
    const jobId = await createJob({
      jobName: jobName || `Job ${new Date().toISOString().slice(0, 10)}`,
      creatorEmail,
      modelId,
      wardrobe: w,
      promptRevisions,
    });

    console.log(`[Job] Created job ${jobId}`);

    // ── Run silhouette analysis ──
    // Find the focus garment and download its images
    const focusSlot = Object.entries(w).find(([, v]) => v.isFocus)!;
    const focusItem = await getWardrobeItem(focusSlot[1].itemId) as any;

    const normalized = normalizeWardrobeItem(focusItem);
    if (!normalized || !normalized.flatFrontUrl) {
      return NextResponse.json(
        { error: 'Focus garment must have fit model images and at least a flat front image' },
        { status: 400 }
      );
    }

    const fitModels: FitModelAngles = normalized.fitModels;

    try {
      console.log(`[Job] Running silhouette analysis for ${focusItem.name}...`);

      // Download all 6 fit model images + flats
      const [
        frontBuf, front45LBuf, front45RBuf,
        backBuf, back45LBuf, back45RBuf,
        flatFrontBuf, flatBackBuf,
      ] = await Promise.all([
        downloadGarmentImage(fitModels.front.split('?')[0]),
        downloadGarmentImage(fitModels.front45Left.split('?')[0]),
        downloadGarmentImage(fitModels.front45Right.split('?')[0]),
        downloadGarmentImage(fitModels.back.split('?')[0]),
        downloadGarmentImage(fitModels.back45Left.split('?')[0]),
        downloadGarmentImage(fitModels.back45Right.split('?')[0]),
        downloadGarmentImage(normalized.flatFrontUrl.split('?')[0]),
        normalized.flatBackUrl
          ? downloadGarmentImage(normalized.flatBackUrl.split('?')[0])
          : Promise.resolve(null),
      ]);

      const silhouette = await analyzeSilhouette({
        flatFront: flatFrontBuf,
        flatBack: flatBackBuf,
        frontAngles: [frontBuf, front45LBuf, front45RBuf],
        backAngles: [backBuf, back45LBuf, back45RBuf],
      });

      // Store silhouette results on the job
      await updateJob(jobId, { silhouetteAnalysis: silhouette });
      console.log(`[Job] Silhouette analysis complete`);
    } catch (silErr) {
      console.error(`[Job] Silhouette analysis failed:`, silErr);
      // Continue without silhouette — generation will work but less accurate
      await updateJob(jobId, {
        silhouetteAnalysis: { front: '', back: '' },
        silhouetteError: String(silErr),
      });
    }

    // ── Create shot records ──
    // All 5 shots created as 'pending'. The worker processes them in dependency order.
    const shotIds: string[] = [];
    for (const shotType of APP_CONFIG.shotTypes) {
      const shotId = await createShot({
        jobId,
        modelId,
        shotType,
        prompt: '', // prompt loaded from vault at generation time
        promptRevision: promptRevisions[shotType],
        status: 'pending',
      });
      shotIds.push(shotId);
    }

    // Update job status and enqueue
    await updateJobStatus(jobId, 'generating');
    const enqueueResult = await enqueueJob(jobId, jobName || jobId);
    console.log(`[Job] Enqueued: slot=${enqueueResult.slot}, position=${enqueueResult.position}`);

    // ── Respond then fire worker ──
    const response = NextResponse.json({
      success: true,
      jobId,
      shotsCreated: shotIds.length,
      slot: enqueueResult.slot,
      position: enqueueResult.position,
    });

    // Fire worker kick AFTER building response — DO NOT AWAIT
    fetch(`${getInternalBase()}/api/jobs/process-queue`, { method: 'POST' })
      .then(res => console.log(`[Job] Worker kick: ${res.status}`))
      .catch(err => console.warn(`[Job] Worker kick failed (non-blocking):`, err));

    return response;
  } catch (error) {
    console.error('Error creating job:', error);
    return NextResponse.json({ error: 'Failed to create job', details: String(error) }, { status: 500 });
  }
}
