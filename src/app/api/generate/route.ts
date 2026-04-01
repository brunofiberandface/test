import { NextRequest, NextResponse } from 'next/server';
import { updateShot, logModification, jobsCol, shotsCol, getWardrobeItem, updateJobStatus, listShots, getModel, findDressedBase, listDressedBases, type DressedView } from '@/lib/firestore';
import { computeWardrobeHash } from '@/lib/wardrobe-hash';
import { generateImage } from '@/lib/vertex';
import { uploadGeneratedImage, downloadGarmentImage } from '@/lib/gcs';
import { buildGenerationPrompt, REF_LABELS, ZONE_DEFS, getEcomPosingRules, getEcomFootwear, getEcomStylingTop, ECOM_NO_GOS } from '@/lib/prompts';
import { generateZoneGrids, resizeForFeed } from '@/lib/zone-grids';
import { getGarmentDNA } from '@/lib/garment-dna';

import { extractFlatColor, extractFlatSilhouette, correctColorToFlat, type FlatColor, type FlatSilhouette } from '@/lib/flat-reference';
import { matchColorsToReference } from '@/lib/color-match';
import { extractSkinTone } from '@/lib/skin-tone';
import { extractLabel, compositeLabel } from '@/lib/label-composite';
import sharp from 'sharp';

// ── Shot-specific aspect ratios ──
// M01/M02: 3:4 — programmatic crop pipeline requires portrait (full body generated, then waist-cropped)
// M03/M04/M05: 9:16 — tall portrait, unlocks 4K output (3:4 is confirmed to stay at 2K)
const SHOT_ASPECT_RATIOS: Record<string, string> = {
  M01: '3:4',
  M02: '3:4',
  M03: '9:16',
  M04: '9:16',
  M05: '3:4', // Detail shot — tighter crop, not full-body portrait ratio
};

