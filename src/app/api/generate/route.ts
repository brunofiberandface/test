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
import { saveStage, type PipelineStage } from '@/lib/pipeline/stage-recorder';
import { generateShot, generateM03WithDressedBase, generateM04WithDressedBase, getDressedBaseInputs, type GenerationContext } from '@/lib/pipeline/generate';
import { generateSeedreamShot, type SeedreamGenerationContext } from '@/lib/pipeline/seedream-generate';
import { applyTeeEdit, needsTeeEdit } from '@/lib/pipeline/seedream-tee-edit';
// V2 shoe-edit: Imagen 3 inpaint with bottom-strip mask. The V1 (gemini-shoe-edit)
// regenerated pixels and airbrushed denim texture; preserved for reference.
import { applyShoeEdit, needsShoeEdit } from '@/lib/pipeline/imagen-shoe-edit';
import { produceBackdropVariants } from '@/lib/subject-matte';
import { loadPrompt, loadPromptById } from '@/lib/pipeline/prompt-loader';
import { footResize } from '@/lib/pipeline/foot-resize';
import { generateDressedBase } from '@/lib/pipeline/dressed-base-pipeline';
import { APP_CONFIG } from '@/lib/config';
import { applyAutoHybridLabel } from '@/lib/label-auto';
import { getFocusSlot, type ShotType, type GenerationProvider } from '@/types';

