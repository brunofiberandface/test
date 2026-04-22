/**
 * Shot generation endpoint — v3 multi-pass pipeline.
 *
 * Full-body shots (M03/M04) use a 5-pass pipeline:
 *   Phase 1 — Dressed base with foot proportion correction:
 *     Pass 1: Flash generate model + shoes (minimal refs → better proportions)
 *     Pass 2: Sharp foot resize (shrink oversized feet)
 *     Pass 3: Flash heal ankle alignment (fix Sharp artifacts)
 *     Pass 4: Sharp background warm grey correction
 *   Phase 2 — Final garment generation:
 *     Pass 5: Flash generate with dressed base anchor + garment refs
 *
 * Cropped/detail shots (M01/M02/M05) use single-pass as before.
 * Shot dependency chain: M03 → M04 → M01/M02 → M05.
 */
import { NextRequest, NextResponse } from 'next/server';
import { updateShot, getJob, updateJob, shotsCol, listShots, updateJobStatus } from '@/lib/firestore';
import { uploadGeneratedImage } from '@/lib/gcs';
import { generateShot, generateM03WithDressedBase, generateM04WithDressedBase, getDressedBaseInputs, type GenerationContext } from '@/lib/pipeline/generate';
import { generateSeedreamShot, type SeedreamGenerationContext } from '@/lib/pipeline/seedream-generate';
import { applyTeeEdit, needsTeeEdit } from '@/lib/pipeline/seedream-tee-edit';
import { loadPrompt, loadPromptById } from '@/lib/pipeline/prompt-loader';
import { footResize } from '@/lib/pipeline/foot-resize';
import { generateDressedBase } from '@/lib/pipeline/dressed-base-pipeline';
import { APP_CONFIG } from '@/lib/config';
import { applyAutoHybridLabel } from '@/lib/label-auto';
import type { ShotType, GenerationProvider } from '@/types';