// POST /api/generate — generate a single shot with v5-quality pipeline
export async function POST(req: NextRequest) {
  let shotId: string | undefined; // hoisted so catch block can reset it
  try {
    const body = await req.json();
    let {
      shotId: shotIdParsed,
      jobId,
      designNumber,
      modelId,
      shotType,
      variant,
      prompt,
      flatImageUrl,
      image360Urls,
      modification,
      originalPrompt,
      version,
      garmentCategory,
      // Auto-regen tracking
      autoRegenAttempt = 0,
    } = body;
    shotId = shotIdParsed; // assign to outer var so catch can reset it

    // ── Resolve missing fields from Firestore (regeneration/re-run case) ──
    // The UI re-run may only send shotId + jobId + modification.
    // Fill in anything undefined from the shot and job documents.
    if (shotId && jobId && (!modelId || !shotType)) {
      console.log(`[Generate] Resolving missing fields from Firestore for shot=${shotId}`);
      try {
        const shotDoc = await shotsCol.doc(shotId).get();
        const shotDocData = shotDoc.data();
        if (shotDocData) {
          modelId = modelId || shotDocData.modelId;
          shotType = shotType || shotDocData.shotType;
          variant = variant || shotDocData.variant || 'A';
          prompt = prompt || shotDocData.prompt || '';
        }
      } catch (e) {
        console.error(`[Generate] Failed to resolve shot fields:`, e);
      }
      try {
        const jobDoc = await jobsCol.doc(jobId).get();
        const jobDocData = jobDoc.data();
        if (jobDocData) {
          designNumber = designNumber || jobDocData.designNumber;
          garmentCategory = garmentCategory || jobDocData.garmentCategory;
          flatImageUrl = flatImageUrl || jobDocData.flatImageUrl || '';
          image360Urls = image360Urls || jobDocData.image360Urls || [];
        }
      } catch (e) {
        console.error(`[Generate] Failed to resolve job fields:`, e);
      }
      console.log(`[Generate] Resolved: modelId=${modelId}, shotType=${shotType}, garmentCategory=${garmentCategory}`);
    }

    // Progress reporter — updates Firestore so the UI can poll step-level progress
    const reportProgress = async (step: string, pct: number) => {
      try {
        await shotsCol.doc(shotId!).update({
          progressStep: step,
          progressPct: pct,
          updatedAt: new Date(),
        });
      } catch { /* non-blocking */ }
    };

    // Update shot status
    await updateShot(shotId!, { status: 'generating' });
    await reportProgress('Loading references', 5);

    // ── Collect ALL reference images in CORRECT v5 feed order (Learning #28) ──
    // Order: 1. Model card → 2. Flat image (1400px) → 3. Mannequin front (1200px) →
    //        4. Side mannequin → 5. Zone grids → 6. Text prompt
    const referenceImages: Array<{ buffer: Buffer; mimeType: string; label: string }> = [];
    // Store zone grid buffers separately so we can inject key ones into Phase 2
    const zoneGridRefs: Array<{ buffer: Buffer; mimeType: string; label: string; zoneName: string }> = [];

    // Shot type flags
    const isCroppedShot = shotType === 'M01' || shotType === 'M02';
    const isDetailShot = shotType === 'M05'; // M05 = detail close-up of back pocket/bum area

    // v30: Full-body-then-crop strategy for M01/M02.
    // Instead of generating a cropped shot directly (which caused long sleeves, 2-tone t-shirt,
    // floor distortion), generate full-body (same pipeline as M03/M04) then crop the OUTPUT to 3:4.
    // M03/M04 produce correct sleeve length, uniform t-shirt color, and clean floor — so we leverage that.
    const fullBodyThenCrop = false; // v32: DISABLED — revert to 3:4 direct generation for M01/M02 (Kate-era behavior)

    // Wardrobe tracking — populated in step 6, used in prompts
    let wardrobeShoeName = '';  // actual shoe from wardrobe (e.g., "White sneaker 2")
    let wardrobeShirtName = ''; // actual shirt from wardrobe (e.g., "White T-shirt")
    let wardrobeShirtHex = '';  // measured hex from shirt image (e.g., "#808080")
    let wardrobeShirtDesc = ''; // color description (e.g., "medium grey")

    // 1. MODEL CARD — identity anchor (Learning #17) — FIRST
    // SKIP for M01/M02 (cropped): full-body card forces full-body generation, defeating the crop
    let modelCardBuffer: Buffer | null = null;
    let modelGender: 'male' | 'female' = 'female'; // default female
    try {
      const modelDoc = await getModel(modelId);
      modelGender = (modelDoc as any)?.gender || 'female';
      const cardImageUrl = (modelDoc as any)?.cardImageUrl;
      if (cardImageUrl) {
        const cleanUrl = cardImageUrl.split('?')[0];
        modelCardBuffer = await downloadGarmentImage(cleanUrl);
        if (!isCroppedShot && !isDetailShot) {
          // M05 (Dynamic) gets extra identity lock — the looser pose causes Gemini to drift on face/identity
          const dynamicIdentityLock = shotType === 'M05'
            ? ` CRITICAL FOR DYNAMIC POSE: Even though this shot uses a relaxed, editorial pose, the FACE and IDENTITY must be IDENTICAL to this reference. The pose changes but the PERSON does not. Same face shape, same eye shape, same nose, same lips, same skin tone, same hair. A different person is a CRITICAL FAILURE even if the pose looks good.`
            : '';
          referenceImages.push({
            buffer: modelCardBuffer,
            mimeType: 'image/png',
            label: `${REF_LABELS.modelCard} HAIR AND APPEARANCE MUST MATCH THIS REFERENCE EXACTLY — same hair color, same hair length, same hair style, same skin tone, same face in every single shot. Do not change the model's appearance between shots.${dynamicIdentityLock}`,
          });
          console.log(`[Generate] 1. Model card loaded for ${modelId}${shotType === 'M05' ? ' (+ dynamic identity lock)' : ''}`);
        } else {
          console.log(`[Generate] 1. Model card loaded but SKIPPED for ${shotType} (${isCroppedShot ? 'cropped' : 'detail'} shot — full-body ref would defeat framing)`);
        }
      }
    } catch (cardErr) {
      console.error(`[Generate] 1. Failed to load model card for ${modelId}:`, cardErr);
    }

    // 1a. SKIN TONE EXTRACTION — measure from model card, inject into ALL prompts
    let skinToneHex = '';
    let skinToneDesc = '';
    if (modelCardBuffer) {
      try {
        const modelDoc = await getModel(modelId);
        // Check if skin tone is already cached on the model record
        const cachedHex = (modelDoc as any)?.skinToneHex;
        const cachedDesc = (modelDoc as any)?.skinToneDesc;
        if (cachedHex && cachedDesc) {
          skinToneHex = cachedHex;
          skinToneDesc = cachedDesc;
          console.log(`[Generate] 1a. Skin tone from cache: ${skinToneHex} (${skinToneDesc})`);
        } else {
          const skinResult = await extractSkinTone(modelCardBuffer);
          skinToneHex = skinResult.hex;
          skinToneDesc = skinResult.description;
          // Persist to model record for future use
          const { modelsCol: mc } = await import('@/lib/firestore');
          await mc.doc(modelId).update({ skinToneHex, skinToneDesc });
          console.log(`[Generate] 1a. Skin tone extracted & cached: ${skinToneHex} (${skinToneDesc})`);
        }
      } catch (skinErr) {
        console.error(`[Generate] 1a. Skin tone extraction failed (non-blocking):`, skinErr);
      }
    }

    // 1b. DRESSED BASE CHECK — pre-rendered model wearing the wardrobe combo
    // If a dressed base exists, use it as the model reference AND skip Pass 2.
    // This gives Gemini a model already wearing the correct outfit — far more reliable than Pass 2 editing.
    let dressedBaseBuffer: Buffer | null = null;
    let dressedBaseActive = false;
    const jobDocForDressed = await jobsCol.doc(jobId).get();
    const jobDataForDressed = jobDocForDressed.data();
    const wardrobeIdsForDressed: Record<string, string> = jobDataForDressed?.wardrobeItemIds || {};
    if (Object.keys(wardrobeIdsForDressed).filter(k => wardrobeIdsForDressed[k]).length > 0) {
      try {
        const hash = computeWardrobeHash(wardrobeIdsForDressed);
        // View selection per shot type:
        // M02, M04, M05 → back view (rear-facing / back pocket detail shots)
        // M01, M03 → front view
        const BACK_VIEW_SHOTS = new Set(['M02', 'M04', 'M05']);
        const preferredView: DressedView = BACK_VIEW_SHOTS.has(shotType) ? 'back' : 'front';
        let dressedBase = await findDressedBase(modelId, hash, preferredView)
          ?? (preferredView === 'back' ? await findDressedBase(modelId, hash, 'front') : null);

        // Fallback: if no exact wardrobe hash match, try ANY dressed base for this model + view.
        // Body proportions, sleeve length, and skin tone from any dressed base are far better
        // than no reference at all (which causes sleeve length, texture, and proportion issues).
        if (!dressedBase) {
          try {
            const allBases = await listDressedBases(modelId);
            // Prefer matching view, then fall back to any view
            const viewMatch = allBases.find((b: any) => b.view === preferredView && b.imageUrl);
            const anyMatch = allBases.find((b: any) => b.imageUrl);
            const fallbackBase = viewMatch || anyMatch;
            if (fallbackBase) {
              dressedBase = fallbackBase;
              console.log(`[Generate] 1b. No exact hash match — using FALLBACK dressed base (${(fallbackBase as any).wardrobeHash || 'unknown'}, view: ${(fallbackBase as any).view || 'unknown'})`);
            }
          } catch (fbErr) {
            console.warn(`[Generate] 1b. Fallback dressed base lookup failed:`, fbErr);
          }
        }

        if (dressedBase) {
          const dbUrl = (dressedBase as any).imageUrl;
          if (dbUrl) {
            dressedBaseBuffer = await downloadGarmentImage(dbUrl.split('?')[0]);
            dressedBaseActive = true;
            console.log(`[Generate] 1b. Dressed base found — will use instead of underwear card + Pass 2`);
          }
        } else {
          console.log(`[Generate] 1b. No dressed base for hash ${hash} and no fallback — using underwear card + Pass 2`);
        }
      } catch (dbErr) {
        console.warn(`[Generate] 1b. Dressed base lookup failed (non-blocking):`, dbErr);
      }
    }

    // If dressed base found: replace model card reference with dressed base.
    // Dressed base encodes the model's full outfit (shirt + shoes + accessories).
    // Use for ALL full-body shots regardless of focus garment category.
    // For lower-body focus (pants/jeans): the dressed base trousers are REPLACED by the
    // focus garment via the ignoreZoneInstruction — this is explicitly handled below.
    const focusCategoryForDressed = garmentCategory || detectCategory(shotType);
    const isLowerBodyFocus = ['pants', 'jeans', 'shorts', 'skirt', 'trousers'].includes(focusCategoryForDressed?.toLowerCase() || '');
    const isUpperBodyFocus = ['jacket', 'shirt', 'top', 'blouse', 'coat', 'bomber', 'overshirt', 'vest'].includes(focusCategoryForDressed?.toLowerCase() || '');

    if (dressedBaseActive && dressedBaseBuffer && !isCroppedShot && !isDetailShot) {
      const cardIdx = referenceImages.findIndex(r => r.label.startsWith('MODEL IDENTITY REFERENCE') || r.label.startsWith(REF_LABELS.modelCard));

      let ignoreZoneInstruction = '';
      if (isLowerBodyFocus) {
        ignoreZoneInstruction = `\n\nCRITICAL — COMPLETELY IGNORE ALL LEGWEAR on this dressed reference. The model wears short black compression shorts for modesty only — these are NOT a garment reference. They have ZERO relevance to the product. Do NOT use their color, length, fit, or silhouette as any reference. The ENTIRE lower body from waist to shoes will be dressed by the FOCUS GARMENT from the mannequin 360° reference images. Only match from this reference: face, hair, skin tone, body type, shoes, and any UPPER BODY clothing (jacket, shirt, top).\n\nCRITICAL — MATCH UPPER BODY CLOTHING EXACTLY: If this reference shows a white t-shirt, the output MUST show the SAME white t-shirt — same color, same neckline, same fit. DO NOT replace it with a tank top, crop top, or any other garment. DO NOT change the color. Changing the upper body clothing is a CRITICAL FAILURE.`;
      } else if (isUpperBodyFocus) {
        ignoreZoneInstruction = `\n\nCRITICAL — IGNORE THE JACKET/SHIRT/TOP on this dressed reference. The model may appear to wear an upper body garment — this is PLACEHOLDER clothing and MUST BE COMPLETELY REPLACED by the focus garment (the actual product being photographed). Only match: face, hair, skin tone, body type, shoes, and any LOWER BODY clothing (pants, jeans). The UPPER BODY will be dressed by the focus garment from the mannequin references.`;
      }

      const dressedLabel = `MODEL DRESSED REFERENCE — this is the model for this shot. Match EXACTLY: face, hair, skin tone, body type, shoes, and all visible outfit items not covered by the focus garment.${ignoreZoneInstruction}`;

      if (cardIdx >= 0) {
        referenceImages[cardIdx] = { buffer: dressedBaseBuffer, mimeType: 'image/jpeg', label: dressedLabel };
        console.log(`[Generate] 1b. Replaced model card with dressed base at position ${cardIdx} (focus=${focusCategoryForDressed}, lower=${isLowerBodyFocus}, upper=${isUpperBodyFocus})`);
      } else {
        referenceImages.unshift({ buffer: dressedBaseBuffer, mimeType: 'image/jpeg', label: dressedLabel });
        console.log(`[Generate] 1b. Prepended dressed base (focus=${focusCategoryForDressed}, lower=${isLowerBodyFocus}, upper=${isUpperBodyFocus})`);
      }
    }

    // 1c. DRESSED BASE for M01/M02 cropped shots — body proportions + shoes/jacket reference
    // CRITICAL: When garment is lower-body (pants/jeans), the dressed base legwear is NOT
    // the product — it's base clothing (compression shorts). We must tell Gemini to IGNORE it.
    // The actual pants come from mannequin 360° photos only.
    // When garment is upper-body (jacket), the dressed base pants ARE correct — use them.
    if (isCroppedShot && !fullBodyThenCrop && dressedBaseBuffer) {
      // Pre-crop dressed base to waist-down for M01/M02 — consistent with pre-cropped garment template
      // v30: DISABLED when fullBodyThenCrop — M01/M02 now generate full-body, dressed base used full in Phase 2
      let croppedDressedBase = dressedBaseBuffer;
      try {
        const dbMeta = await sharp(dressedBaseBuffer).metadata();
        const dbH = dbMeta.height || 2400;
        const dbW = dbMeta.width || 1800;
        const dbCropTop = Math.round(dbH * 0.42); // crop from 42% — below waistband, ensures hands/forearms are cropped out
        croppedDressedBase = await sharp(dressedBaseBuffer)
          .extract({ left: 0, top: dbCropTop, width: dbW, height: dbH - dbCropTop })
          .jpeg({ quality: 95 })
          .toBuffer();
        console.log(`[Generate] 1c. Dressed base pre-cropped to waist-down for ${shotType}`);
      } catch (dbCropErr) {
        console.error(`[Generate] 1c. Dressed base crop failed (using full):`, dbCropErr);
      }

      let croppedLabel: string;
      if (isLowerBodyFocus) {
        croppedLabel = `BODY & SHOES REFERENCE (CROPPED TO HIP-DOWN) — This shows the model's lower body and shoes ONLY. Match from this reference ONLY:\n- SHOES: match the shoes shown here EXACTLY — same style, color, silhouette. Do NOT substitute with boots or other shoes.\n- BODY PROPORTIONS: lean, athletic, narrow hips, slim thighs\n- NO ARMS, NO HANDS, NO FOREARMS — this is a waist-to-shoes shot. If arms/hands appear in this reference, IGNORE them completely. The output must NOT show any arms, hands, or sleeves.\n\nCRITICAL — COMPLETELY IGNORE THE LEGWEAR/SHORTS. The actual PANTS come from the garment template.`;
        console.log(`[Generate] 1c. Dressed base injected for body/shoes ONLY (lower-body garment — legwear ignored)`);
      } else {
        croppedLabel = `OUTFIT REFERENCE (CROPPED TO WAIST-DOWN) — Match PRECISELY:\n- PANTS: same fit, same length, same wash as shown\n- SHOES: match the shoes shown here EXACTLY — same style, color, silhouette. Do NOT substitute.\n- BODY PROPORTIONS: lean, athletic, narrow hips`;
        console.log(`[Generate] 1c. Dressed base injected as full outfit reference (upper-body garment — pants are correct)`);
      }
      referenceImages.push({
        buffer: croppedDressedBase,
        mimeType: 'image/jpeg',
        label: croppedLabel,
      });
    }

    // v33: Skin tone swatch IMAGE removed — was an extra reference image that could confuse Gemini.
    // Skin tone hex is still passed as TEXT in the Phase 2 prompt (line: SKIN TONE: ...).
    // Kate-era had no skin tone injection at all and worked fine.
    if (isCroppedShot && skinToneHex) {
      console.log(`[Generate] 1d. Skin tone hex available for ${shotType}: ${skinToneHex} (${skinToneDesc}) — text-only, no swatch image`);
    }

    // 2. FLAT IMAGE — #1 width/proportion reference (Learning #28) — at 1400px
    // The flat image is the ABSOLUTE GROUND TRUTH for color/wash and shape/silhouette.
    let flatColor: FlatColor | null = null;
    let flatSilhouette: FlatSilhouette | null = null;
    if (flatImageUrl) {
      try {
        const flatBuffer = await downloadGarmentImage(flatImageUrl.split('?')[0]);

        // 2a. Extract mathematical color + silhouette from flat (ground truth)
        try {
          flatColor = await extractFlatColor(flatBuffer);
          flatSilhouette = await extractFlatSilhouette(flatBuffer);
          console.log(`[Generate] 2a. Flat reference extracted: color=${flatColor.hex} (LAB L=${flatColor.lab.l.toFixed(0)} a=${flatColor.lab.a.toFixed(1)} b=${flatColor.lab.b.toFixed(1)}), silhouette=${flatSilhouette.classification} (taper=${flatSilhouette.taperRatio.toFixed(2)})`);
        } catch (refErr) {
          console.warn(`[Generate] 2a. Flat reference extraction failed (non-blocking):`, refErr);
        }

        const resizedFlat = await resizeForFeed(flatBuffer, 1400);

        // v33: Simple label — no LAB/silhouette data bloat
        referenceImages.push({
          buffer: resizedFlat,
          mimeType: 'image/jpeg',
          label: REF_LABELS.flatImage,
        });
        console.log(`[Generate] 2. Flat image loaded (resized to 1400px)`);
      } catch (err) {
        console.error(`[Generate] Failed to load flat image:`, err);
      }
    }

    // 3. MANNEQUIN 360° IMAGES — feed ALL available angles for full rotation reference
    // The model needs the complete 360° rotation to accurately reproduce wash, color,
    // construction details, and silhouette from every angle.
    const mannequinBuffers: Array<{ buffer: Buffer; index: number }> = [];
    if (image360Urls?.length) {
      const maxAngles = Math.min(image360Urls.length, 9);

      // Build labels for ALL angles (full rotation)
      const labelMap = buildMannequinLabels(maxAngles);

      for (let i = 0; i < maxAngles; i++) {
        try {
          const buf = await downloadGarmentImage(image360Urls[i].split('?')[0]);
          const resizedBuf = await resizeForFeed(buf, 1200);

          mannequinBuffers.push({ buffer: buf, index: i });

          // Feed ALL mannequin images — full 360° rotation is critical for:
          // - Consistent wash/color across all angles
          // - Accurate construction details from every view
          // - Correct silhouette and drape in dynamic poses
          const angleLabel = labelMap[i] || `GARMENT ON MANNEQUIN (angle ${i + 1}/${maxAngles}, ~${Math.round(i * 360 / maxAngles)}°). Full 360° rotation reference — match wash, color, and construction from this angle.`;

          // First image (front) gets the COLOR ANCHOR label
          const colorAnchor = i === 0
            ? `\nCOLOR ANCHOR — THIS IS THE DEFINITIVE WASH/COLOR REFERENCE. The exact shade, wash intensity, fading pattern, and color tone in this front view is the GROUND TRUTH. All other angles confirm it. Do NOT deviate from this color in the generated image.`
            : '';

          referenceImages.push({
            buffer: resizedBuf,
            mimeType: 'image/jpeg',
            label: angleLabel + colorAnchor,
          });
          console.log(`[Generate] 3. Mannequin image ${i + 1}/${maxAngles}: ${angleLabel.substring(0, 60)}`);
        } catch (err) {
          console.error(`[Generate] Failed to load 360° image ${i}:`, err);
        }
      }
    }

    // 3a. FIT MODEL IMAGES — real human wearing garment, shows drape/silhouette/fit
    // If the focus garment's wardrobe item has fitModelUrls, combine them with mannequin refs.
    // Fit model photos give Gemini better fabric drape and silhouette reference than mannequin alone.
    let hasFitModelRefs = false;
    try {
      const jobDocFit = await jobsCol.doc(jobId).get();
      const garmentWardrobeId = jobDocFit.data()?.garmentWardrobeId;
      if (garmentWardrobeId) {
        const focusItem = await getWardrobeItem(garmentWardrobeId);
        const fitUrls = (focusItem as any)?.fitModelUrls;
        if (fitUrls?.length) {
          const maxFitImages = Math.min(fitUrls.length, 8);
          for (let i = 0; i < maxFitImages; i++) {
            try {
              const buf = await downloadGarmentImage(fitUrls[i].split('?')[0]);
              const resizedBuf = await resizeForFeed(buf, 1200);
              referenceImages.push({
                buffer: resizedBuf,
                mimeType: 'image/jpeg',
                label: `FIT MODEL REFERENCE (${i + 1}/${maxFitImages}) — Real human wearing this EXACT garment. Use this for fabric DRAPE, SILHOUETTE, and how the garment FALLS on a real body. The fit model shows how the denim moves, folds, and sits at the waist/hip/knee. Combine with mannequin angles for construction details.`,
              });
              console.log(`[Generate] 3a. Fit model image ${i + 1}/${maxFitImages} loaded`);
            } catch (err) {
              console.error(`[Generate] Failed to load fit model image ${i}:`, err);
            }
          }
          hasFitModelRefs = true;
          console.log(`[Generate] 3a. ${maxFitImages} fit model references loaded — combined approach active`);
        }
      }
    } catch (fitErr) {
      console.warn(`[Generate] Fit model lookup failed (non-blocking):`, fitErr);
    }

    // 3b. COLOR HEX EXTRACTION — FLAT IMAGE IS GROUND TRUTH (falls back to mannequin)
    // The flat product photo is studio-lit and color-calibrated — it's the definitive reference.
    // Gemini consistently lightens/shifts denim. We inject measured hex + LAB values as hard anchors.
    let garmentHexColor = '';
    let garmentColorBrightness = 0;
    if (flatColor) {
      // Use flat-measured color (preferred — ground truth)
      garmentHexColor = flatColor.hex;
      garmentColorBrightness = flatColor.brightness;
      console.log(`[Generate] 3b. Using FLAT color as ground truth: ${garmentHexColor} (brightness=${garmentColorBrightness.toFixed(0)})`);

      // v33: Simple hex injection into COLOR ANCHOR label — no LAB bloat
      const anchorIdx = referenceImages.findIndex(r => r.label.includes('COLOR ANCHOR'));
      if (anchorIdx >= 0) {
        referenceImages[anchorIdx].label += `\nEXTRACTED GARMENT COLOR: ${garmentHexColor}. The generated denim MUST match this exact color value.`;
      }
    } else if (mannequinBuffers.length > 0) {
      // Fallback: extract from mannequin front view (less accurate but better than nothing)
      try {
        const frontBuf = mannequinBuffers[0].buffer;
        const meta = await sharp(frontBuf).metadata();
        const imgW = meta.width || 1000;
        const imgH = meta.height || 1500;
        const sampleLeft = Math.round(imgW * 0.25);
        const sampleTop = Math.round(imgH * 0.40);
        const sampleW = Math.round(imgW * 0.50);
        const sampleHgt = Math.round(imgH * 0.30);

        const garmentSample = await sharp(frontBuf)
          .extract({ left: sampleLeft, top: sampleTop, width: sampleW, height: sampleHgt })
          .resize(20, 20, { fit: 'fill' })
          .raw()
          .toBuffer();

        let totalR = 0, totalG = 0, totalB = 0;
        const pixelCount = garmentSample.length / 3;
        for (let p = 0; p < garmentSample.length; p += 3) {
          totalR += garmentSample[p];
          totalG += garmentSample[p + 1];
          totalB += garmentSample[p + 2];
        }
        const avgR = Math.round(totalR / pixelCount);
        const avgG = Math.round(totalG / pixelCount);
        const avgB = Math.round(totalB / pixelCount);
        garmentHexColor = `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')}`;
        garmentColorBrightness = (avgR * 0.299 + avgG * 0.587 + avgB * 0.114);
        console.log(`[Generate] 3b. Fallback: mannequin color ${garmentHexColor} (brightness=${garmentColorBrightness.toFixed(0)})`);

        const anchorIdx = referenceImages.findIndex(r => r.label.includes('COLOR ANCHOR'));
        if (anchorIdx >= 0) {
          referenceImages[anchorIdx].label += `\nEXTRACTED GARMENT COLOR: ${garmentHexColor} (RGB ${avgR},${avgG},${avgB}). The generated denim MUST match this exact color value.`;
        }
      } catch (colorErr) {
        console.warn(`[Generate] 3b. Color extraction failed (non-blocking):`, colorErr);
      }
    }

    // 4. ZONE GRIDS — the v5 secret weapon (Learning #2, #20)
    // Generate cropped detail grids from mannequin images
    const category = garmentCategory || detectCategory(shotType);
    if (mannequinBuffers.length >= 2) {
      try {
        const zoneGrids = await generateZoneGrids(mannequinBuffers, category);
        let gridNum = 1;
        const totalGrids = zoneGrids.length;

        for (const grid of zoneGrids) {
          const gridLabel = `CONSTRUCTION DETAIL GRID ${gridNum}/${totalGrids}: ${grid.zoneName} zone from multiple angles. Copy seam patterns, hardware, and trim EXACTLY as shown.`;
          referenceImages.push({
            buffer: grid.buffer,
            mimeType: grid.mimeType,
            label: gridLabel,
          });
          // Store for Phase 2 injection
          zoneGridRefs.push({
            buffer: grid.buffer,
            mimeType: grid.mimeType,
            label: gridLabel,
            zoneName: grid.zoneName,
          });
          gridNum++;
        }
        console.log(`[Generate] 4. Zone grids: ${zoneGrids.length} grids generated`);
      } catch (err) {
        console.error(`[Generate] Zone grid generation failed (non-blocking):`, err);
      }
    }

    // 5. SPECIAL ZONE CROPS — per-garment signature details (e.g., carpenter pocket, flare)
    const garmentDNA = getGarmentDNA(designNumber);
    if (garmentDNA?.specialZones && mannequinBuffers.length > 0) {
      for (const sz of garmentDNA.specialZones) {
        try {
          const specialGrids = await generateZoneGrids(
            mannequinBuffers.filter(mb => sz.angles.includes(mb.index)),
            '__special__'  // Special category — use the zone's own definition
          );
          // If no special grids generated via the standard path, crop manually
          // Actually, let's add them as individual high-res crops
          for (const angleIdx of sz.angles) {
            const img = mannequinBuffers.find(mb => mb.index === angleIdx);
            if (!img) continue;
            try {
              const meta = await sharp(img.buffer).metadata();
              const w = meta.width || 1000;
              const h = meta.height || 1000;

              // Rotate if landscape
              let buf = img.buffer;
              let rw = w, rh = h;
              if (w > h * 1.3) {
                buf = await sharp(img.buffer).rotate(90).toBuffer();
                rw = h; rh = w;
              }

              const crop = await sharp(buf)
                .extract({
                  left: Math.round(rw * sz.x1),
                  top: Math.round(rh * sz.y1),
                  width: Math.round(rw * (sz.x2 - sz.x1)),
                  height: Math.round(rh * (sz.y2 - sz.y1)),
                })
                .resize(Math.round(Math.min(1000, rw * (sz.x2 - sz.x1) * sz.upscale)))
                .jpeg({ quality: 95 })
                .toBuffer();

              referenceImages.push({
                buffer: crop,
                mimeType: 'image/jpeg',
                label: sz.label,
              });
              break; // One crop per special zone is enough
            } catch (err) {
              console.error(`[Generate] Special zone crop failed for ${sz.name}:`, err);
            }
          }
        } catch (err) {
          console.error(`[Generate] Special zone generation failed:`, err);
        }
      }
      console.log(`[Generate] 5. Special zones: ${garmentDNA.specialZones.length} added for ${designNumber}`);
    }

    // 6. WARDROBE ITEMS
    // For FULL-BODY shots (M03/M04/M05): kept separate for Pass 2 (or skipped if dressed base active).
    // For CROPPED shots (M01/M02): injected DIRECTLY into Pass 1 refs AND Pass 2 runs as safety net,
    // because dressed base is NOT used as model reference for cropped shots (defeats framing).
    const jobDoc = await jobsCol.doc(jobId).get();
    const jobData = jobDoc.data();
    const wardrobeItemIds: Record<string, string> = jobData?.wardrobeItemIds || {};
    const wardrobePass2Images: Array<{ buffer: Buffer; mimeType: string; label: string; category: string; name: string }> = [];
    const wardrobeDescriptions: string[] = [];

    const focusCatGen = (garmentCategory || '').toLowerCase().trim();
    let hasOpenShoes = false;
    let hasHeels = false;
    if (Object.keys(wardrobeItemIds).length > 0) {
      for (const [wCat, wId] of Object.entries(wardrobeItemIds)) {
        const wCatLower = wCat.toLowerCase().trim();
        try {
          const item = await getWardrobeItem(wId);
          if (!item) continue;
          const itemData = item as any;
          const itemName = (itemData.name || '').toLowerCase();

          // Track if shoes are open-toe (for post-gen foot resize)
          if (wCatLower === 'shoes' && itemData.openShoes) {
            hasOpenShoes = true;
            console.log(`[Generate] Open shoes detected: "${itemData.name}" — foot resize will apply`);
          }
          // Track if shoes are heels (adjusts M01/M02 crop position)
          if (wCatLower === 'shoes' && itemData.hasHeels) {
            hasHeels = true;
            console.log(`[Generate] Heels detected: "${itemData.name}" — crop will adjust higher for longer legs`);
          }
          // Track actual wardrobe shoe and shirt names for prompt accuracy
          if (wCatLower === 'shoes') {
            wardrobeShoeName = itemData.name || '';
            console.log(`[Generate] Wardrobe shoes: "${wardrobeShoeName}"`);
          }
          if (wCatLower === 'shirt' || wCatLower === 'top' || wCatLower === 't-shirt') {
            wardrobeShirtName = itemData.name || '';
            console.log(`[Generate] Wardrobe shirt: "${wardrobeShirtName}"`);
            // v36: Only extract shirt color from FLAT images (product-on-white).
            // Model-on photos cause extractFlatColor to measure SKIN TONE instead of shirt color
            // because white shirt pixels get filtered as "background" and only skin pixels remain.
            // The shirt name + visual references + dressed base provide enough signal without hex.
            if (itemData.flatImageUrl) {
              try {
                const shirtBuf = await downloadGarmentImage(itemData.flatImageUrl.split('?')[0]);
                const shirtColor = await extractFlatColor(shirtBuf);
                wardrobeShirtHex = shirtColor.hex;
                wardrobeShirtDesc = shirtColor.hueDescription;
                console.log(`[Generate] Wardrobe shirt color measured from FLAT image: ${wardrobeShirtHex} (${wardrobeShirtDesc})`);
              } catch (shirtColorErr) {
                console.error(`[Generate] Shirt color extraction failed (non-blocking):`, shirtColorErr);
              }
            } else if (dressedBaseBuffer) {
              // v37b: No flat image — extract shirt color from dressed base chest zone
              // Sample the upper-center area (20-35% height, center 40% width) where the shirt is
              try {
                const dbShirtMeta = await sharp(dressedBaseBuffer).metadata();
                const dbSH = dbShirtMeta.height || 2400;
                const dbSW = dbShirtMeta.width || 1800;
                const sampleTop = Math.round(dbSH * 0.20);
                const sampleH = Math.round(dbSH * 0.15); // 20%-35% height range
                const sampleLeft = Math.round(dbSW * 0.30);
                const sampleW = Math.round(dbSW * 0.40); // center 40%
                const shirtSample = await sharp(dressedBaseBuffer)
                  .extract({ left: sampleLeft, top: sampleTop, width: sampleW, height: sampleH })
                  .resize(10, 10, { fit: 'fill' })
                  .raw()
                  .toBuffer();
                // Average the RGB pixels
                let rSum = 0, gSum = 0, bSum = 0;
                for (let i = 0; i < shirtSample.length; i += 3) {
                  rSum += shirtSample[i];
                  gSum += shirtSample[i + 1];
                  bSum += shirtSample[i + 2];
                }
                const px = shirtSample.length / 3;
                const rAvg = Math.round(rSum / px);
                const gAvg = Math.round(gSum / px);
                const bAvg = Math.round(bSum / px);
                wardrobeShirtHex = `#${rAvg.toString(16).padStart(2, '0')}${gAvg.toString(16).padStart(2, '0')}${bAvg.toString(16).padStart(2, '0')}`;
                const brightness = Math.round((rAvg + gAvg + bAvg) / 3);
                wardrobeShirtDesc = brightness < 80 ? 'dark grey/charcoal' : brightness < 140 ? 'medium grey' : 'light grey';
                console.log(`[Generate] Wardrobe shirt color measured from DRESSED BASE chest zone: ${wardrobeShirtHex} (${wardrobeShirtDesc}, brightness=${brightness})`);
              } catch (dbShirtErr) {
                console.warn(`[Generate] Shirt color extraction from dressed base failed:`, dbShirtErr);
              }
            } else {
              console.log(`[Generate] Wardrobe shirt "${wardrobeShirtName}" has no flat image and no dressed base — no hex available`);
            }
          }

          // Skip wardrobe items that share the same category as the focus garment
          // BUT never skip BASE items (e.g., BASE LEGGING) — they are neutral base layers
          if (!itemName.includes('base')) {
            if (wCatLower === focusCatGen || (wCatLower === 'pants' && (focusCatGen.includes('pant') || focusCatGen.includes('jean')))) {
              console.log(`[Generate] Skipping wardrobe "${wCat}" — same category as focus garment "${focusCatGen}"`);
              continue;
            }
          }
          wardrobeDescriptions.push(`${wCat.toUpperCase()}: ${itemData.description || itemData.name}`);

          // Load front view for Pass 2
          if (itemData.imageUrls?.length > 0) {
            const buf = await downloadGarmentImage(itemData.imageUrls[0].split('?')[0]);
            const resized = await resizeForFeed(buf, 900);
            wardrobePass2Images.push({
              buffer: resized,
              mimeType: 'image/jpeg',
              label: `WARDROBE REFERENCE — ${wCat.toUpperCase()} (Pass 2): "${itemData.name}". Replace the ${wCat} in the source image with this exact item. Match color, material, and style precisely.`,
              category: wCat,
              name: itemData.name,
            });
          }
          // Flat image for Pass 2 if available
          if (itemData.flatImageUrl) {
            try {
              const flatBuf = await downloadGarmentImage(itemData.flatImageUrl.split('?')[0]);
              const resizedFlat = await resizeForFeed(flatBuf, 800);
              wardrobePass2Images.push({
                buffer: resizedFlat,
                mimeType: 'image/jpeg',
                label: `WARDROBE FLAT — ${wCat.toUpperCase()} (Pass 2): "${itemData.name}" flat view. Additional color/texture reference.`,
                category: wCat,
                name: itemData.name,
              });
            } catch { /* non-blocking */ }
          }
          console.log(`[Generate] 6. Wardrobe ${wCat}: ${itemData.name} → queued for Pass 2`);
        } catch (err) {
          console.error(`[Generate] Failed to load wardrobe item ${wCat}/${wId}:`, err);
        }
      }
    }

    // 6b. Inject wardrobe images into Phase 1 references for ALL shots.
    // Without visual shirt/shoe references, Phase 1 guesses shirt color from text alone
    // and often gets it wrong (e.g., orange instead of white). The visual reference is essential.
    if (wardrobePass2Images.length > 0) {
      for (const wImg of wardrobePass2Images) {
        referenceImages.push({
          buffer: wImg.buffer,
          mimeType: wImg.mimeType,
          label: wImg.label.replace('(Pass 2)', '(MUST MATCH)'),
        });
      }
      console.log(`[Generate] 6b. Injected ${wardrobePass2Images.length} wardrobe images into Phase 1 for ${shotType}`);
    }

    console.log(`[Generate] Pass 1 reference images: ${referenceImages.length} | Wardrobe items for Pass 2: ${wardrobePass2Images.length} | Shot: ${shotType}-${variant}`);
    await reportProgress('Building prompt', 20);

    // Build Pass 1 prompt — wardrobe instructions added for cropped shots only
    let finalPrompt = prompt;
    // Inject garment hex color into prompt text (reinforces the image-level anchor)
    // v33: Simplified color lock — just hex, no LAB/silhouette data bloat (Kate-era style)
    if (garmentHexColor) {
      finalPrompt += `\n\nGARMENT COLOR LOCK: ${garmentHexColor}. The fabric MUST match this exact color.`;
    }

    if (garmentDNA) {
      finalPrompt += `\n\n${garmentDNA.dna}`;
      const shotKey = shotType;
      if (garmentDNA.shotOverrides?.[shotKey]) {
        finalPrompt += `\n\n${garmentDNA.shotOverrides[shotKey]}`;
      }
      console.log(`[Generate] Garment DNA injected: ${garmentDNA.styleName} (${garmentDNA.fit})`);
    }
    // For cropped shots: inject wardrobe descriptions into Pass 1 prompt so Gemini knows what to wear
    if (isCroppedShot && wardrobeDescriptions.length > 0) {
      finalPrompt += `\n\nWARDROBE — the model MUST wear these EXACT items:\n${wardrobeDescriptions.join('\n')}\nDo NOT use a white t-shirt or generic shoes. Match the wardrobe reference images EXACTLY.\nCRITICAL — SLEEVE LENGTH: Match the shirt/top sleeve length EXACTLY from the dressed base reference image. If the dressed base shows short sleeves (ending above elbow), the output MUST show short sleeves. If the dressed base shows long sleeves, the output MUST show long sleeves. Do NOT change the sleeve length.`;
      console.log(`[Generate] 6c. Wardrobe descriptions injected into Pass 1 prompt for ${shotType}`);
    }
    // Note: for full-body shots, wardrobeDescriptions intentionally NOT injected into Pass 1 prompt

    if (modification && originalPrompt) {
      finalPrompt = buildGenerationPrompt({
        modelDescription: '',
        garmentDescription: originalPrompt,
        shotDescription: '',
        garmentCategory: category,
        metadata: {},
        modifications: [modification],
        shotType,
      });

      await logModification({
        shotId: shotId!, jobId,
        instruction: modification,
        originalPrompt, newPrompt: finalPrompt,
      });
    }

    // ── Determine aspect ratio ──
    const aspectRatio = SHOT_ASPECT_RATIOS[shotType] || '3:4';

    // ── 2-PHASE ARCHITECTURE (v10) ──
    // Phase 1 (Pro): Generate garment template — mannequin refs only, no model card, no dressed base.
    //   Pro excels at garment fidelity (wash, pockets, labels, silhouette).
    // Phase 2 (Flash): Combine garment template + model card → final shot.
    //   Flash produces more photographic/natural output.
    // This separation means each model has ONE job — garment accuracy vs photographic realism.

    const isBackView = shotType === 'M02' || shotType === 'M04' || shotType === 'M05'; // M05 = detail shot of back pocket/bum
    const croppedShotView = shotType === 'M02' ? 'BACK' : 'FRONT';

    // ── PHASE 1: Garment Template (Pro) ──
    // Feed mannequin refs + flat image + zone grids + skin tone swatch.
    // v35: Skin-tone-locked Phase 1 — generate on the CORRECT skin tone from the start,
    // so Phase 2 doesn't need to "fix" skin color (which it often fails to do for crops/details).
    const phase1Refs = referenceImages.filter(r =>
      !r.label.includes('MODEL IDENTITY') &&
      !r.label.includes('MODEL DRESSED') &&
      !r.label.includes('SHOES REFERENCE')
    );

    // v35 Option A: Inject skin tone swatch into Phase 1 — a 100×100 solid color block
    // that gives Gemini a VISUAL anchor for the model's skin color. Text-only hex instructions
    // are routinely ignored by Gemini, especially for cropped/detail shots.
    let skinSwatchBuffer: Buffer | null = null;
    if (skinToneHex) {
      try {
        const hexClean = skinToneHex.replace('#', '');
        const swR = parseInt(hexClean.substring(0, 2), 16);
        const swG = parseInt(hexClean.substring(2, 4), 16);
        const swB = parseInt(hexClean.substring(4, 6), 16);
        skinSwatchBuffer = await sharp({
          create: { width: 100, height: 100, channels: 3, background: { r: swR, g: swG, b: swB } },
        }).jpeg({ quality: 95 }).toBuffer();

        phase1Refs.push({
          buffer: skinSwatchBuffer,
          mimeType: 'image/jpeg',
          label: `SKIN TONE SWATCH — This solid color block shows the EXACT skin tone of the model: ${skinToneDesc} (${skinToneHex}). ALL visible skin on the model (face, neck, arms, hands, legs, ankles) MUST match this color precisely. Do NOT default to a lighter or different skin tone. This is a measured color from the actual model — match it exactly.`,
        });
        console.log(`[Generate] v35: Skin tone swatch injected into Phase 1 — ${skinToneHex} (${skinToneDesc})`);
      } catch (swatchErr) {
        console.error(`[Generate] v35: Skin tone swatch creation failed (non-blocking):`, swatchErr);
      }
    }

    const phase1ViewPrompt = isBackView
      ? `Generate a BACK VIEW garment template image. The model faces AWAY from camera, showing the back of the garment.`
      : `Generate a FRONT VIEW garment template image. The model faces the camera.`;

    const phase1Prompt = `You are a fashion e-commerce photographer. ${phase1ViewPrompt}

TASK: Reproduce this EXACT garment on a generic ${modelGender} model.
${garmentCategory ? `\nGARMENT TYPE: This product is "${garmentCategory.toUpperCase()}". Generate ONLY this garment type — nothing else.` : ''}

CRITICAL — GARMENT FIDELITY:
- The mannequin reference images are the GROUND TRUTH. Match the exact wash, color, fading pattern.
- Match every construction detail: pockets (shape, placement, stitching), seams, belt loops, waistband, hardware.
- Match the silhouette exactly — if it's a flare, the flare width must match. If straight, keep straight.
- Do NOT invent details. No labels, patches, or stitching that don't exist in the reference.
${garmentHexColor ? `- GARMENT COLOR LOCK: ${garmentHexColor}. The fabric MUST match this exact color.` : ''}

CRITICAL — BACK POCKET STITCHING COLOR: The stitching on the back pockets MUST match the EXACT color shown in the mannequin back-view reference. If the mannequin shows tone-on-tone stitching (same color as denim), the output MUST show tone-on-tone stitching. Do NOT default to white/contrast stitching unless the mannequin reference CLEARLY shows white stitching. White stitching when the reference shows tone-on-tone = CRITICAL FAILURE.

CRITICAL — MANNEQUIN STRAPS ARE NOT GARMENT STRAPS:
- The mannequin torso has SHOULDER STRAPS, BANDS, and SUPPORT HARDWARE that hold the form together.
- These straps are EQUIPMENT — they are NOT denim straps, NOT overall straps, NOT part of the garment.
- If you see straps on the mannequin shoulders + denim pants below, the garment is PANTS/JEANS — NOT overalls or dungarees.
- The GARMENT TYPE above tells you what this product is. Trust the category, not the mannequin hardware.
- Generating overalls/dungarees when the product is pants or jeans is a CRITICAL FAILURE.

CRITICAL — DO NOT ADD DISTRESSING:
- Do NOT add tears, rips, fraying, distressing, or worn patches UNLESS they are CLEARLY visible in the mannequin photos.
- Clean denim is CLEAN — smooth, non-distressed fabric must stay smooth and non-distressed.
- Do NOT add fraying at pocket edges, knee rips, or distressed patches that do not exist in the reference.

${garmentDNA ? garmentDNA.dna : ''}

MODEL: ${modelGender}, medium build. ${skinToneHex ? `SKIN TONE (CRITICAL): ${skinToneDesc} (${skinToneHex}). A SKIN TONE SWATCH image is included in the references — match it EXACTLY on ALL visible skin (face, neck, arms, hands, legs, ankles). Wrong skin color is a CRITICAL FAILURE even though model identity is secondary. The skin tone swatch is the ground truth — do NOT default to lighter/different skin.` : ''} The model's face identity is secondary — but SKIN TONE is critical. Garment accuracy IS everything.
POSE: ${isBackView ? 'Standing back to camera.' : getEcomPosingRules(modelGender, garmentCategory || 'pants')}
FOOTWEAR: ${wardrobeShoeName ? `MUST wear "${wardrobeShoeName}" — match the shoe reference images EXACTLY. Do NOT substitute with boots, heels, or any other shoe type.` : hasOpenShoes ? 'Suede sandals (open toe, flat). Pant leg drapes OVER the sandal.' : getEcomFootwear(modelGender, (jobData as any)?.metadata?.fitDescription || '')}
${wardrobeShirtName ? `TOP: MUST wear "${wardrobeShirtName}" — match the shirt reference images EXACTLY.` : ['pants', 'jeans', 'shorts', 'skirt', 'trousers'].includes((garmentCategory || '').toLowerCase()) ? getEcomStylingTop(modelGender) : 'TOP: Simple neutral-color top (not the focus).'}
BACKGROUND: Clean warm light grey (#D5D3CC) studio backdrop — uniform, same tone everywhere. NO dark corners, NO gradient, NO vignetting. ONE very soft, subtle floor shadow. NO extra lighting on ground, NO rim lights.
STUDIO LIGHTING: BRIGHT, even, professional e-commerce studio lighting. The background brightness must be ~210/255. Do NOT use moody or dramatic lighting. Think: well-lit Zalando/ASOS product photography.
ASPECT: 9:16 portrait, full body head to toe visible.
${ECOM_NO_GOS}

${hasFitModelRefs
  ? `The reference images include BOTH mannequin angles AND fit model photos (real human wearing the garment).
Use MANNEQUIN images for: construction details, pocket placement, stitching, hardware, wash pattern, color.
Use FIT MODEL images for: how the fabric DRAPES and FALLS on a real body, natural silhouette, waist/hip/knee fit, fabric movement.
The fit model shows the TRUTH of how this garment looks when worn — prioritize its silhouette and drape over the mannequin's rigid shape.`
  : `The reference images show the garment from multiple angles on a mannequin. Use them ALL to understand the 3D construction, then render with photographic realism.`}

${finalPrompt.includes('FLOOR-LENGTH') ? 'HEM: Floor-length — hems touch/nearly touch the ground, shoes mostly hidden.' : ''}
${finalPrompt.includes('ANKLE-LENGTH') ? 'HEM: Ankle-length — hem ends at the ankle, full shoe visible.' : ''}`;

    // ── v35 Option B: SINGLE-PHASE M05 — skip Phase 1 entirely for detail shots ──
    // M05 is a tight back-pocket close-up. The 4K Pro garment fidelity of Phase 1 is wasted
    // on a pocket-sized area, and the Phase 1→2 handoff loses skin tone (causing ethnicity drift).
    // Single-phase Flash with dressed base + mannequin refs + skin tone swatch = better results.
    if (isDetailShot) {
      console.log(`[Generate] v35: M05 single-phase — skipping Phase 1/Phase 2 split`);
      await reportProgress('Generating detail shot (single phase)', 30);

      // Build M05 references: dressed base (back) + mannequin back views + zone grids + skin swatch
      const m05Refs: Array<{ buffer: Buffer; mimeType: string; label: string }> = [];

      // 1. Dressed base (back view) — identity + skin tone anchor
      if (dressedBaseActive && dressedBaseBuffer) {
        m05Refs.push({
          buffer: dressedBaseBuffer,
          mimeType: 'image/jpeg',
          label: `MODEL REFERENCE (BACK VIEW) — This is the ACTUAL model for this shot. Match EXACTLY: skin tone, body proportions, and all visible outfit items. The model's skin color is sacred — reproduce it precisely on all visible skin. SHIRT COLOR: The shirt/top color in this image is the GROUND TRUTH — the detail shot shirt MUST be this EXACT shade, not lighter, not darker.`,
        });
      }

      // 2. Front dressed base as SKIN TONE ANCHOR (even though M05 is back view)
      if (dressedBaseActive) {
        try {
          const hash = computeWardrobeHash(wardrobeIdsForDressed);
          const frontBase = await findDressedBase(modelId, hash, 'front');
          if (frontBase) {
            const frontUrl = (frontBase as any).imageUrl;
            if (frontUrl) {
              const frontBuf = await downloadGarmentImage(frontUrl.split('?')[0]);
              m05Refs.push({
                buffer: frontBuf,
                mimeType: 'image/jpeg',
                label: `SKIN TONE ANCHOR (FRONT VIEW) — Shows the model's face and skin color. Use ONLY for skin tone matching — do NOT use for pose or garment reference. All visible skin in the output MUST match this person's complexion.`,
              });
              console.log(`[Generate] v35: M05 — front dressed base injected as skin tone anchor`);
            }
          }
        } catch (frontErr) {
          console.warn(`[Generate] v35: M05 front skin anchor failed (non-blocking):`, frontErr);
        }
      }

      // 3. Skin tone swatch
      if (skinSwatchBuffer) {
        m05Refs.push({
          buffer: skinSwatchBuffer,
          mimeType: 'image/jpeg',
          label: `SKIN TONE SWATCH — Exact measured skin color: ${skinToneDesc} (${skinToneHex}). ALL visible skin MUST match this color.`,
        });
      }

      // 4. Mannequin back views (pocket detail references)
      const backAngles = mannequinBuffers.filter(mb => {
        const totalAngles = image360Urls?.length || 7;
        const backIdx = Math.floor(totalAngles / 2);
        return mb.index >= backIdx - 1 && mb.index <= backIdx + 1;
      });
      for (const mb of backAngles) {
        const resized = await resizeForFeed(mb.buffer, 1200);
        m05Refs.push({
          buffer: resized,
          mimeType: 'image/jpeg',
          label: `MANNEQUIN BACK VIEW — Back pocket construction reference. Copy pocket shape, stitching pattern, arc shape, rivets, and all construction details EXACTLY.`,
        });
      }
      // If no back angles found, use all mannequin refs
      if (backAngles.length === 0) {
        for (const ref of referenceImages.filter(r => r.label.includes('MANNEQUIN'))) {
          m05Refs.push(ref);
        }
      }

      // 5. Back hip zone grid (if available)
      for (const zone of zoneGridRefs.filter(z => z.zoneName.toLowerCase().includes('back hip') || z.zoneName.toLowerCase().includes('hip'))) {
        m05Refs.push({
          buffer: zone.buffer,
          mimeType: zone.mimeType,
          label: `BACK POCKET DETAIL GRID — ${zone.zoneName}. Copy every stitch, arc, and rivet EXACTLY.`,
        });
      }

      // 6. Flat image for color reference
      if (flatImageUrl) {
        const flatRef = referenceImages.find(r => r.label.includes('FLAT IMAGE'));
        if (flatRef) m05Refs.push(flatRef);
      }

      // 7. v37: COLOR ANCHOR — mannequin front view (index 0) with hex label
      // M05 was missing this entirely, causing dark denim drift. The front mannequin
      // is the definitive color reference — it's studio-lit and has the hex injected.
      const colorAnchorRef = referenceImages.find(r => r.label.includes('COLOR ANCHOR'));
      if (colorAnchorRef) {
        m05Refs.push(colorAnchorRef);
        console.log(`[Generate] v37: M05 — COLOR ANCHOR mannequin front injected`);
      }

      // 8. v37: M03 garment template as cross-shot color lock (same as M04 gets)
      try {
        const jobSnap = await jobsCol.doc(jobId).get();
        const anchorUrl = jobSnap.data()?.phase1AnchorUrl;
        if (anchorUrl) {
          const m03Buf = await downloadGarmentImage(anchorUrl.split('?')[0]);
          m05Refs.push({
            buffer: m03Buf,
            mimeType: 'image/png',
            label: `GARMENT COLOR ANCHOR (from M03 front) — This full-body front view shows the EXACT denim wash, color, and fading pattern. The detail shot MUST match this color precisely. Cross-shot color consistency is critical.`,
          });
          console.log(`[Generate] v37: M05 — M03 garment anchor loaded as color lock`);
        }
      } catch (m03Err) {
        console.warn(`[Generate] v37: M05 M03 anchor load failed (non-blocking):`, m03Err);
      }

      const m05Prompt = `Generate a DETAIL SHOT — TIGHT CLOSE-UP of ONE back pocket on a real person wearing these jeans.

FRAMING: Camera at hip height, ~40cm away. Frame from just above the back waistband to mid-thigh ONLY. One back pocket fills most of the frame. Slight 3/4 rear angle so the pocket shape and seat construction are three-dimensional.

PRODUCT PHOTOGRAPHY — like a detail zoom on an e-commerce product page.

GARMENT FIDELITY (CRITICAL):
- Reproduce the pocket EXACTLY as it appears in the mannequin reference photos.
- Every stitch line, arc shape, rivet, and denim texture must match the references precisely.
- Do NOT invent, add, or hallucinate ANY details not visible in the references — no extra stitch lines, no horizontal lines across the pocket, no extra creases, no labels, no patches.
- If the reference pocket has a clean curved arc stitch and nothing else, show ONLY that.
- POCKET PROPORTIONS: MEASURE the pocket height relative to the waistband-to-crotch distance in the references and reproduce that EXACT ratio.
${garmentHexColor ? `- GARMENT COLOR LOCK: ${garmentHexColor}. The denim MUST match this exact color.` : ''}

BACK POCKET STITCHING COLOR: Match the EXACT stitching color from the mannequin. Tone-on-tone stays tone-on-tone. Do NOT default to white/contrast stitching.

SKIN TONE (CRITICAL): ${skinToneHex ? `This model has ${skinToneDesc} (measured: ${skinToneHex}). A skin tone swatch is included — ALL visible skin MUST match it. Wrong skin tone is a CRITICAL FAILURE. Do NOT default to lighter skin.` : 'Match skin tone to the model reference.'}

MODEL: ${modelGender}, ${modelGender === 'female' ? 'feminine rear silhouette — natural curves through the denim' : 'athletic rear silhouette'}.
ONLY ONE PERSON — exactly two legs, two feet. NO extra limbs.

${wardrobeShirtName ? `SHIRT COLOR (CRITICAL): "${wardrobeShirtName}"${wardrobeShirtHex ? ` — MEASURED hex: ${wardrobeShirtHex} (${wardrobeShirtDesc}). Match this EXACT color.` : ''}. The shirt MUST be fully TUCKED INTO the jeans — waistband visible. Shirt color must be IDENTICAL to the full-body shots (M03/M04). Look at the dressed base reference for the EXACT shirt shade in studio lighting.` : ''}

BACKGROUND: Clean warm light grey (#D5D3CC) studio backdrop — uniform, same tone everywhere.
${ECOM_NO_GOS}

${garmentDNA ? garmentDNA.dna : ''}`;

      const m05Result = await generateImage({
        prompt: m05Prompt,
        referenceImages: m05Refs,
        aspectRatio: '3:4',
        imageSize: '2K',
        model: 'gemini-3.1-flash-image-preview',
      });
      let finalImageData = m05Result.imageData;
      console.log(`[Generate] v35: M05 single-phase complete — ${m05Refs.length} refs used`);
      await reportProgress('Post-processing', 75);

      // ── M05 POST-PROCESSING (same as two-phase path) ──

      // POST-PROCESS 2: Background check (logging only)
      try {
        const cornerSample = await sharp(finalImageData)
          .extract({ left: 5, top: 5, width: 10, height: 10 })
          .raw().toBuffer();
        console.log(`[Generate] POST2: M05 background (R=${cornerSample[0]},G=${cornerSample[1]},B=${cornerSample[2]})`);
      } catch { /* non-blocking */ }

      // v37: POST-PROCESS 3 for M05 — garment color correction (was missing entirely)
      // M05 had no brightness/color correction, causing unchecked dark drift.
      {
        try {
          const genMeta = await sharp(finalImageData).metadata();
          const genW = genMeta.width || 1800;
          const genH = genMeta.height || 2400;

          // (a) Background brightness — sample top-left + top-right corners
          const TARGET_BG_BRIGHTNESS = 210;
          const cornerSize = Math.round(Math.min(genW, genH) * 0.08);
          const bgSamples: Buffer[] = [
            await sharp(finalImageData)
              .extract({ left: 0, top: 0, width: cornerSize, height: cornerSize })
              .resize(10, 10, { fit: 'fill' }).raw().toBuffer(),
            await sharp(finalImageData)
              .extract({ left: genW - cornerSize, top: 0, width: cornerSize, height: cornerSize })
              .resize(10, 10, { fit: 'fill' }).raw().toBuffer(),
          ];
          const totalPx = bgSamples.reduce((sum, b) => sum + b.length / 3, 0);
          let bgR = 0, bgG = 0, bgB = 0;
          for (const buf of bgSamples) {
            for (let p = 0; p < buf.length; p += 3) {
              bgR += buf[p]; bgG += buf[p + 1]; bgB += buf[p + 2];
            }
          }
          bgR = Math.round(bgR / totalPx); bgG = Math.round(bgG / totalPx); bgB = Math.round(bgB / totalPx);
          const bgBrightness = bgR * 0.299 + bgG * 0.587 + bgB * 0.114;
          const bgDrift = (bgBrightness - TARGET_BG_BRIGHTNESS) / TARGET_BG_BRIGHTNESS;
          console.log(`[Generate] POST3a M05: Background — target=${TARGET_BG_BRIGHTNESS}, actual=${bgBrightness.toFixed(0)}, drift=${(bgDrift * 100).toFixed(1)}%`);

          // (b) Garment brightness — sample center of image (mostly denim on M05)
          let garmentDrift = 0;
          if (garmentHexColor && garmentColorBrightness > 0) {
            const sampleTop = Math.round(genH * 0.25);
            const sampleH = Math.round(genH * 0.40);
            const sampleLeft = Math.round(genW * 0.20);
            const sampleW = Math.round(genW * 0.60);
            const genSample = await sharp(finalImageData)
              .extract({ left: sampleLeft, top: sampleTop, width: sampleW, height: sampleH })
              .resize(20, 20, { fit: 'fill' }).raw().toBuffer();
            let gR = 0, gG = 0, gB = 0;
            const gPx = genSample.length / 3;
            for (let p = 0; p < genSample.length; p += 3) {
              gR += genSample[p]; gG += genSample[p + 1]; gB += genSample[p + 2];
            }
            gR = Math.round(gR / gPx); gG = Math.round(gG / gPx); gB = Math.round(gB / gPx);
            const genBrightness = gR * 0.299 + gG * 0.587 + gB * 0.114;
            garmentDrift = (genBrightness - garmentColorBrightness) / garmentColorBrightness;
            console.log(`[Generate] POST3b M05: Garment — reference=${garmentColorBrightness.toFixed(0)}, actual=${genBrightness.toFixed(0)}, drift=${(garmentDrift * 100).toFixed(1)}%`);
          }

          // Apply correction — M05 uses same thresholds as full-body shots
          const needsBgCorrection = bgDrift < -0.10;
          const needsGarmentDarken = garmentDrift > 0.15;
          const needsGarmentLighten = garmentDrift < -0.15;

          if (needsBgCorrection) {
            const factor = Math.min(1.35, TARGET_BG_BRIGHTNESS / bgBrightness);
            console.log(`[Generate] POST3 M05: Underexposed — brightening by ${((factor - 1) * 100).toFixed(1)}%`);
            finalImageData = await sharp(finalImageData).modulate({ brightness: factor }).jpeg({ quality: 95 }).toBuffer();
          } else if (needsGarmentDarken && garmentColorBrightness > 0) {
            const genB = garmentColorBrightness * (1 + garmentDrift);
            const factor = Math.max(0.75, garmentColorBrightness / genB);
            console.log(`[Generate] POST3 M05: Garment ${(garmentDrift * 100).toFixed(1)}% too bright — darkening by ${((1 - factor) * 100).toFixed(1)}%`);
            finalImageData = await sharp(finalImageData).modulate({ brightness: factor }).jpeg({ quality: 95 }).toBuffer();
          } else if (needsGarmentLighten && garmentColorBrightness > 0) {
            const genB = garmentColorBrightness * (1 + garmentDrift);
            const factor = Math.min(1.30, garmentColorBrightness / genB);
            console.log(`[Generate] POST3 M05: Garment ${(Math.abs(garmentDrift) * 100).toFixed(1)}% too dark — brightening by ${((factor - 1) * 100).toFixed(1)}%`);
            finalImageData = await sharp(finalImageData).modulate({ brightness: factor }).jpeg({ quality: 95 }).toBuffer();
          } else {
            console.log(`[Generate] POST3 M05: Lighting within tolerance — no correction`);
          }
        } catch (m05ColorErr) {
          console.error(`[Generate] POST3 M05: Brightness correction failed (non-blocking):`, m05ColorErr);
        }
      }

      // Upload to GCS
      await reportProgress('Uploading image', 90);
      const ver = version || 1;
      const filename = `${modelId}_${shotType}${variant !== 'A' ? variant : ''}_v${ver}.png`;
      const imageUrl = await uploadGeneratedImage(designNumber, filename, finalImageData);

      // Version history
      try {
        const currentShot = await shotsCol.doc(shotId!).get();
        const currentData = currentShot.data();
        if (currentData?.imageUrl && currentData.imageUrl !== imageUrl) {
          const prev = currentData.previousVersions || [];
          prev.push({ imageUrl: currentData.imageUrl, version: currentData.version || 1, createdAt: currentData.updatedAt || new Date() });
          await shotsCol.doc(shotId!).update({ previousVersions: prev });
        }
      } catch { /* non-blocking */ }

      // Update shot record
      await updateShot(shotId!, { status: 'done', imageUrl, version: ver, progressStep: '', progressPct: 100 });

      // Check if all shots done
      try {
        const allShots = await listShots(jobId);
        const allDone = allShots.length > 0 && allShots.every((s: any) => s.status === 'done' || s.status === 'approved');
        if (allDone) {
          await updateJobStatus(jobId, 'review');
          console.log(`[Generate] All shots done — job ${jobId} moved to 'review'`);
        }
      } catch { /* non-blocking */ }

      console.log(`[Generate] Auto-QC SUSPENDED (v28) — use manual QC via results page`);
      return NextResponse.json({ success: true, shotId, imageUrl, filename, qc: null });
    }

    // ── CROSS-SHOT GARMENT LOCK (v10) ──
    // M03 generates first (results page prioritizes it). Its Phase 1 garment template
    // is saved to GCS and referenced by all subsequent shots for color/detail consistency.
    let phase1ImageData: Buffer | null = null;

    // For non-M03 front shots: check if M03 anchor exists — reuse it instead of running Phase 1
    let usedM03Anchor = false;
    if (shotType !== 'M03' && !isBackView) {
      try {
        const jobSnap = await jobsCol.doc(jobId).get();
        const anchorUrl = jobSnap.data()?.phase1AnchorUrl;
        if (anchorUrl) {
          phase1ImageData = await downloadGarmentImage(anchorUrl.split('?')[0]);
          usedM03Anchor = true;
          console.log(`[Generate] Cross-shot lock: reusing M03 garment anchor for ${shotType}`);
        }
      } catch (anchorErr) {
        console.warn(`[Generate] Cross-shot lock: M03 anchor not available (${anchorErr}). Running own Phase 1.`);
      }
    }

    // For back-view shots: always run own Phase 1 (different angle)
    // For M03 or when no anchor available: run Phase 1
    if (!phase1ImageData) {
      console.log(`[Generate] Phase 1 (Pro garment template) starting — ${phase1Refs.length} refs, ${isBackView ? 'back' : 'front'} view${hasFitModelRefs ? ', fit+mannequin combined' : ''}...`);
      await reportProgress('Generating garment template (Phase 1)', 30);
      const phase1Result = await generateImage({
        prompt: phase1Prompt,
        referenceImages: phase1Refs,
        aspectRatio: '9:16',
        imageSize: '4K', // 4K for garment fidelity — construction details (knee seams, labels, stitching) need the resolution.
        model: 'gemini-3-pro-image-preview',
      });
      phase1ImageData = phase1Result.imageData;
      console.log(`[Generate] Phase 1 complete — garment template generated`);
      await reportProgress('Garment template ready', 50);

      // M03: save as garment anchor for other shots
      if (shotType === 'M03') {
        try {
          const anchorFilename = `phase1-anchor-${jobId}.png`;
          const anchorUrl = await uploadGeneratedImage(designNumber, anchorFilename, phase1ImageData);
          await jobsCol.doc(jobId).update({ phase1AnchorUrl: anchorUrl });
          console.log(`[Generate] M03 garment anchor saved → ${anchorUrl}`);
        } catch (saveErr) {
          console.warn(`[Generate] M03 anchor save failed (non-blocking):`, saveErr);
        }
      }
    }

    // For back-view shots: also load M03 front anchor as COLOR reference in Phase 2
    let m03ColorAnchorBuffer: Buffer | null = null;
    if (isBackView) {
      try {
        const jobSnap2 = await jobsCol.doc(jobId).get();
        const anchorUrl2 = jobSnap2.data()?.phase1AnchorUrl;
        if (anchorUrl2) {
          m03ColorAnchorBuffer = await downloadGarmentImage(anchorUrl2.split('?')[0]);
          console.log(`[Generate] Cross-shot lock: M03 front anchor loaded as color reference for ${shotType} back view`);
        }
      } catch { /* non-blocking */ }
    }

    // ── PRE-CROP Phase 1 template for M01/M02 ──
    // This is THE fix for cropped shots. Instead of generating full body then cropping post-hoc,
    // we crop the Phase 1 garment template to waist-to-shoes BEFORE passing to Phase 2.
    // Phase 2 then sees a cropped reference and composes the image correctly from the start.
    let phase2GarmentRef = phase1ImageData!;
    if (isCroppedShot && !fullBodyThenCrop && phase1ImageData) {
      // v30: DISABLED when fullBodyThenCrop — Phase 2 gets full-body template, crop happens on OUTPUT
      try {
        const templateMeta = await sharp(phase1ImageData).metadata();
        const tH = templateMeta.height || 2400;
        const tW = templateMeta.width || 1800;
        const cropFromTop = Math.round(tH * 0.35);
        const cropHeight = tH - cropFromTop;
        phase2GarmentRef = await sharp(phase1ImageData)
          .extract({ left: 0, top: cropFromTop, width: tW, height: cropHeight })
          .jpeg({ quality: 95 })
          .toBuffer();
        console.log(`[Generate] PRE-CROP: Phase 1 template cropped for ${shotType} — top=${cropFromTop} (35%), remaining height=${cropHeight}px.`);
      } catch (preCropErr) {
        console.error(`[Generate] PRE-CROP failed (using full template):`, preCropErr);
        phase2GarmentRef = phase1ImageData!;
      }
    } else if (fullBodyThenCrop) {
      console.log(`[Generate] v30: Full-body-then-crop — Phase 2 receives FULL template (no pre-crop). Output will be cropped post-generation.`);
    }

    // ── PHASE 2: Model Combination (Flash) ──
    // Feed: Phase 1 garment template + model card (or dressed base) → final shot.
    // Flash handles identity and photographic realism.
    const phase2Refs: Array<{ buffer: Buffer; mimeType: string; label: string }> = [];

    // 1. Garment template from Phase 1 (or M03 anchor) — pre-cropped for M01/M02
    phase2Refs.push({
      buffer: phase2GarmentRef,
      mimeType: 'image/png',
      label: (isCroppedShot && !fullBodyThenCrop)
        ? `GARMENT TEMPLATE (CROPPED) — This shows the garment from WAISTBAND to SHOES. The image is ALREADY cropped to the correct framing. Copy this garment pixel-perfectly: wash, color, pockets, silhouette, stitching, fading pattern, AND all construction details (knee panel seams, articulated knee lines, yoke seams, rivets). Your output MUST have the SAME composition — waistband at top, shoes at bottom, NO head visible. CRITICAL: every visible seam line and construction detail in this template MUST appear in your output.`
        : `GARMENT TEMPLATE — This is the GROUND TRUTH for the garment. Copy it pixel-perfectly: wash, color, pockets, silhouette, stitching, labels, fading pattern. Do NOT deviate from this garment in ANY way. The garment template is sacred.${usedM03Anchor ? ' (Cross-shot locked from M03 anchor — ensures identical garment across all shots.)' : ''}`,
    });

    // 1b. For back-view shots: add M03 front anchor as COLOR reference
    if (m03ColorAnchorBuffer) {
      phase2Refs.push({
        buffer: m03ColorAnchorBuffer,
        mimeType: 'image/png',
        label: `GARMENT COLOR ANCHOR (from front view) — The FRONT garment template above shows the back. This FRONT view confirms the EXACT wash color, fading pattern, and denim tone. The back view garment MUST match this color precisely. Cross-shot color consistency is critical.`,
      });
    }

    // 2. Model card or dressed base for identity
    // v30: fullBodyThenCrop makes M01/M02 use the same full dressed base path as M03/M04
    if (dressedBaseActive && dressedBaseBuffer && (!isCroppedShot || fullBodyThenCrop)) {
      phase2Refs.push({
        buffer: dressedBaseBuffer,
        mimeType: 'image/jpeg',
        label: `MODEL IDENTITY + WARDROBE REFERENCE — Use this model's face, skin tone, hair, body proportions. Also match the shirt/top and shoes from this reference. The LOWER BODY garment (jeans/pants) comes from the GARMENT TEMPLATE above — not from this image.`,
      });
      if (fullBodyThenCrop) {
        console.log(`[Generate] Phase 2: v30 full dressed base injected for ${shotType} (full-body-then-crop)`);
      }
    } else if (dressedBaseActive && dressedBaseBuffer && isCroppedShot && !fullBodyThenCrop) {
      // Legacy: cropped dressed base for M01/M02 when not using full-body-then-crop
      try {
        const dbMeta2 = await sharp(dressedBaseBuffer).metadata();
        const dbH2 = dbMeta2.height || 2400;
        const dbW2 = dbMeta2.width || 1800;
        const dbCropTop2 = Math.round(dbH2 * 0.35);
        const croppedDbForPhase2 = await sharp(dressedBaseBuffer)
          .extract({ left: 0, top: dbCropTop2, width: dbW2, height: dbH2 - dbCropTop2 })
          .jpeg({ quality: 95 })
          .toBuffer();
        phase2Refs.push({
          buffer: croppedDbForPhase2,
          mimeType: 'image/jpeg',
          label: `BODY REFERENCE (CROPPED) — Match body proportions, sleeve length, shoes, skin tone. IGNORE legwear.`,
        });
        // v37b: Inject FULL dressed base as shirt color anchor for cropped shots.
        // The cropped DB above cuts at 35% (waist-down), losing the shirt.
        // Gemini needs the full image to see the actual shirt color in studio lighting.
        if (wardrobeShirtName) {
          phase2Refs.push({
            buffer: dressedBaseBuffer,
            mimeType: 'image/jpeg',
            label: `SHIRT COLOR ANCHOR (FULL DRESSED BASE) — CRITICAL: Look at the shirt/top color on this model. The cropped shot MUST use this EXACT same shirt shade — not lighter, not darker, not a different hue. This is the GROUND TRUTH for shirt color in studio lighting.${wardrobeShirtHex ? ` Measured hex: ${wardrobeShirtHex} (${wardrobeShirtDesc}).` : ''} IGNORE the legwear in this image — use ONLY the garment template for jeans/pants.`,
          });
          console.log(`[Generate] Phase 2: v37b full dressed base injected as shirt color anchor for cropped shot (${wardrobeShirtName})`);
        }
      } catch (dbCropErr2) {
        console.warn(`[Generate] Phase 2: cropped dressed base injection failed:`, dbCropErr2);
      }
    } else if (modelCardBuffer && !isCroppedShot) {
      phase2Refs.push({
        buffer: modelCardBuffer,
        mimeType: 'image/png',
        label: `MODEL CARD — Use this model's face, skin tone, hair style, body proportions. The model is just the carrier — garment accuracy from the template is what matters.`,
      });
    }

    // 3. Wardrobe items for Phase 2
    for (const wImg of wardrobePass2Images) {
      const isCroppedShirt = (isCroppedShot && !fullBodyThenCrop) && (wImg.category.toLowerCase() === 'shirt' || wImg.category.toLowerCase() === 'top');
      const wardrobeLabel = isCroppedShirt
        ? `WARDROBE — ${wImg.category.toUpperCase()}: "${wImg.name}". Match color and style. Match sleeve length EXACTLY from the dressed base reference.`
        : `WARDROBE — ${wImg.category.toUpperCase()}: "${wImg.name}". Match this item exactly (color, style, material).`;
      phase2Refs.push({
        buffer: wImg.buffer,
        mimeType: wImg.mimeType,
        label: wardrobeLabel,
      });
    }

    // 4. Key zone grid crops — gives Flash construction detail references alongside the template
    // Hip grid = pockets, waistband, rivets, labels. Knee grid = seam construction, articulation.
    const keyZones = zoneGridRefs.filter(z =>
      z.zoneName.toLowerCase().includes('hip') ||
      z.zoneName.toLowerCase().includes('knee') ||
      z.zoneName.toLowerCase().includes('back hip')
    );
    for (const zone of keyZones) {
      phase2Refs.push({
        buffer: zone.buffer,
        mimeType: zone.mimeType,
        label: `PHASE 2 DETAIL REFERENCE — ${zone.zoneName}. Reproduce ONLY the construction details visible in this reference — nothing more, nothing less. Do NOT add any stitch lines, creases, or features not present in this image. If a pocket shows only a curved arc stitch, output only that curved arc stitch.`,
      });
    }
    if (keyZones.length > 0) {
      console.log(`[Generate] Phase 2: injected ${keyZones.length} zone grid crops for construction detail fidelity`);
    }

    const isCroppedPhase2 = isCroppedShot && !fullBodyThenCrop; // v30: false for M01/M02 — generate full body
    const expressionRule = 'EXPRESSION: Relaxed, confident, chin up, energy through eyes. Lips TOGETHER — NO smile showing teeth, NO grinning, NO laughing. Cool self-assured composure.';
    const ecomPoseHint = modelGender === 'female'
      ? 'Slight hip tilt, soft knee bend, weight on one leg — feminine and confident.'
      : 'Relaxed stance, thumbs hooked in pockets or at sides — masculine and confident.';
    const shotPoseDesc = isCroppedPhase2
      ? `CROPPED ${croppedShotView} VIEW — MATCH THE GARMENT TEMPLATE COMPOSITION EXACTLY. The garment template is already cropped to show waistband-to-shoes. Your output MUST have the SAME framing: waistband with belt loops clearly visible at TOP of frame, shoes at BOTTOM, NO head, NO chest, NO face. ${croppedShotView === 'BACK' ? 'Model faces away from camera.' : 'Front-facing.'} ${ecomPoseHint}`
      : isDetailShot
        ? `DETAIL SHOT — TIGHT CLOSE-UP of ONE back pocket. Camera at hip height, ~40cm away. Frame from just above waistband to mid-thigh ONLY. One back pocket fills most of the frame. Slight 3/4 rear angle. PRODUCT PHOTOGRAPHY — like a detail zoom on a product page. ACCURACY IS SACRED: reproduce the pocket EXACTLY as it appears in the reference photos. Every stitch line, arc shape, rivet, and denim texture must match the references precisely. Do NOT invent, add, or hallucinate ANY construction details not visible in the references — no extra stitch lines, no horizontal lines across the pocket, no extra creases, no labels, no patches. If the reference pocket has a clean curved arc stitch and nothing else, show ONLY that. Every stitch in the output must have a matching stitch in the reference. POCKET PROPORTIONS — MEASURE FROM REFERENCE: Pocket length varies per design. MEASURE the pocket height relative to the waistband-to-crotch distance in the reference and reproduce that EXACT ratio. Do NOT shorten or compact the pocket compared to the reference. ONLY ONE PERSON — exactly two legs, two feet. NO extra limbs, NO extra shoes, NO reflections or artifacts showing additional body parts in front of or behind the model. SHIRT TUCKED IN: The shirt/top MUST be fully TUCKED INTO the jeans/pants. The waistband, belt loops, and top button area MUST be clearly visible — the shirt never hangs over the waistband. Only a small portion of tucked-in shirt is visible above the waistband in this tight frame. ${modelGender === 'female' ? 'Feminine rear silhouette — natural curves through the denim.' : 'Athletic rear silhouette.'}`
        : (isBackView && !isDetailShot)
          ? `FULL BODY BACK VIEW — head to toe visible. Model faces away from camera, natural stance. ${ecomPoseHint} BACK POCKET PROPORTIONS — MEASURE FROM REFERENCE: Pocket length varies per design. MEASURE the pocket height relative to the waistband-to-crotch distance in the reference and reproduce that EXACT ratio. Do NOT shorten or compact the pocket compared to the reference. ${modelGender === 'female' ? 'Feminine buttock shape visible through denim.' : ''}`
          : `FULL BODY FRONT — head to toe visible. ${ecomPoseHint} ${expressionRule}`;

    const phase2Prompt = `PHASE 2: COMBINE garment template with model identity.

You are given reference images:
1. GARMENT TEMPLATE — the EXACT garment to reproduce. Copy it pixel-perfectly. This is sacred.
${!isCroppedPhase2 ? '2. MODEL CARD/DRESSED BASE — the model whose identity to use.' : ''}
${wardrobePass2Images.length > 0 ? `${!isCroppedPhase2 ? '3' : '2'}+. WARDROBE items the model must wear.` : ''}

TASK: Generate a final clean e-commerce studio photograph.

RULES:
- GARMENT: Copy the jeans/pants EXACTLY from the garment template. Same wash, same color, same pockets, same silhouette, same fading. Do not reinterpret. Do NOT add any stitch lines, creases, pocket details, or construction features that are not in the garment template — if a pocket is clean with only a curved arc stitch, it must stay clean with only that curved arc stitch.
- GARMENT COLOR UNIFORMITY (CRITICAL): The denim wash/shade MUST be PERFECTLY UNIFORM across the ENTIRE garment — from waistband to hem, front to back, left to right. NO two-toning. NO lighter zone at the buttock area. NO darker zone at the lower legs. NO color shift between hip and thigh. The ENTIRE garment is ONE consistent wash from the garment template. If any zone looks like a different shade than the rest, the image is WRONG.
- GARMENT SILHOUETTE: Match the garment silhouette EXACTLY from the garment template — same width at waist, hip, knee, and hem. Do NOT widen or narrow the legs. If the garment template shows wide/barrel legs, the output MUST show the same wide/barrel proportion.
- CONSTRUCTION DETAILS (CRITICAL): Reproduce EVERY visible construction detail from the garment template — knee panel seams, articulated knee construction lines, yoke seams, back pocket stitching arcs, rivets, belt loops, fly stitching. If the garment template shows 3D articulated knee panels with horizontal or diagonal seam lines across the knee area, those lines MUST appear in the output at the SAME position. Smooth knees when the template shows seam construction = CRITICAL FAILURE.

CRITICAL — BACK POCKET STITCHING COLOR: The stitching on the back pockets MUST match the EXACT color shown in the mannequin back-view reference. If the mannequin shows tone-on-tone stitching (same color as denim), the output MUST show tone-on-tone stitching. Do NOT default to white/contrast stitching unless the mannequin reference CLEARLY shows white stitching. White stitching when the reference shows tone-on-tone = CRITICAL FAILURE.

${!isCroppedPhase2 ? `- MODEL IDENTITY (CRITICAL): The person in the output MUST be the EXACT same person from the model card/dressed base reference. Same face, same skin tone, same hair color/style/length, same body build. A different-looking person is a CRITICAL FAILURE. Do NOT generate a random model — match the reference identity precisely. Do NOT change body type (slim model must stay slim, NOT become plus-size).` : `- MODEL: ${modelGender} model (cropped shot — no face visible). ${skinToneHex ? `CRITICAL — SKIN TONE: This model has ${skinToneDesc} (measured: ${skinToneHex}). All visible skin (hands, wrists, ankles, calves) MUST match this EXACT tone. Do NOT default to lighter skin. Wrong skin color is a CRITICAL FAILURE.` : ''}`}
- POSE: ${shotPoseDesc}
- BACKGROUND: Clean warm light grey (#D5D3CC) studio backdrop — uniform, same tone everywhere. NO dark corners, NO gradient, NO vignetting. ONE very soft, subtle floor shadow. NO extra lighting on ground, NO rim lights, NO backlighting.${isCroppedPhase2 ? `
- STUDIO LIGHTING (CRITICAL FOR CROPPED SHOTS): This is a BRIGHTLY LIT e-commerce studio photograph. The background MUST be a bright warm grey (#D5D3CC, brightness ~210/255). Do NOT use moody, dramatic, or dim lighting. The entire frame must feel evenly and brightly illuminated — as if shot under professional diffused studio strobes. Dark or underexposed backgrounds are a CRITICAL FAILURE. The lighting must match a full-body studio shot — just cropped tighter.` : ''}
- SKIN TONE: ${skinToneHex ? `This model's skin tone is ${skinToneDesc} (measured hex: ${skinToneHex}). Match this color on ALL visible skin.` : 'Match skin tone to the model card/dressed base reference.'}
- ASPECT: ${isCroppedPhase2 ? '3:4' : aspectRatio} portrait format.
- PHOTOGRAPHIC REALISM: This must look like a real ${isCroppedPhase2 ? 'BRIGHTLY LIT ' : ''}studio photograph, not a rendering or illustration. Warm editorial feel${isCroppedPhase2 ? ' with even, bright studio exposure across the entire frame' : ''}.
${ECOM_NO_GOS}
${wardrobeDescriptions.length > 0 ? `\nWARDROBE — the model MUST wear these EXACT items (no substitutions):\n${wardrobeDescriptions.join('\n')}` : ''}
${wardrobeShoeName ? `\nCRITICAL — SHOES: The model MUST wear "${wardrobeShoeName}". Match the shoe reference images. Do NOT substitute with boots, Chelsea boots, leather shoes, or any other footwear. IGNORE any footwear visible in the garment template — use ONLY this wardrobe shoe specification. If the wardrobe says sneakers, the output MUST show sneakers.${wardrobeShoeName.toLowerCase().includes('boot') ? `\nBOOT OVERRIDE: The jeans/pants MUST drape OVER the boot shaft. The boot shaft is completely hidden under the denim — only the toe cap and sole are visible. NEVER show jeans tucked INTO boots. NEVER show the boot shaft above the pant hem.` : ''}` : ''}
${wardrobeShirtName ? `\nCRITICAL — TOP/SHIRT COLOR (NON-NEGOTIABLE): The model wears "${wardrobeShirtName}".${wardrobeShirtHex ? ` MEASURED shirt color: ${wardrobeShirtHex} (${wardrobeShirtDesc}). This is a MATHEMATICAL measurement from the actual garment photo — match this EXACT color.` : ''} The shirt color MUST be IDENTICAL across every single shot — M01 through M05. The shirt must be ONE uniform color across the entire garment — no two-toning, no color shift between front and back. PLAIN — no logos, no prints, no graphics, no embroidery on the shirt.${isCroppedPhase2 ? ' Match sleeve length EXACTLY from the dressed base reference. The shirt texture must be smooth cotton jersey — NOT woven wool, NOT knit cable, NOT textured fabric.' : ''} Wrong shirt color = CRITICAL FAILURE.` : ''}
${isLowerBodyFocus && wardrobeShirtName ? `\nCRITICAL — SHIRT TUCKED IN (NON-NEGOTIABLE): The shirt/top MUST be fully TUCKED INTO the jeans/pants at ALL times. The waistband, belt loops, and top button/fly area of the jeans MUST be clearly visible — never hidden by the shirt. This is e-commerce product photography for DENIM — the waist area is a key product detail. A shirt hanging loose over the waistband = CRITICAL FAILURE. Tuck the shirt neatly all the way around — front, sides, and back.` : ''}

The most critical thing: the GARMENT must be IDENTICAL to the garment template. If there's any conflict between model appearance and garment accuracy, garment accuracy wins.`;

    const pass1AspectRatio = (isCroppedShot && !fullBodyThenCrop) ? '3:4' : (fullBodyThenCrop ? '9:16' : aspectRatio);
    console.log(`[Generate] Phase 2 (Flash model combination) starting — ${phase2Refs.length} refs...`);
    await reportProgress('Generating final image (Phase 2)', 55);
    const pass1Result = await generateImage({
      prompt: phase2Prompt,
      referenceImages: phase2Refs,
      aspectRatio: pass1AspectRatio,
      imageSize: '2K', // 2K for now — saves $0.084/shot vs 4K. Bump to 4K when quality demands it.
      model: 'gemini-3.1-flash-image-preview',
    });
    console.log(`[Generate] Phase 2 complete`);
    await reportProgress('Post-processing', 75);

    // ── v10: Old Pass 2 wardrobe edit REMOVED — Phase 2 already includes wardrobe refs ──
    let finalImageData = pass1Result.imageData;

    // ── POST-PROCESSING: Programmatic fixes that prompts can't do ──

    // POST-PROCESS 1: v30 — Full-body-then-crop for M01/M02
    // Generate at 9:16 full body (same pipeline as M03/M04 — correct sleeves, uniform t-shirt,
    // clean floor) then crop output to 3:4 by removing head+chest.
    // Previous v14 approach (pre-crop input) failed on sleeve length, 2-tone t-shirt, floor distortion.
    if (fullBodyThenCrop) {
      try {
        const cropMeta = await sharp(finalImageData).metadata();
        const outW = cropMeta.width!;
        const outH = cropMeta.height!;
        const target3x4Height = Math.round(outW * (4 / 3));
        if (outH > target3x4Height) {
          // Crop from top — keeps shoes at bottom, removes head + upper chest
          // At 9:16 (1920h): removes 480px (25%) → waist at top, shoes at bottom = perfect M01/M02 framing
          const cropFromTop = outH - target3x4Height;
          finalImageData = await sharp(finalImageData)
            .extract({ left: 0, top: cropFromTop, width: outW, height: target3x4Height })
            .jpeg({ quality: 95 })
            .toBuffer();
          console.log(`[Generate] POST1 v30: ${shotType} cropped from full-body — removed top ${cropFromTop}px (${((cropFromTop / outH) * 100).toFixed(0)}%), output ${outW}×${target3x4Height} (3:4)`);
        } else {
          console.log(`[Generate] POST1 v30: ${shotType} already at or below 3:4 ratio (${outW}×${outH}), no crop needed`);
        }
      } catch (cropErr) {
        console.error(`[Generate] POST1 v30: Crop failed for ${shotType} (non-blocking):`, cropErr);
      }
    }

    // POST-PROCESS 2: Background check (warm grey #D5D3CC is the target — no whitening)
    // v32: Reverted to Kate-era simple logging. Green screen chroma-key REMOVED.
    try {
      const cornerSample = await sharp(finalImageData)
        .extract({ left: 5, top: 5, width: 10, height: 10 })
        .raw()
        .toBuffer();
      const avgR = cornerSample[0];
      const avgG = cornerSample[1];
      const avgB = cornerSample[2];
      console.log(`[Generate] POST2: Background detected (R=${avgR},G=${avgG},B=${avgB}) — target is #D5D3CC (213,211,204). No modification applied.`);
    } catch (bgErr) {
      console.error(`[Generate] POST2: Background check failed (non-blocking):`, bgErr);
    }

    // POST-PROCESS 3: Studio lighting + garment brightness correction
    // v34: Two-pass check:
    // (a) Background brightness vs target #D5D3CC (~210) — catches overall underexposure
    // (b) Garment brightness vs measured hex — catches garment-specific darkening
    // Gemini has a systematic bias toward darker studio lighting.
    {
      try {
        const genMeta = await sharp(finalImageData).metadata();
        const genW = genMeta.width || 1800;
        const genH = genMeta.height || 2400;

        // (a) Background brightness check — sample regions where backdrop SHOULD be
        // Target: #D5D3CC = RGB(213,211,204) → brightness ~210
        // v36: For cropped shots (M01/M02), top corners contain waistband/clothing, NOT background.
        // Use side edges at mid-height + bottom corners instead — these are reliably background.
        const TARGET_BG_BRIGHTNESS = 210;
        const cornerSize = Math.round(Math.min(genW, genH) * 0.08);
        const bgSamples: Buffer[] = [];
        if (isCroppedShot) {
          // v37: Cropped shots (M01/M02): Previous side-edge sampling was contaminated by
          // denim/fabric, causing brightness correction to not trigger.
          // NEW: Sample a thin horizontal strip across the FULL WIDTH at the very top of the
          // frame (0-3% height). On waist-to-ankle crops, this is ABOVE the waistband —
          // reliably pure background. Also sample bottom corners (floor area).
          const topStripH = Math.max(cornerSize, Math.round(genH * 0.03));
          bgSamples.push(
            // TOP STRIP: full-width, top 3% of frame — most reliable background on cropped shots
            await sharp(finalImageData)
              .extract({ left: 0, top: 0, width: genW, height: topStripH })
              .resize(20, 5, { fit: 'fill' }).raw().toBuffer(),
            // TOP-LEFT corner (backup — should also be background)
            await sharp(finalImageData)
              .extract({ left: 0, top: 0, width: cornerSize, height: cornerSize })
              .resize(10, 10, { fit: 'fill' }).raw().toBuffer(),
            // TOP-RIGHT corner (backup)
            await sharp(finalImageData)
              .extract({ left: genW - cornerSize, top: 0, width: cornerSize, height: cornerSize })
              .resize(10, 10, { fit: 'fill' }).raw().toBuffer(),
            // BOTTOM-LEFT corner (floor area)
            await sharp(finalImageData)
              .extract({ left: 0, top: genH - cornerSize, width: cornerSize, height: cornerSize })
              .resize(10, 10, { fit: 'fill' }).raw().toBuffer(),
            // BOTTOM-RIGHT corner (floor area)
            await sharp(finalImageData)
              .extract({ left: genW - cornerSize, top: genH - cornerSize, width: cornerSize, height: cornerSize })
              .resize(10, 10, { fit: 'fill' }).raw().toBuffer(),
          );
          console.log(`[Generate] POST3a: Cropped shot — sampling top strip + top corners + bottom corners (v37)`);
        } else {
          // Full-body shots: top corners are above the head — pure background
          bgSamples.push(
            await sharp(finalImageData)
              .extract({ left: 0, top: 0, width: cornerSize, height: cornerSize })
              .resize(10, 10, { fit: 'fill' }).raw().toBuffer(),
            await sharp(finalImageData)
              .extract({ left: genW - cornerSize, top: 0, width: cornerSize, height: cornerSize })
              .resize(10, 10, { fit: 'fill' }).raw().toBuffer(),
          );
        }

        // Average all sample regions, but for cropped shots use BRIGHTEST sample
        // (most likely to be pure background, not contaminated by body/clothing)
        let bgR = 0, bgG = 0, bgB = 0;
        if (isCroppedShot && bgSamples.length >= 2) {
          // Pick the brightest sample region — most likely pure background
          let bestBrightness = 0;
          for (const buf of bgSamples) {
            let sR = 0, sG = 0, sB = 0;
            const sPx = buf.length / 3;
            for (let p = 0; p < buf.length; p += 3) {
              sR += buf[p]; sG += buf[p + 1]; sB += buf[p + 2];
            }
            sR = Math.round(sR / sPx); sG = Math.round(sG / sPx); sB = Math.round(sB / sPx);
            const sBri = sR * 0.299 + sG * 0.587 + sB * 0.114;
            if (sBri > bestBrightness) {
              bestBrightness = sBri;
              bgR = sR; bgG = sG; bgB = sB;
            }
          }
          console.log(`[Generate] POST3a: Cropped — used brightest of ${bgSamples.length} samples (brightness=${bestBrightness.toFixed(0)})`);
        } else {
          // Full-body: simple average of top corners
          const totalPx = bgSamples.reduce((sum, b) => sum + b.length / 3, 0);
          for (const buf of bgSamples) {
            for (let p = 0; p < buf.length; p += 3) {
              bgR += buf[p]; bgG += buf[p + 1]; bgB += buf[p + 2];
            }
          }
          bgR = Math.round(bgR / totalPx);
          bgG = Math.round(bgG / totalPx);
          bgB = Math.round(bgB / totalPx);
        }
        const bgBrightness = bgR * 0.299 + bgG * 0.587 + bgB * 0.114;
        const bgDrift = (bgBrightness - TARGET_BG_BRIGHTNESS) / TARGET_BG_BRIGHTNESS;
        console.log(`[Generate] POST3a: Background check — target=${TARGET_BG_BRIGHTNESS}, actual=${bgBrightness.toFixed(0)} (RGB ${bgR},${bgG},${bgB}), drift=${(bgDrift * 100).toFixed(1)}%${isCroppedShot ? ' [cropped-shot sampling]' : ''}`);

        // (b) Garment brightness check
        let garmentDrift = 0;
        if (garmentHexColor && garmentColorBrightness > 0) {
          const sampleTop = isCroppedShot ? Math.round(genH * 0.10) : Math.round(genH * 0.40);
          const sampleH = Math.round(genH * 0.30);
          const sampleLeft = Math.round(genW * 0.25);
          const sampleW = Math.round(genW * 0.50);
          const genSample = await sharp(finalImageData)
            .extract({ left: sampleLeft, top: sampleTop, width: sampleW, height: sampleH })
            .resize(20, 20, { fit: 'fill' }).raw().toBuffer();
          let gR = 0, gG = 0, gB = 0;
          const gPx = genSample.length / 3;
          for (let p = 0; p < genSample.length; p += 3) {
            gR += genSample[p]; gG += genSample[p + 1]; gB += genSample[p + 2];
          }
          gR = Math.round(gR / gPx); gG = Math.round(gG / gPx); gB = Math.round(gB / gPx);
          const genBrightness = gR * 0.299 + gG * 0.587 + gB * 0.114;
          garmentDrift = (genBrightness - garmentColorBrightness) / garmentColorBrightness;
          console.log(`[Generate] POST3b: Garment check — reference=${garmentColorBrightness.toFixed(0)}, actual=${genBrightness.toFixed(0)}, drift=${(garmentDrift * 100).toFixed(1)}%`);
        }

        // Apply correction if either background or garment is significantly off
        // Use background drift as primary signal (overall studio lighting)
        // Use garment drift as secondary (garment-specific color shift)
        // v37: With top-strip sampling (pure background), we can use a tighter threshold.
        // -3% for cropped = any slight underexposure gets corrected (Flash consistently dark).
        // Full-body stays at -10% (top corners are reliable, less prone to false positives).
        const bgThreshold = isCroppedShot ? -0.03 : -0.10;
        const needsBgCorrection = bgDrift < bgThreshold;
        const needsGarmentDarken = garmentDrift > 0.15; // garment >15% too bright
        const needsGarmentLighten = garmentDrift < -0.15; // garment >15% too dark

        if (needsBgCorrection) {
          // Overall image is underexposed — boost brightness based on background drift
          // v37: Allow up to 55% boost for cropped shots — Flash crops consistently
          // generate at ~170 brightness vs 210 target, needing ~24% boost.
          // 55% cap handles worst cases without over-brightening (sampling is now reliable).
          const maxBoost = isCroppedShot ? 1.55 : 1.35;
          const factor = Math.min(maxBoost, TARGET_BG_BRIGHTNESS / bgBrightness);
          console.log(`[Generate] POST3: Studio underexposed (bg ${(Math.abs(bgDrift) * 100).toFixed(1)}% dark). Brightening whole image by ${((factor - 1) * 100).toFixed(1)}%`);
          finalImageData = await sharp(finalImageData)
            .modulate({ brightness: factor })
            .jpeg({ quality: 95 })
            .toBuffer();
        } else if (needsGarmentDarken && garmentColorBrightness > 0) {
          // Garment too bright, background OK — darken
          const genB = garmentColorBrightness * (1 + garmentDrift);
          const factor = Math.max(0.75, garmentColorBrightness / genB);
          console.log(`[Generate] POST3: Garment ${(garmentDrift * 100).toFixed(1)}% too bright. Darkening by ${((1 - factor) * 100).toFixed(1)}%`);
          finalImageData = await sharp(finalImageData)
            .modulate({ brightness: factor })
            .jpeg({ quality: 95 })
            .toBuffer();
        } else if (needsGarmentLighten && garmentColorBrightness > 0) {
          // Garment too dark, background OK — lighten
          const genB = garmentColorBrightness * (1 + garmentDrift);
          const factor = Math.min(1.30, garmentColorBrightness / genB);
          console.log(`[Generate] POST3: Garment ${(Math.abs(garmentDrift) * 100).toFixed(1)}% too dark. Brightening by ${((factor - 1) * 100).toFixed(1)}%`);
          finalImageData = await sharp(finalImageData)
            .modulate({ brightness: factor })
            .jpeg({ quality: 95 })
            .toBuffer();
        } else {
          console.log(`[Generate] POST3: Lighting within tolerance — no correction needed`);
        }
      } catch (colorFixErr) {
        console.error(`[Generate] POST3: Brightness correction failed (non-blocking):`, colorFixErr);
      }
    }

    // POST-PROCESS 4: REMOVED — foot resize was causing hard straight edge cuts above ankles
    // on all full-body shots (M03, M04, M05). The dressed base (generate-dressed/route.ts)
    // already applies v7 foot resize (Sharp 60% + Gemini seam heal) so this was redundant
    // and harmful — double-resizing created visible artifacts.
    if (hasOpenShoes) {
      console.log(`[Generate] POST4: Foot resize SKIPPED — handled by dressed base (v7 Sharp+Gemini heal)`);
    }

    // POST-PROCESS 5: Label composite — DISABLED for now, testing separately
    // TODO: Re-enable after label quality validation
    // const isBackShot = shotType === 'M02' || shotType === 'M04';
    // if (isBackShot && mannequinBuffers.length > 0) { ... }
    console.log(`[Generate] POST5: Label composite SKIPPED (disabled for testing)`);

    // Upload to GCS
    await reportProgress('Uploading image', 90);
    const ver = version || 1;
    const filename = `${modelId}_${shotType}${variant !== 'A' ? variant : ''}_v${ver}.png`;
    const imageUrl = await uploadGeneratedImage(designNumber, filename, finalImageData);

    // ── VERSION HISTORY: preserve previous image before overwriting ──
    try {
      const currentShot = await shotsCol.doc(shotId!).get();
      const currentData = currentShot.data();
      if (currentData?.imageUrl && currentData.imageUrl !== imageUrl) {
        const prev = currentData.previousVersions || [];
        prev.push({
          imageUrl: currentData.imageUrl,
          version: currentData.version || 1,
          createdAt: currentData.updatedAt || new Date(),
        });
        await shotsCol.doc(shotId!).update({ previousVersions: prev });
        console.log(`[Generate] Version history: saved v${currentData.version || 1} to previousVersions (${prev.length} total)`);
      }
    } catch (vhErr) {
      console.error(`[Generate] Version history save failed (non-blocking):`, vhErr);
    }

    // Update shot record — clear progress fields
    await updateShot(shotId!, {
      status: 'done',
      imageUrl,
      version: ver,
      progressStep: '',
      progressPct: 100,
    });

    // ── Check if all shots for this job are done — move job to 'review' ──
    try {
      const allShots = await listShots(jobId);
      const allDone = allShots.length > 0 && allShots.every(
        (s: any) => s.status === 'done' || s.status === 'approved'
      );
      if (allDone) {
        await updateJobStatus(jobId, 'review');
        console.log(`[Generate] All shots done — job ${jobId} moved to 'review'`);
      }
    } catch (statusErr) {
      console.error('[Generate] Job status check failed (non-blocking):', statusErr);
    }

    // ── AUTO-QC: SUSPENDED (v28) ──
    // QC adds failure modes (stuck shots from self-call timeouts) and cost.
    // Re-enable once core generation pipeline is stable.
    // Manual QC via "Run QC Now" button on results page still works.
    const qcResult: any = null;
    console.log(`[Generate] Auto-QC SUSPENDED (v28) — use manual QC via results page`);

    return NextResponse.json({
      success: true,
      shotId, imageUrl, filename,
      qc: qcResult?.qcScores || null,
    });
  } catch (error) {
    console.error('Generation error:', error);

    // Reset shot to failed so the stale guard / run-all can retry it
    // Use the already-parsed variables (NOT req.clone() — body already consumed)
    try {
      if (shotId) await updateShot(shotId, { status: 'failed' });
    } catch { /* ignore */ }

    return NextResponse.json(
      { error: 'Generation failed', details: String(error) },
      { status: 500 }
    );
  }
}