export async function POST(req: NextRequest) {
  let shotId: string | undefined;
  try {
    const body = await req.json();
    const { shotId: shotIdParsed, jobId, shotType, alternativePromptId, alternativePromptLabel, useDressedBase, apiKey, seedreamApiKey } = body;
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
    // Recorded on the shot doc so reruns / tee-edit / future audit can tell
    // which Seedream model produced this image. Only set when provider === 'seedream'.
    let usedSeedreamModel: string | undefined;
    // Pipeline-stage debug URLs — populated as each stage runs and written
    // to the shot doc so the UI can show a "Stages" gallery for inspection.
    // Each value is a GCS URL of that stage's intermediate image.
    const pipelineStages: Partial<Record<PipelineStage, string>> = {};
    const recordStage = async (stage: PipelineStage, buf: Buffer) => {
      const url = await saveStage({
        jobName: job.jobName || job.jobId,
        modelId: job.modelId,
        shotType: shotType as string,
        version: body.version || 1,
        stage,
        buffer: buf,
      });
      if (url) pipelineStages[stage] = url;
    };
    // Tee-edit status — written to shot doc so the UI can show a visible
    // warning when the sports-bra→real-tee Gemini step silently failed and
    // the user is looking at a sports-bra image they didn't realize was wrong.
    // undefined = tee-edit not applicable for this shot type / model
    // true      = tee-edit ran and succeeded
    // false     = tee-edit was attempted and failed (see teeEditError)
    let teeEditApplied: boolean | undefined;
    let teeEditError: string | undefined;

    if (provider === 'seedream') {
      // ── Seedream path — single-pass for all shots, no dressed base ──
      // Model selected by SEEDREAM_MODEL env var (4.5 default; flip to 5.0 in
      // Cloud Run console). Optional per-job override via job.seedreamModel.
      // Label composite (below) still runs on M02/M04 Seedream output.
      await reportProgress('Generating image (Seedream)', 15);
      // Precedence: shot.seedreamModel (per-shot rerun) > job.seedreamModel
      // (job-level rerun) > SEEDREAM_MODEL env var default. The "Rerun with
      // Seedream 5.0" button sets shot-level overrides on every shot.
      const seedreamModelOverride =
        (shotData as { seedreamModel?: string })?.seedreamModel ||
        (job as { seedreamModel?: string }).seedreamModel;
      // Focus slot drives several conditional branches (M01/M02 crop framing,
      // tee-edit skip, M04 single-pass routing, sports-bra placeholder skip).
      // Derived once here from job.wardrobe and threaded through the ctx so
      // the seedream-generate path doesn't need to re-derive at each shot.
      const focusSlot = getFocusSlot(job.wardrobe) ?? undefined;
      const seedreamCtx: SeedreamGenerationContext = {
        wardrobe: job.wardrobe,
        modelId: job.modelId,
        silhouette: job.silhouetteAnalysis || { front: '', back: '' },
        m03AnchorUrl: job.m03AnchorUrl,
        m04AnchorUrl: job.m04AnchorUrl,
        apiKey: seedreamApiKey || process.env.BYTEPLUS_API_KEY,
        model: seedreamModelOverride,  // undefined → uses SEEDREAM_MODEL env var default
        m06PoseId: (job as { m06PoseId?: string }).m06PoseId,  // M06-only — undefined falls back to default
        m05TopVariantId: (shotData as { m05TopVariantId?: 'A' | 'B' | 'C' })?.m05TopVariantId,  // M05 top-focus only — undefined = random pick
        m06TopPoseId: (shotData as { m06TopPoseId?: string })?.m06TopPoseId,  // M06 top-focus only — undefined = random pick (t01-t05)
        focusSlot,  // 'top' | 'bottom' | 'shoe' | undefined
      };
      const result = await generateSeedreamShot(shotType as ShotType, seedreamCtx, prompt);
      const usedModel = result.model;  // resolved by seedream-client (override OR env)
      usedSeedreamModel = usedModel;
      console.log(`[Generate] ${shotType} Seedream generated (${result.imageData.length} bytes, model=${usedModel})`);
      finalImageData = result.imageData;

      // M04 two-pass: bubble Pass 1 URL into the gallery. Two-pass already
      // wrote Pass 1 to GCS for Pass 2 to reference by URL; we just record
      // the URL on pipelineStages here (no duplicate upload).
      if (result.pass1Url) {
        pipelineStages['pass1'] = result.pass1Url;
      }

      // ── Gemini tee-edit: replace sports bra with real top (M01-M04 only) ──
      // Seedream 4.5 renders with a sports bra to avoid body seam artifacts.
      // Gemini then paints the real top using the flat image + Opus description.
      // Seedream 5.0+ handles tucked-in tops natively, so tee-edit is skipped.
      if (needsTeeEdit(shotType as ShotType, usedModel, focusSlot)) {
        await reportProgress('Painting real top (Gemini)', 45);

        // Save Seedream pre-tee-edit intermediate to GCS for inspection.
        await recordStage('seedream', finalImageData);

        const teeResult = await applyTeeEdit({
          sourceImage: finalImageData,
          wardrobe: job.wardrobe,
          shotType: shotType as ShotType,
          apiKey,
          focusSlot,
        });
        if (teeResult.edited) {
          console.log(`[Generate] ${shotType} tee-edit applied (${teeResult.imageData.length} bytes)`);
          finalImageData = teeResult.imageData;
          teeEditApplied = true;
          await recordStage('teeedit', finalImageData);
        } else {
          if (teeResult.error) {
            console.error(`[Generate] ${shotType} tee-edit FAILED after retries (Gemini error): ${teeResult.error}`);
            teeEditError = teeResult.error;
          } else {
            console.log(`[Generate] ${shotType} tee-edit skipped (no top in wardrobe or missing refs)`);
          }
          teeEditApplied = false;
        }

        // ── Gemini shoe-edit (post-tee-edit) ──────────────────────────────
        // Repositions the footwear UNDER the cascading hem, extends the hem
        // to floor level. Fixes the "boots fully visible / pants stop at boot
        // top" regression that Seedream cannot resolve via prompting alone
        // (silhouette PART B is hardcoded against bare-feet/sneaker
        // proportions and contradicts tall-boot geometry). Non-blocking: on
        // failure, the tee-edited image is kept as-is.
        if (needsShoeEdit(shotType as ShotType)) {
          const shoeResult = await applyShoeEdit({
            sourceImage: finalImageData,
            wardrobe: job.wardrobe,
            shotType: shotType as ShotType,
            apiKey,
          });
          if (shoeResult.edited) {
            console.log(`[Generate] ${shotType} shoe-edit applied (${shoeResult.imageData.length} bytes)`);
            finalImageData = shoeResult.imageData;
            await recordStage('shoeedit', finalImageData);
          } else if (shoeResult.error) {
            console.error(`[Generate] ${shotType} shoe-edit FAILED after retries: ${shoeResult.error}`);
          } else {
            console.log(`[Generate] ${shotType} shoe-edit skipped (no shoe item or missing ref)`);
          }
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
      await recordStage('label', finalImageData);
    }

    // ── Square upscale to 4000×4000 (G-Star brand spec) ─────────────────────
    // Seedream renders at 2048×2048 native (1:1). We upscale to 4000×4000
    // before saving the source image, matching the G-Star.com square reference
    // (e.g., 3301-regular-tapered 2000×2000 native — we double that for print
    // and downstream PDP/PLP cropping headroom). Lanczos interpolation is fine
    // for clean studio backdrops with sharp subject edges.
    //
    // Skipped for non-square output (legacy 3:4 / 9:16 paths) — those produce
    // their native size unchanged.
    {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(finalImageData).metadata();
      const w = meta.width || 0;
      const h = meta.height || 0;
      // Only upscale square images (1:1 native). Tolerate ±2px aspect drift.
      if (w > 0 && h > 0 && Math.abs(w - h) <= 2 && w < 4000) {
        await reportProgress('Upscaling to 4K square', 80);
        finalImageData = await sharp(finalImageData)
          .resize({ width: 4000, height: 4000, fit: 'fill', kernel: 'lanczos3' })
          .png()
          .toBuffer();
        console.log(`[Generate] ${shotType} upscaled ${w}x${h} → 4000x4000 (lanczos3)`);
        await recordStage('upscaled', finalImageData);
      }
    }

    // ── Subject matte + backdrop variants ──────────────────────────────────
    // Shot type policy:
    //   M03/M04/M06 — matte + cast shadow + heel contact + composite onto white & grey
    //   M05         — SKIP (2026-05-11, Bruno-approved). Track A (cropped refs)
    //                 + rev 32 prompt produces a clean grey-backdrop M05 from
    //                 Seedream alone. Matte step was adding cutout artifacts
    //                 (xray softness without alpha_matting, jagged edges with).
    //                 13-unit grey delta vs M03 master accepted as imperceptible
    //                 for the detail-shot use case.
    //   M01/M02     — SKIP at this layer (they crop from M03/M04 grey master via
    //                 cropWaistFromFullBody, naturally inheriting the new look)
    //
    // The grey master REPLACES the raw Seedream output as the primary imageUrl,
    // so the results page, PDP/PLP, and downstream consumers all see the new look.
    // White master uploaded as `_white.png` sibling, surfaced via shot.whiteMasterUrl.
    //
    // Non-blocking: on rembg/Python unavailability or any matting error, the raw
    // Seedream output is uploaded as before (back-compat preserved); whiteMasterUrl/
    // greyMasterUrl simply unset on the doc.
    console.log(`[Generate] ${shotType} entering matte block (finalImageData=${finalImageData.length} bytes)`);
    let whiteMasterUrl: string | undefined;
    {
      const SHADOW_SHOTS = new Set(['M03', 'M04', 'M06']);
      const NO_SHADOW_SHOTS = new Set<string>();  // M05 removed 2026-05-11 — see comment block above
      const shouldMatte = SHADOW_SHOTS.has(shotType as string) || NO_SHADOW_SHOTS.has(shotType as string);
      console.log(`[Generate] ${shotType} shouldMatte=${shouldMatte}`);
      if (shouldMatte) {
        const version_for_white = body.version || 1;
        const jobName_for_white = job.jobName || job.jobId;
        try {
          await reportProgress('Matting + backdrop variants', 87);
          console.log(`[Generate] ${shotType} calling produceBackdropVariants…`);
          const variants = await produceBackdropVariants(finalImageData, {
            disableShadow: NO_SHADOW_SHOTS.has(shotType as string),
          });
          console.log(`[Generate] ${shotType} produceBackdropVariants returned ${variants ? 'success' : 'null'}`);
          if (variants) {
            const whiteName = `${job.modelId}_${shotType}_v${version_for_white}_white.png`;
            whiteMasterUrl = await uploadGeneratedImage(jobName_for_white, whiteName, variants.whiteBuffer);
            // Grey becomes the new primary master — replace finalImageData so all
            // downstream paths (master upload, deliverable formatter, anchor URLs,
            // version history) work off the cleaned/composited version.
            finalImageData = variants.greyBuffer;
            console.log(`[Generate] ${shotType} backdrop variants ready (white=${(variants.whiteBuffer.length/1024).toFixed(0)}KB grey=${(variants.greyBuffer.length/1024).toFixed(0)}KB)`);
            // Save both matte variants for stage-gallery inspection.
            await recordStage('matte-grey', variants.greyBuffer);
            await recordStage('matte-white', variants.whiteBuffer);
          } else {
            console.log(`[Generate] ${shotType} subject matte unavailable — keeping raw Seedream master`);
          }
        } catch (matteErr) {
          console.error(`[Generate] ${shotType} subject matte failed (non-blocking, keeping raw master):`, matteErr);
        }
      }
    }
    console.log(`[Generate] ${shotType} exiting matte block`);

    // ── M01/M02 white-crop ─────────────────────────────────────────────────
    // M01/M02 don't go through the matte pipeline (they crop from M03/M04 grey
    // master and inherit the matted look). To produce their white-bg sibling,
    // we crop the same way from the parent's white anchor — pure sharp work,
    // no API calls. Falls back gracefully when the parent predates the matte
    // pipeline (no m03WhiteAnchorUrl / m04WhiteAnchorUrl on the job doc).
    //
    // Crop mode mirrors the grey-master crop in seedreamM01/M02: 'upper-body'
    // for top-focus jobs (jacket as hero), 'waist' for bottom-focus. Without
    // this branch the white-bg M01/M02 would render waist-down even when the
    // grey-bg sibling is upper-body, breaking the toggle.
    {
      const CROP_FROM_WHITE_PARENT = new Set(['M01', 'M02']);
      if (CROP_FROM_WHITE_PARENT.has(shotType as string)) {
        const whiteAnchorUrl = shotType === 'M01' ? job.m03WhiteAnchorUrl : job.m04WhiteAnchorUrl;
        if (whiteAnchorUrl) {
          try {
            const { cropFromFullBody } = await import('@/lib/pipeline/elbow-crop');
            const whiteFocusSlot = getFocusSlot(job.wardrobe);
            const whiteCropMode = whiteFocusSlot === 'top' ? 'upper-body' : 'waist';
            console.log(`[Generate] ${shotType} cropping from white parent (${whiteCropMode}, focus=${whiteFocusSlot || 'none'})…`);
            const whiteCropped = await cropFromFullBody(whiteAnchorUrl, whiteCropMode);
            const version_for_white = body.version || 1;
            const jobName_for_white = job.jobName || job.jobId;
            const whiteName = `${job.modelId}_${shotType}_v${version_for_white}_white.png`;
            whiteMasterUrl = await uploadGeneratedImage(jobName_for_white, whiteName, whiteCropped.imageData);
            console.log(`[Generate] ${shotType} white crop ready (${(whiteCropped.imageData.length / 1024).toFixed(0)}KB) → ${whiteName}`);
          } catch (cropErr) {
            console.error(`[Generate] ${shotType} white-crop failed (non-blocking):`, cropErr);
          }
        } else {
          console.log(`[Generate] ${shotType}: parent has no white anchor — skipping white master`);
        }
      }
    }

    await reportProgress('Uploading image', 90);

    // Upload to GCS
    const version = body.version || 1;
    const filename = `${job.modelId}_${shotType}_v${version}.png`;
    const jobName = job.jobName || job.jobId;
    const imageUrl = await uploadGeneratedImage(jobName, filename, finalImageData);
    // Mirror as the 'final' stage so the gallery has a stable last URL even
    // when the primary imageUrl gets rewritten by later regens. Same file
    // contents, separate path under {jobName}/debug.
    pipelineStages['final'] = imageUrl;
    // When matting succeeded, this primary upload IS the grey master.
    // greyMasterUrl is derived inline at the Firestore-write site below.

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

    // Save anchor URLs for dependency chain (M03/M04 are sources for M01/M02 crops).
    // We also persist the white-bg sibling URL when the matte pipeline ran on this
    // shot, so M01/M02 can crop a parallel white-bg variant in lockstep with grey.
    if (shotType === 'M03') {
      await updateJob(jobId, {
        m03AnchorUrl: imageUrl,
        ...(whiteMasterUrl ? { m03WhiteAnchorUrl: whiteMasterUrl } : {}),
      });
      console.log(`[Generate] M03 anchor saved (white=${whiteMasterUrl ? 'set' : 'none'})`);
    } else if (shotType === 'M04') {
      await updateJob(jobId, {
        m04AnchorUrl: imageUrl,
        ...(whiteMasterUrl ? { m04WhiteAnchorUrl: whiteMasterUrl } : {}),
      });
      console.log(`[Generate] M04 anchor saved (white=${whiteMasterUrl ? 'set' : 'none'})`);
    }

    // ── Deliverable formatting ─────────────────────────────────────────────
    // For deliverable shot types (M01, M02, M05, M06) — but NOT for M03/M04
    // which are intermediates — produce the brand-spec PDP (4000×4000) and
    // PLP (1500×2025) variants and upload them as siblings.
    // Non-blocking: a formatter failure must not fail the shot.
    let pdpUrl: string | undefined;
    let plpUrl: string | undefined;
    try {
      const { isDeliverableShot, formatBoth } = await import('@/lib/pipeline/deliverable-format');
      if (isDeliverableShot(shotType as ShotType)) {
        await reportProgress('Formatting deliverables', 92);
        const { pdp, plp } = await formatBoth(finalImageData);
        const pdpName = `${job.modelId}_${shotType}_v${version}_pdp.jpg`;
        const plpName = `${job.modelId}_${shotType}_v${version}_plp.jpg`;
        [pdpUrl, plpUrl] = await Promise.all([
          uploadGeneratedImage(jobName, pdpName, pdp),
          uploadGeneratedImage(jobName, plpName, plp),
        ]);
        console.log(`[Generate] ${shotType} deliverables: PDP ${(pdp.length / 1024).toFixed(0)}KB + PLP ${(plp.length / 1024).toFixed(0)}KB`);
      }
    } catch (delivErr) {
      console.error(`[Generate] ${shotType} deliverable formatting failed (non-blocking):`, delivErr);
    }

    // Update shot record
    await updateShot(shotId, {
      status: 'done',
      imageUrl,
      version,
      progressStep: '',
      progressPct: 100,
      provider,  // stamp which backend produced this version
      ...(usedSeedreamModel ? { seedreamModel: usedSeedreamModel } : {}),
      ...(alternativePromptId ? { alternativePromptId, alternativePromptLabel: alternativePromptLabel || '' } : {}),
      ...(useDressedBase ? { usedDressedBase: true } : {}),
      ...(pdpUrl ? { pdpUrl } : {}),
      ...(plpUrl ? { plpUrl } : {}),
      // Backdrop variants — present only when subject-matte ran successfully.
      // greyMasterUrl mirrors imageUrl (same file) for explicit consumption.
      // whiteMasterUrl is the pure-white-background sibling.
      ...(whiteMasterUrl ? { whiteMasterUrl, greyMasterUrl: imageUrl } : {}),
      // Tee-edit observability (only meaningful when shot type runs tee-edit)
      ...(teeEditApplied !== undefined ? { teeEditApplied } : {}),
      ...(teeEditError ? { teeEditError } : {}),
      // Pipeline-stage gallery URLs (added 2026-05-13 for paintbrush-look
      // diagnostic on TjgTqmQwR0SFy6XrxM95). Each key is a stage name
      // (seedream / teeedit / shoeedit / label / upscaled / matte-grey /
      // matte-white / final), each value is a GCS URL of that stage's
      // intermediate. Stages that didn't run for this shot are absent.
      ...(Object.keys(pipelineStages).length ? { pipelineStages } : {}),
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
