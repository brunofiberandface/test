/**
 * Shot generation endpoint — 2026-05-17 Tier-2 pipeline.
 *
 * Per-shot routing:
 *   M01 / M02 — matrix-paint (Tier-2 cell base + Seedream jeans paint)
 *   M05       — Seedream single-pass (pocket-detail back close-up)
 *   M03       — Seedream → Gemini (full body / functionality; formerly M06)
 *
 * Post-generation: leather label composite (M02 only) → matte + backdrop
 * variants (M01/M02/M03) → deliverable formatting (PDP + PLP for all 4).
 *
 * M03 / M04 retired 2026-05-17 — replaced by the Tier-2 matrix.
 */
import { NextRequest, NextResponse } from 'next/server';
import { updateShot, getJob, updateJob, shotsCol, listShots, updateJobStatus } from '@/lib/firestore';
import { uploadGeneratedImage } from '@/lib/gcs';
import { saveStage, type PipelineStage } from '@/lib/pipeline/stage-recorder';
import { generateSeedreamShot, type SeedreamGenerationContext } from '@/lib/pipeline/seedream-generate';
import { applyTeeEdit, needsTeeEdit } from '@/lib/pipeline/seedream-tee-edit';
import { matrixPaint } from '@/lib/pipeline/matrix-paint';
import { APP_CONFIG } from '@/lib/config';
import { produceBackdropVariants } from '@/lib/subject-matte';
import { loadPrompt, loadPromptById } from '@/lib/pipeline/prompt-loader';
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

    // Load prompt — use alternative if specified, otherwise golden vault.
    // Matrix-paint shots (M01/M02) have their prompt hardcoded in matrix-paint.ts
    // and do not consume vault prompts, so we skip the loader for them. The
    // alternativePrompt override still works if set explicitly.
    await reportProgress('Loading prompt', 8);
    const pipeline: 'gemini' | 'seedream' | undefined = provider === 'seedream' ? 'seedream' : undefined;
    const isMatrixShot = shotType === 'M01' || shotType === 'M02';
    const prompt = alternativePromptId
      ? await loadPromptById(alternativePromptId)
      : isMatrixShot
        ? null
        : await loadPrompt(shotType as ShotType, undefined, pipeline);
    if (alternativePromptId) {
      console.log(`[Generate] Using alternative prompt: ${alternativePromptLabel || alternativePromptId}`);
    }

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

    // ── M01/M02 matrix-paint pipeline (Tier-2 base + Seedream jeans paint) ──
    // Provider-agnostic — overrides job.provider for these two shots. M01/M02
    // no longer crop from M03/M04 (which are retired). They generate
    // independently from the (model × shoe) Tier-2 cell rendered ahead of time.
    //
    // Always: Tier-2 fullBody view → Seedream paints jeans → Gemini tee-edit
    // paints top → sharp-crop to one of two modes:
    //   bottom / shoe / none → 'waist' crop (waistband + 5% headroom → feet,
    //     showing the tucked tee hem above the jeans waistband).
    //   top                  → 'upper-body' crop (head → mid-femur, no feet).
    //     matrixUpperBodyCrop flag disables the cast shadow in the matte step.
    let matrixUpperBodyCrop = false;
    if (shotType === 'M01' || shotType === 'M02') {
      const matrixFocusSlot = getFocusSlot(job.wardrobe) ?? undefined;
      await reportProgress(`Matrix paint (fullBody → jeans → tee-edit → ${matrixFocusSlot === 'top' ? 'upper-body' : 'waist'} crop)`, 20);
      const result = await matrixPaint({
        shotType: shotType as 'M01' | 'M02',
        modelId: job.modelId,
        wardrobe: job.wardrobe,
        focusSlot: matrixFocusSlot,
        seedreamApiKey: seedreamApiKey || process.env.BYTEPLUS_API_KEY,
        geminiApiKey: apiKey,
      });
      console.log(`[Generate] ${shotType} matrix-paint complete (base=…${result.matrixBaseUrl.slice(-60)}, ${result.imageData.length} bytes, upperBody=${result.isUpperBodyCrop}, teeEdited=${result.teeEdited})`);
      finalImageData = result.imageData;
      usedSeedreamModel = result.seedreamModel;
      matrixUpperBodyCrop = result.isUpperBodyCrop;
      if (result.teeEdited) {
        teeEditApplied = true;
      } else if (result.teeEditError) {
        teeEditApplied = false;
        teeEditError = result.teeEditError;
      }
      // Rev 30 (2026-05-24): two-stage save for the matrix path. The
      // Gemini extend-hem-over-shoe step is gone (Seedream paints the
      // trouser directly onto a pre-shod Tier-2 base), so there's no
      // 'shoeedit' stage to record. `seedream` is the raw Seedream paint;
      // `teeedit` is the post-strip-paint + composite-back final.
      //
      // If strip-paint didn't run (no top in wardrobe), the seedream
      // pixels ARE the final and saving 'teeedit' would be a duplicate
      // tile — so we elide.
      if (result.preStripPaintBuffer) {
        await recordStage('seedream', result.preStripPaintBuffer);
        await recordStage('teeedit', finalImageData);
      } else {
        await recordStage('seedream', finalImageData);
      }

    } else {
      // ── Seedream path — single-pass for M03/M05, no dressed base ──
      // The legacy provider='gemini' path was retired with M03/M04 — it was
      // structurally tied to those shots and had no working M03/M05 path of
      // its own. All non-matrix shots now go through Seedream regardless of
      // job.provider; the `provider` field is kept on the doc for audit only.
      // Model selected by SEEDREAM_MODEL env var (4.5 default; flip to 5.0 in
      // Cloud Run console). Optional per-job override via job.seedreamModel.
      // Label composite (below) still runs on M02 Seedream output.
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
        m02AnchorUrl: job.m02AnchorUrl,  // M05 dominant anchor — set by route after M02 lands
        apiKey: seedreamApiKey || process.env.BYTEPLUS_API_KEY,
        model: seedreamModelOverride,  // undefined → uses SEEDREAM_MODEL env var default
        // M03 (Full Body / Functionality, formerly M06) — read new field first,
        // fall back to legacy m06PoseId / m06TopPoseId on pre-rename job/shot
        // docs so historical content keeps rendering until the migration script
        // physically renames the fields.
        m03PoseId: (job as { m03PoseId?: string; m06PoseId?: string }).m03PoseId
          ?? (job as { m06PoseId?: string }).m06PoseId,  // undefined falls back to default pose
        m05TopVariantId: (shotData as { m05TopVariantId?: 'A' | 'B' | 'C' })?.m05TopVariantId,  // M05 top-focus only — undefined = random pick
        // M01/M02 top-focus pose precedence (2026-05-26):
        //   shot-level override (per-shot rerun-with-pose) >
        //     job-level pick (new-job step 4) >
        //       legacy shot field (m06TopPoseId from pre-rename docs) >
        //         random per gender at generation time.
        m03TopPoseId:
          (shotData as { m03TopPoseId?: string; m06TopPoseId?: string })?.m03TopPoseId
          ?? (job as { m03TopPoseId?: string })?.m03TopPoseId
          ?? (shotData as { m06TopPoseId?: string })?.m06TopPoseId,
        focusSlot,  // 'top' | 'bottom' | 'shoe' | undefined
      };
      // prompt is non-null here — only M01/M02 (matrix shots) skip the loader,
      // and those don't reach the seedream branch (intercepted by matrix-paint).
      const result = await generateSeedreamShot(shotType as ShotType, seedreamCtx, prompt!);
      const usedModel = result.model;  // resolved by seedream-client (override OR env)
      usedSeedreamModel = usedModel;
      console.log(`[Generate] ${shotType} Seedream generated (${result.imageData.length} bytes, model=${usedModel})`);
      finalImageData = result.imageData;

      // ── Gemini tee-edit: replace sports bra with real top (M03 only — formerly M06) ──
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
      }
    }

    // Rev 30 (2026-05-24): leather-label composite step retired for M02.
    // The label is now rendered directly by Seedream in the matrix-paint
    // step (slot 1-4 fit-model angles + slot 4 ECOM ref all show the
    // leather brand patch in its correct position), and the composite-back
    // step keeps the Seedream patch crisp through strip-paint. Running an
    // additional homography-warp shader on top introduced more drift than
    // it fixed.
    //
    // Rollback if needed: re-introduce the applyAutoHybridLabel block here
    // gated on shotType === 'M02'. The helper itself
    // (src/lib/label-auto.ts) is unchanged.
    void applyAutoHybridLabel; // keep import live in case of revert

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
    //   M01/M02/M03 — matte + cast shadow + heel contact + composite onto white & grey
    //   M05         — SKIP (2026-05-11, Bruno-approved). Track A (cropped refs)
    //                 + rev 32 prompt produces a clean grey-backdrop M05 from
    //                 Seedream alone. Matte step was adding cutout artifacts
    //                 (xray softness without alpha_matting, jagged edges with).
    //                 13-unit grey delta vs other masters accepted as
    //                 imperceptible for the detail-shot use case.
    //
    // M01/M02 added to the matte set on 2026-05-17 with the Tier-2 matrix-paint
    // pipeline: they are now standalone 1:1 4K shots (not crops of M03/M04),
    // so they need their own matte/white-master rather than inheriting.
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
      // 2026-05-26: 'M06' added as a legacy alias of 'M03'. The platform-wide
      // M06→M03 rename (see src/types/index.ts) hasn't fully propagated to all
      // existing shot docs — some still carry shotType='M06' in Firestore.
      // Listing both ensures the matte + procedural-shadow + recomposite
      // pipeline runs for the free-pose / full-body shot regardless of which
      // string is on the doc. Without this, M06 shipped raw from Gemini-3-pro
      // (no rembg backdrop normalization → backdrop grey drifted vs M01/M02;
      // no procedural shadow → only whatever Gemini painted natively).
      const SHADOW_SHOTS = new Set(['M01', 'M02', 'M03', 'M06']);
      // 2026-05-26: M05 added back. Originally excluded 2026-05-11 because the
      // matte step produced rembg artifacts on M05's close-up framing (xray
      // softness without alpha_matting, jagged edges with). Since then the
      // pipeline has alpha_matting=True + LEARNING #102 recomposite + the
      // DISABLE_SHADOW=1 propagation for no-feet shots. Local rembg+composite
      // simulation on 3 jobs (M61G/wTqV/5gmK) — see gstar/M05_Matte_Test.pptx —
      // confirmed clean silhouettes with no artifacts on close-up framings.
      // M05 stays in NO_SHADOW_SHOTS (not SHADOW_SHOTS) because it shares the
      // no-feet property with upper-body M01/M02 crops — disable_shadow=true
      // must be passed to python to skip heel detection.
      const NO_SHADOW_SHOTS = new Set(['M05']);
      // 2026-05-22: M03 (Full Body / Functionality, formerly M06) needs the
      // rembg + composite + procedural-shadow output, but NOT the Gemini
      // grounding-shadow regen step. Gemini's regen drifts the subject framing
      // (head cropped at top of frame, feet shifted) even with the knockout
      // fix applied. Procedural shadow from the Python matte job is sufficient.
      // Add M03 (and its legacy alias M06) to SKIP_GEMINI_SHADOW so it still
      // matte's + produces backdrop variants but Gemini doesn't touch the
      // output. The recomposite step (subject-matte.ts:484+) preserves crisp
      // garment pixels regardless.
      const SKIP_GEMINI_SHADOW = new Set(['M03', 'M06']);
      const shouldMatte = SHADOW_SHOTS.has(shotType as string) || NO_SHADOW_SHOTS.has(shotType as string);
      // 2026-05-26 (later): split the single disableShadow boolean into TWO
      // distinct concepts that were being conflated and broke M03's cast
      // shadow:
      //   noFeetVisible — true when there are NO feet in the frame
      //     (M05 close-up, M01/M02 upper-body). Python should skip the
      //     procedural shadow build (no heels to anchor it to). Maps to
      //     options.disableShadow → DISABLE_SHADOW=1 env var.
      //   skipGroundingOnly — true when there ARE feet but Gemini's
      //     grounding-shadow regen drifts the subject framing (M03/M06).
      //     Python should KEEP the procedural shadow on (cast + heel),
      //     just skip the Gemini grounding pass + recomposite. Maps to
      //     options.skipGroundingOnly.
      //   The two are mutually exclusive: a shot is either no-feet (use
      //   disableShadow) or has-feet-but-skip-gemini (use skipGroundingOnly).
      const noFeetVisible =
        NO_SHADOW_SHOTS.has(shotType as string) ||
        matrixUpperBodyCrop;
      const skipGroundingOnly =
        SKIP_GEMINI_SHADOW.has(shotType as string) && !noFeetVisible;
      console.log(`[Generate] ${shotType} shouldMatte=${shouldMatte} noFeetVisible=${noFeetVisible} skipGroundingOnly=${skipGroundingOnly}`);
      if (shouldMatte) {
        const version_for_white = body.version || 1;
        const jobName_for_white = job.jobName || job.jobId;
        try {
          await reportProgress('Matting + backdrop variants', 87);
          console.log(`[Generate] ${shotType} calling produceBackdropVariants…`);
          const variants = await produceBackdropVariants(finalImageData, {
            disableShadow: noFeetVisible,
            skipGroundingOnly,
          });
          console.log(`[Generate] ${shotType} produceBackdropVariants returned ${variants ? 'success' : 'null'}`);
          if (variants) {
            const whiteName = `${job.modelId}_${shotType}_v${version_for_white}_white.png`;
            // 2026-05-26 BUG FIX: folder uses jobId to avoid cross-job filename
            // collisions when two jobs share the same auto-generated jobName.
            // The whiteName filename pattern is {modelId}_{shotType}_v{version}_white.png
            // so different-model jobs wouldn't collide, but same-model same-design
            // reruns/clones could. jobId folder closes that gap.
            whiteMasterUrl = await uploadGeneratedImage(jobId, whiteName, variants.whiteBuffer);
            // Grey becomes the new primary master — replace finalImageData so all
            // downstream paths (master upload, deliverable formatter, anchor URLs,
            // version history) work off the cleaned/composited version.
            finalImageData = variants.greyBuffer;
            console.log(`[Generate] ${shotType} backdrop variants ready (white=${(variants.whiteBuffer.length/1024).toFixed(0)}KB grey=${(variants.greyBuffer.length/1024).toFixed(0)}KB)`);
            // Save final matte stages for the debug viewer. Dropped the
            // matte-raw-grey / matte-raw-white intermediates (2026-05-18
            // cleanup): they were rembg + procedural-shadow snapshots BEFORE
            // the Gemini grounding-shadow regen — useful when debugging the
            // matte service itself, but production reviewers compare seedream
            // → teeedit → label → matte-grey/white, so the intermediates
            // were noise. Each saved stage = a GCS PUT, so this also trims
            // per-shot cost. Re-enable if grounding-shadow regen artifacts
            // become a recurring debug target.
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

    await reportProgress('Uploading image', 90);

    // Upload to GCS
    const version = body.version || 1;
    const filename = `${job.modelId}_${shotType}_v${version}.png`;
    const jobName = job.jobName || job.jobId;
    // 2026-05-26 BUG FIX: folder uses jobId — see comment in deliverable
    // upload block below for the collision rationale. Same fix applied here
    // for the primary master upload.
    const imageUrl = await uploadGeneratedImage(jobId, filename, finalImageData);
    // Dropped the 'final' stage pointer (2026-05-18 cleanup): it was set to
    // imageUrl, producing a duplicate "8. Final" tile in the debug viewer.
    // The viewer already renders imageUrl as the primary image; the pointer
    // added no new information. Removing keeps the stages dialog focused on
    // actual transform steps. Re-add as `pipelineStages['final'] = imageUrl`
    // if a downstream consumer needs a stable original-output URL.
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

    // ── M02 anchor save ────────────────────────────────────────────────────
    // M05 depends on M02 (see APP_CONFIG.shots.M05.dependsOn). The worker
    // dispatches M05 only after M02 hits 'done'; M05's seedreamCtx reads
    // job.m02AnchorUrl as its dominant ref. Persist the just-uploaded M02
    // URL so the M05 generate call (a separate request) finds it on the job.
    if (shotType === 'M02') {
      await updateJob(jobId, { m02AnchorUrl: imageUrl });
      console.log(`[Generate] M02 anchor saved → ${imageUrl.slice(-60)}`);
    }

    // ── Deliverable formatting ─────────────────────────────────────────────
    // For deliverable shot types (M01, M02, M03, M05) produce the brand-spec
    // PDP (4000×4000), PLP (1500×2025), and Wholesale (3200×4000 white-bg)
    // variants and upload them as siblings.
    //
    // Filename pattern (2026-05-26 — replaces the old `${modelId}_${shotType}_v${version}_pdp.jpg`):
    //   PDP        — {focusDesignNumber}-M0{n}.jpg     e.g.  D24461-D559-A587-M01.jpg
    //   PLP        — {focusDesignNumber}-E0{n}.jpg     e.g.  D24461-D559-A587-E01.jpg
    //   Wholesale  — {focusDesignNumber}-W0{n}.jpg     e.g.  D24461-D559-A587-W01.jpg
    // Where {n} is the two-digit suffix from shotFilenameSuffix() — '01' for M01,
    // '02' for M02, '03' for M03, '05' for M05. Falls back to the legacy
    // `{modelId}_{shotType}_v{version}_<format>.jpg` pattern when focusDesignNumber
    // is missing (e.g. legacy jobs without the field, or wardrobe items whose
    // name didn't parse as D{NNNNN}-...).
    //
    // Wholesale source: prefers whiteMasterUrl content (the pure-white matte
    // output). If matting didn't run (older shots, M05 which skips matte),
    // wholesale falls back to greyMaster — visible halo, acceptable for legacy.
    //
    // Non-blocking: a formatter failure must not fail the shot.
    let pdpUrl: string | undefined;
    let plpUrl: string | undefined;
    let wholesaleUrl: string | undefined;
    try {
      const { isDeliverableShot, formatAll } = await import('@/lib/pipeline/deliverable-format');
      const { shotFilenameSuffix } = await import('@/lib/shot-labels');
      if (isDeliverableShot(shotType as ShotType)) {
        await reportProgress('Formatting deliverables', 92);

        // Wholesale uses the white master if available — fetch it back from
        // GCS. produceBackdropVariants() returned the whiteBuffer above and we
        // uploaded it; pulling the buffer back is cheaper than re-rendering.
        // If whiteMasterUrl is undefined (M05 / shots that skipped matte),
        // pass undefined → formatAll falls back to greySource on white canvas.
        let whiteBuffer: Buffer | undefined;
        if (whiteMasterUrl) {
          try {
            const wRes = await fetch(whiteMasterUrl, { signal: AbortSignal.timeout(20_000) });
            if (wRes.ok) whiteBuffer = Buffer.from(await wRes.arrayBuffer());
          } catch (wErr) {
            console.warn(`[Generate] ${shotType} could not fetch whiteMasterUrl for wholesale (non-blocking):`, wErr);
          }
        }

        const { pdp, plp, wholesale } = await formatAll(finalImageData, whiteBuffer, shotType as ShotType);

        // Filename builder. Branches on focusDesignNumber availability so old
        // jobs (no design number persisted) still get deliverables under the
        // legacy filename pattern. New jobs get the brand-spec D-...-{format}.
        const designNumber = (job.focusDesignNumber as string | undefined) || '';
        const suffix = shotFilenameSuffix(shotType as string);
        const pdpName = designNumber
          ? `${designNumber}-M${suffix}.jpg`
          : `${job.modelId}_${shotType}_v${version}_pdp.jpg`;
        const plpName = designNumber
          ? `${designNumber}-E${suffix}.jpg`
          : `${job.modelId}_${shotType}_v${version}_plp.jpg`;
        const wholesaleName = designNumber
          ? `${designNumber}-W${suffix}.jpg`
          : `${job.modelId}_${shotType}_v${version}_wholesale.jpg`;

        // 2026-05-26 BUG FIX: upload folder is now jobId, not jobName.
        // Multiple jobs with the same focus garment auto-generate the same
        // jobName ("D24461-D559-A587 KATE BOYFRIEND WMN"), so jobName-based
        // folders collided on the brand-spec filenames (D24461-W01.jpg etc.).
        // Symptom: Wholesale download showed a different model's image
        // because Job B's backfill overwrote Job A's file. Per-jobId folders
        // make collision impossible. Pre-existing files in jobName folders
        // are orphaned; backfill-deliverables.ts re-uploads under jobId.
        const uploadFolder = jobId;
        [pdpUrl, plpUrl, wholesaleUrl] = await Promise.all([
          uploadGeneratedImage(uploadFolder, pdpName, pdp),
          uploadGeneratedImage(uploadFolder, plpName, plp),
          uploadGeneratedImage(uploadFolder, wholesaleName, wholesale),
        ]);
        console.log(
          `[Generate] ${shotType} deliverables: PDP ${(pdp.length / 1024).toFixed(0)}KB + ` +
          `PLP ${(plp.length / 1024).toFixed(0)}KB + Wholesale ${(wholesale.length / 1024).toFixed(0)}KB ` +
          `(designNumber=${designNumber || 'legacy-fallback'})`
        );
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
      ...(wholesaleUrl ? { wholesaleUrl } : {}),
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

    // Check if all shots done → move job to 'review'. Retired shotTypes
    // (M03/M04) on legacy jobs are ignored — the worker never dispatches
    // them so they'd never reach 'done' status.
    try {
      const allShots = await listShots(jobId);
      const activeShotTypes = new Set<string>(APP_CONFIG.shotTypes);
      const activeShots = allShots.filter((s: any) => activeShotTypes.has(s.shotType));
      const allDone = activeShots.length > 0 && activeShots.every(
        (s: any) => s.status === 'done' || s.status === 'approved'
      );
      if (allDone) {
        await updateJobStatus(jobId, 'review');
        console.log(`[Generate] All active shots done — job ${jobId} moved to review`);
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