// v33: chromaKeyToStudioBackground REMOVED (was dead code from v31 green-screen experiment)
/* v33: REMOVED — chromaKeyToStudioBackground was 160 lines of dead code from v31 green-screen experiment
async function chromaKeyToStudioBackground(imageBuffer: Buffer): Promise<{ buffer: Buffer; greenPct: number }> {
  const meta = await sharp(imageBuffer).metadata();
  const w = meta.width!;
  const h = meta.height!;

  // Get raw RGB pixels
  const raw = await sharp(imageBuffer)
    .removeAlpha()
    .raw()
    .toBuffer();

  // Pass 1: Create alpha mask based on green detection
  const alpha = Buffer.alloc(w * h);
  let greenPixels = 0;

  for (let i = 0; i < w * h; i++) {
    const r = raw[i * 3];
    const g = raw[i * 3 + 1];
    const b = raw[i * 3 + 2];

    // Green screen: G is dominant, R and B are low
    const greenness = g - Math.max(r, b);

    if (greenness > 50 && g > 150) {
      // Clearly green screen → fully transparent
      alpha[i] = 0;
      greenPixels++;
    } else if (greenness > 25 && g > 100) {
      // Transitional edge — partial transparency
      const a = Math.max(0, Math.min(255, Math.round(255 * (1 - (greenness - 25) / 25))));
      alpha[i] = a;
    } else {
      // Foreground → fully opaque
      alpha[i] = 255;
    }
  }

  const greenPct = (greenPixels / (w * h)) * 100;

  // If less than 20% green detected, the generation probably didn't use green screen
  // — return original image unchanged
  if (greenPct < 20) {
    return { buffer: imageBuffer, greenPct };
  }

  // Pass 2: Despill — remove green contamination from edge pixels
  const despilled = Buffer.from(raw);
  for (let i = 0; i < w * h; i++) {
    if (alpha[i] > 0 && alpha[i] < 255) {
      // Edge pixel — remove green spill
      const r = despilled[i * 3];
      const g = despilled[i * 3 + 1];
      const b = despilled[i * 3 + 2];
      const avgRB = (r + b) / 2;
      if (g > avgRB + 10) {
        // Green-contaminated — pull G down to average of R and B
        despilled[i * 3 + 1] = Math.round(Math.min(g, avgRB + 10));
      }
    }
  }

  // Create RGBA foreground
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = despilled[i * 3];
    rgba[i * 4 + 1] = despilled[i * 3 + 1];
    rgba[i * 4 + 2] = despilled[i * 3 + 2];
    rgba[i * 4 + 3] = alpha[i];
  }

  // Find bottom of subject for shadow placement
  let bottomRow = h - 1;
  let leftFoot = w, rightFoot = 0;
  for (let y = h - 1; y > h * 0.7; y--) {
    let hasSubject = false;
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > 128) {
        hasSubject = true;
        if (x < leftFoot) leftFoot = x;
        if (x > rightFoot) rightFoot = x;
      }
    }
    if (hasSubject && bottomRow === h - 1) {
      // Keep scanning to find the full foot width
    }
    if (!hasSubject && bottomRow === h - 1) {
      bottomRow = y + 1;
    }
  }
  // If we never found a gap, subject goes to bottom
  if (bottomRow === h - 1) {
    // Scan from bottom up for first foreground row
    for (let y = h - 1; y > 0; y--) {
      for (let x = 0; x < w; x++) {
        if (alpha[y * w + x] > 128) {
          bottomRow = y;
          break;
        }
      }
      if (bottomRow !== h - 1) break;
    }
  }

  const footWidth = Math.max(rightFoot - leftFoot, 50);
  const centerX = Math.round((leftFoot + rightFoot) / 2);

  // Build #D5D3CC background
  const bgR = 213, bgG = 211, bgB = 204;
  const bgCanvas = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    bgCanvas[i * 3] = bgR;
    bgCanvas[i * 3 + 1] = bgG;
    bgCanvas[i * 3 + 2] = bgB;
  }

  // Draw barely-visible floor shadow — G-Star ECOM style: "ONE very soft, barely visible floor shadow"
  // Very wide, very soft, very low opacity — should be almost imperceptible
  const shadowOpacity = 0.08; // Barely visible
  const shadowW = Math.round(footWidth * 1.5); // Wider than feet
  const shadowSpreadY = Math.max(Math.round(h * 0.025), 20); // Vertical spread
  const shadowY = bottomRow; // Exactly at foot level

  for (let dy = -2; dy <= shadowSpreadY * 4; dy++) {
    for (let dx = -shadowW * 2; dx <= shadowW * 2; dx++) {
      const py = shadowY + dy;
      const px = centerX + dx;
      if (py < 0 || py >= h || px < 0 || px >= w) continue;
      if (py < bottomRow - 2) continue;

      // Super-soft elliptical falloff
      const nx = dx / (shadowW * 1.5);
      const ny = dy / (shadowSpreadY * 2);
      const dist = Math.sqrt(nx * nx + ny * ny);

      if (dist < 2.0) {
        // Very gentle Gaussian — drops off gradually with no hard edge
        const intensity = Math.exp(-dist * dist * 1.5) * shadowOpacity;
        if (intensity > 0.001) {
          const idx = (py * w + px) * 3;
          const factor = 1 - intensity * 0.3; // Subtle darkening
          bgCanvas[idx] = Math.round(bgCanvas[idx] * factor);
          bgCanvas[idx + 1] = Math.round(bgCanvas[idx + 1] * factor);
          bgCanvas[idx + 2] = Math.round(bgCanvas[idx + 2] * factor);
        }
      }
    }
  }

  // Composite foreground (RGBA) over background (RGB) → final RGB
  const result = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255;
    result[i * 3] = Math.round(rgba[i * 4] * a + bgCanvas[i * 3] * (1 - a));
    result[i * 3 + 1] = Math.round(rgba[i * 4 + 1] * a + bgCanvas[i * 3 + 1] * (1 - a));
    result[i * 3 + 2] = Math.round(rgba[i * 4 + 2] * a + bgCanvas[i * 3 + 2] * (1 - a));
  }

  // Encode as JPEG
  const finalBuffer = await sharp(result, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();

  return { buffer: finalBuffer, greenPct };
}
v33: END OF REMOVED chromaKeyToStudioBackground */