export async function POST(req: NextRequest) {
  let shotId: string | undefined;
  try {
    const body = await req.json();
    const { shotId: shotIdParsed, jobId, shotType, alternativePromptId, alternativePromptLabel, useDressedBase, apiKey } = body;
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

    // ── Resolve generation provider ─────────────────────────────────────
    // Precedence: shot.provider (per-shot override) > job.provider > 'gemini'.
    // Per-shot override is what the "Rerun with Seedream" button sets.
    const shotSnapshot = await shotsCol.doc(shotId).get();
    const shotData = shotSnapshot.data() as any;
    const provider: GenerationProvider =
      shotData?.provider || job?.provider || 'gemini';
    console.log(`[Generate] ${shotType} using provider=${provider}`);

    // Load prompt — use alternative if specified, otherwise golden vault
    // Pass pipeline so Seedream jobs get Seedream-specific prompts from the vault
    await reportProgress('Loading prompt', 8);
    const pipeline: 'gemini' | 'seedream' | undefined = provider === 'seedream' ? 'seedream' : undefined;
    const prompt = alternativePromptId
      ? await loadPromptById(alternativePromptId)
      : await loadPrompt(shotType as ShotType, undefined, pipeline);
    if (alternativePromptId) {
      console.log(`[Generate] Using alternative prompt: ${alternativePromptLabel || alternativePromptId}`);
    }

    // Build generation context
    const ctx: GenerationContext = {
      wardrobe: job.wardrobe,
      modelId: job.modelId,
      silhouette: job.silhouetteAnalysis || { front: '', back: '' },
      m03AnchorUrl: job.m03AnchorUrl,
      m04AnchorUrl: job.m04AnchorUrl,
      apiKey,
    };

    let finalImageData: Buffer;

    if (provider === 'seedream') {
      // ── Seedream 4.5 path — single-pass for all shots, no dressed base ──
      // Uses the SAME prompts as Gemini; ref images passed as public GCS URLs.
      // Label composite (below) still runs on M02/M04 Seedream output.
      await reportProgress('Generating image (Seedream)', 15);
      const seedreamCtx: SeedreamGenerationContext = {
        wardrobe: job.wardrobe,
        modelId: job.modelId,
        silhouette: job.silhouetteAnalysis || { front: '', back: '' },
        m03AnchorUrl: job.m03AnchorUrl,
        m04AnchorUrl: job.m04AnchorUrl,
        apiKey: process.env.BYTEPLUS_API_KEY,
      };
      const result = await generateSeedreamShot(shotType as ShotType, seedreamCtx, prompt);
      console.log(`[Generate] ${shotType} Seedream generated (${result.imageData.length} bytes)`);
      finalImageData = result.imageData;

      // ── Gemini tee-edit: replace sports bra with real top (M01-M04 only) ──
      // Seedream renders with a sports bra to avoid body seam artifacts.
      // Gemini then paints the real top using the flat image + Opus description.
      if (needsTeeEdit(shotType as ShotType)) {
        await reportProgress('Painting real top (Gemini)', 45);
        const teeResult = await applyTeeEdit({
          sourceImage: finalImageData,
          wardrobe: job.wardrobe,
          shotType: shotType as ShotType,
          apiKey,
        });
        if (teeResult.edited) {
          console.log(`[Generate] ${shotType} tee-edit applied (${teeResult.imageData.length} bytes)`);
          finalImageData = teeResult.imageData;
        } else {
          console.log(`[Generate] ${shotType} tee-edit skipped (no top in wardrobe or missing refs)`);
        }
      }
    } else {
      // ── Gemini path (production default) — dressed base for M03/M04, single-pass others ──
      const isFullBody = shotType === 'M03' || shotType === 'M04';
      if (isFullBody) {
        console.log(`[Generate] ${shotType} using dressed base pipeline`);
        const view = shotType === 'M03' ? 'front' as const : 'back' as const;

        // Phase 1: Generate dressed base with corrected foot proportions
        await reportProgress('Generating dressed base', 10);
        const dressedBaseInputs = await getDressedBaseInputs(ctx);

        const dressedBase = await generateDressedBase({
          modelRefImage: dressedBaseInputs.modelRefImage,
          shoesRefImage: dressedBaseInputs.shoesRefImage,
          shoesDescription: dressedBaseInputs.shoesDescription,
          view,
          aspectRatio: prompt.aspectOverride || APP_CONFIG.shots[shotType as keyof typeof APP_CONFIG.shots].aspect,
          openShoes: dressedBaseInputs.openShoes,
          apiKey,
          onProgress: reportProgress,
        });

        console.log(`[Generate] ${shotType} dressed base ready (${(dressedBase.timings.total / 1000).toFixed(1)}s)`);

        // Phase 2: Generate final image with dressed base + garment refs
        await reportProgress('Generating final image', 58);

        const result = shotType === 'M03'
          ? await generateM03WithDressedBase(ctx, prompt, dressedBase.imageData)
          : await generateM04WithDressedBase(ctx, prompt, dressedBase.imageData);

        console.log(`[Generate] ${shotType} final image generated (${result.imageData.length} bytes)`);
        finalImageData = result.imageData;

      } else {
        // ── Standard single-pass generation ──
        await reportProgress('Generating image', 15);
        const result = await generateShot(shotType as ShotType, ctx, prompt);
        console.log(`[Generate] ${shotType} generated successfully (${result.imageData.length} bytes)`);
        finalImageData = result.imageData;
      }
    }

    // ── Auto hybrid leather-label composite (3-tier, Option B) ─────────────
    // Pocket anchor homography + saved corners from labelStyles → shader.
    // Only runs for M02/M04, requires ENABLE_HYBRID_LABEL_AUTO != 0 and a
    // complete {template, style, colorway} triple. All failure modes skip
    // silently and return the original image — see src/lib/label-auto.ts.
    // Rollback: set ENABLE_HYBRID_LABEL_AUTO=0 on the Cloud Run service.
    if (shotType === 'M02' || shotType === 'M04') {
      await reportProgress('Applying leather label', 78);
      finalImageData = await applyAutoHybridLabel({
        imageBuffer: finalImageData,
        shotType: shotType as ShotType,
        job,
      });
    }

    await reportProgress('Uploading image', 85);

    // Upload to GCS
    const version = body.version || 1;
    const filename = `${job.modelId}_${shotType}_v${version}.png`;
    const jobName = job.jobName || job.jobId;
    const imageUrl = await uploadGeneratedImage(jobName, filename, finalImageData);

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
          // Remember which backend produced the previous version so "restore"
          // makes clear whether it was a Gemini or Seedream image.
          ...(currentData.provider ? { provider: currentData.provider } : {}),
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
      provider,  // stamp which backend produced this version
      ...(alternativePromptId ? { alternativePromptId, alternativePromptLabel: alternativePromptLabel || '' } : {}),
      ...(useDressedBase ? { usedDressedBase: true } : {}),
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
