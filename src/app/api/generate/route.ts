/**
 * Shot generation endpoint — v2 Pro pipeline.
 *
 * Single-pass generation via Gemini 3 Pro at native 4K.
 * Prompts loaded from golden vault .md files.
 * Silhouette analysis via Flash Lite.
 * Shot dependency chain: M03 → M04 → M01/M02 → M05.
 */
import { NextRequest, NextResponse } from 'next/server';
import { updateShot, getJob, updateJob, shotsCol, listShots, updateJobStatus } from '@/lib/firestore';
import { uploadGeneratedImage } from '@/lib/gcs';
import { generateShot, type GenerationContext } from '@/lib/pipeline/generate';
import { loadPrompt } from '@/lib/pipeline/prompt-loader';
import type { ShotType } from '@/types';

export async function POST(req: NextRequest) {
  let shotId: string | undefined;
  try {
    const body = await req.json();
    const { shotId: shotIdParsed, jobId, shotType } = body;
    shotId = shotIdParsed;

    if (!shotId || !jobId || !shotType) {
      return NextResponse.json(
        { error: 'Missing required fields: shotId, jobId, shotType' },
        { status: 400 }
      );
    }

    // Progress reporter
    const reportProgress = async (step: string, pct: number) => {
      try {
        await shotsCol.doc(shotId!).update({
          progressStep: step,
          progressPct: pct,
          updatedAt: new Date(),
        });
      } catch { /* non-blocking */ }
    };

    await updateShot(shotId, { status: 'generating' });
    await reportProgress('Loading job context', 5);

    // Load job data
    const job = await getJob(jobId) as any;
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // Load prompt from golden vault
    await reportProgress('Loading prompt', 8);
    const prompt = await loadPrompt(shotType as ShotType);

    // Build generation context
    const ctx: GenerationContext = {
      wardrobe: job.wardrobe,
      modelId: job.modelId,
      silhouette: job.silhouetteAnalysis || { front: '', back: '' },
      m03AnchorUrl: job.m03AnchorUrl,
      m04AnchorUrl: job.m04AnchorUrl,
    };

    await reportProgress('Generating image', 15);

    // Generate the shot
    const result = await generateShot(shotType as ShotType, ctx, prompt);

    console.log(`[Generate] ${shotType} generated successfully (${result.imageData.length} bytes)`);
    await reportProgress('Uploading image', 85);

    // Upload to GCS
    const version = body.version || 1;
    const filename = `${job.modelId}_${shotType}_v${version}.png`;
    const jobName = job.jobName || job.jobId;
    const imageUrl = await uploadGeneratedImage(jobName, filename, result.imageData);

    // Version history
    try {
      const currentShotDoc = await shotsCol.doc(shotId).get();
      const currentData = currentShotDoc.data();
      if (currentData?.imageUrl && currentData.imageUrl !== imageUrl) {
        const prev = currentData.previousVersions || [];
        prev.push({
          imageUrl: currentData.imageUrl,
          version: currentData.version || 1,
          createdAt: currentData.updatedAt || new Date(),
        });
        await shotsCol.doc(shotId).update({ previousVersions: prev });
      }
    } catch (vhErr) {
      console.error(`[Generate] Version history save failed:`, vhErr);
    }

    // Save anchor URLs for dependency chain
    if (shotType === 'M03') {
      await updateJob(jobId, { m03AnchorUrl: imageUrl });
      console.log(`[Generate] M03 anchor saved`);
    } else if (shotType === 'M04') {
      await updateJob(jobId, { m04AnchorUrl: imageUrl });
      console.log(`[Generate] M04 anchor saved`);
    }

    // Update shot record
    await updateShot(shotId, {
      status: 'done',
      imageUrl,
      version,
      progressStep: '',
      progressPct: 100,
    });

    // Check if all shots done → move job to 'review'
    try {
      const allShots = await listShots(jobId);
      const allDone = allShots.length > 0 && allShots.every(
        (s: any) => s.status === 'done' || s.status === 'approved'
      );
      if (allDone) {
        await updateJobStatus(jobId, 'review');
        console.log(`[Generate] All shots done — job ${jobId} moved to review`);
      }
    } catch (statusErr) {
      console.error('[Generate] Job status check failed:', statusErr);
    }

    return NextResponse.json({
      success: true,
      shotId,
      imageUrl,
      filename,
    });

  } catch (error) {
    console.error('[Generate] Error:', error);

    try {
      if (shotId) await updateShot(shotId, { status: 'failed' });
    } catch { /* ignore */ }

    return NextResponse.json(
      { error: 'Generation failed', details: String(error) },
      { status: 500 }
    );
  }
}