/**
 * Build mannequin labels based on how many images are available.
 * Maps index to descriptive labels matching v5's reference approach.
 */
function buildMannequinLabels(count: number): Record<number, string> {
  if (count <= 3) {
    return {
      0: REF_LABELS.mannequinFront,
      1: REF_LABELS.mannequinSide,
      2: REF_LABELS.mannequinBack,
    };
  }
  if (count <= 5) {
    return {
      0: 'GARMENT ON MANNEQUIN (FRONT view, 0°). Copy every visible detail: seams, pockets, hardware, stitching.',
      1: 'GARMENT ON MANNEQUIN (FRONT 3/4, ~45°). Shows pocket angle and construction.',
      2: 'GARMENT ON MANNEQUIN (SIDE view, ~90°). Shows 3D construction, sculptured seat shape, and body silhouette.',
      3: 'GARMENT ON MANNEQUIN (BACK view, ~180°). The BACK PANEL is PLAIN unless shown otherwise here. Check for pockets, labels.',
      4: 'GARMENT ON MANNEQUIN (SIDE-BACK, ~270°). Additional angle showing rear construction from opposite side.',
    };
  }
  // 6-9 images — full 360° rotation with all key angles
  const step = Math.round(360 / count);
  const labels: Record<number, string> = {
    0: 'GARMENT ON MANNEQUIN (FRONT, 0°). Primary reference — front construction, fly, front pockets, waistband.',
    1: `GARMENT ON MANNEQUIN (FRONT-RIGHT, ~${step}°). Front pocket angle, coin pocket, side seam construction.`,
    2: `GARMENT ON MANNEQUIN (RIGHT SIDE, ~${step * 2}°). Side silhouette, outseam, 3D seat shape, side drape.`,
    3: `GARMENT ON MANNEQUIN (BACK-RIGHT, ~${step * 3}°). Transition to back — rear pocket placement angle.`,
    4: `GARMENT ON MANNEQUIN (BACK, ~${step * 4}°). Back pockets, yoke, back rise, rear labels. PLAIN unless shown otherwise.`,
  };
  // Add remaining angles (6-9)
  if (count > 5) labels[5] = `GARMENT ON MANNEQUIN (BACK-LEFT, ~${step * 5}°). Opposite rear angle — confirms back construction symmetry.`;
  if (count > 6) labels[6] = `GARMENT ON MANNEQUIN (LEFT SIDE, ~${step * 6}°). Opposite side view — confirms side seam and silhouette.`;
  if (count > 7) labels[7] = `GARMENT ON MANNEQUIN (FRONT-LEFT, ~${step * 7}°). Opposite front angle — confirms front pocket and fly construction.`;
  if (count > 8) labels[8] = `GARMENT ON MANNEQUIN (FRONT RETURN, ~${step * 8}°). Near-front angle completing the rotation.`;
  return labels;
}

/**
 * Detect garment category from shot type if not explicitly provided.
 */
function detectCategory(shotType: string): string {
  // Default to pants since that's the primary use case
  return 'pants';
}
