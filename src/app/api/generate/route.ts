import { NextRequest, NextResponse } from 'next/server';
import { updateShot, logModification, jobsCol, shotsCol, getWardrobeItem, updateJobStatus, listShots, getModel } from '@/lib/firestore';
import { generateImage } from '@/lib/vertex';
import { uploadGeneratedImage, downloadGarmentImage } from '@/lib/gcs';
import sharp from 'sharp';

// v40: Drastically simplified — M03 only, single phase with gemini-3.0-pro-image-preview
export async function POST(req: NextRequest) {
  let shotId: string | undefined;
  try {
    const body = await req.json();
    let {
      shotId: shotIdParsed,
      jobId,
      designNumber,
      modelId,
      shotType,
      variant,
      version,
      garmentCategory,
      flatFrontUrl,
    } = body;
    shotId = shotIdParsed;

    // Only M03 is supported in v40
    if (shotType !== 'M03') {
      return NextResponse.json(
        { error: 'Only M03 generation is supported in v40' },
        { status: 400 }
      );
    }

    // Resolve missing fields from Firestore
    if (shotId && jobId) {
      try {
        const shotDoc = await shotsCol.doc(shotId).get();
        const shotDocData = shotDoc.data();
        if (shotDocData) {
          modelId = modelId || shotDocData.modelId;
          variant = variant || shotDocData.variant || 'A';
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
          flatFrontUrl = flatFrontUrl || jobDocData.flatFrontUrl || jobDocData.flatImageUrl || '';
        }
      } catch (e) {
        console.error(`[Generate] Failed to resolve job fields:`, e);
      }
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

    // Update shot status
    await updateShot(shotId!, { status: 'generating' });
    await reportProgress('Loading references', 5);

    // ── Collect reference images ──
    const referenceImages: Array<{ buffer: Buffer; mimeType: string; label: string }> = [];

    // 1. Flat front image
    let flatBuffer: Buffer | null = null;
    if (flatFrontUrl) {
      try {
        const cleanUrl = flatFrontUrl.split('?')[0];
        flatBuffer = await downloadGarmentImage(cleanUrl);
        referenceImages.push({
          buffer: flatBuffer,
          mimeType: 'image/jpeg',
          label: 'Garment Flat Image (Ground truth for proportions)',
        });
        console.log(`[Generate] 1. Flat front image loaded`);
      } catch (flatErr) {
        console.error(`[Generate] Failed to load flat front image:`, flatErr);
      }
    }

    // 2-4. Fit model front angles (indices 0, 1, last) at 2000px
    let fitModelBuffers: Array<{ buffer: Buffer; index: number }> = [];
    try {
      const jobDoc = await jobsCol.doc(jobId).get();
      const jobData = jobDoc.data();
      const garmentWardrobeId = jobData?.garmentWardrobeId;
      if (garmentWardrobeId) {
        const garmentItem = await getWardrobeItem(garmentWardrobeId);
        const fitUrls = (garmentItem as any)?.fitModelUrls || [];
        if (fitUrls.length > 0) {
          const indices = fitUrls.length > 2 ? [0, 1, fitUrls.length - 1] : [0];
          for (const idx of indices) {
            if (fitUrls[idx]) {
              const buf = await downloadGarmentImage(fitUrls[idx].split('?')[0]);
              const meta = await sharp(buf).metadata();
              const maxDim = Math.max(meta.width || 2000, meta.height || 2000);
              const resized = await sharp(buf)
                .resize(Math.round(2000 * Math.min(1, 2000 / maxDim)), Math.round(2000 * Math.min(1, 2000 / maxDim)), { fit: 'inside' })
                .toBuffer();
              fitModelBuffers.push({ buffer: resized, index: idx });
              referenceImages.push({
                buffer: resized,
                mimeType: 'image/jpeg',
                label: `Fit Model Front Angle ${fitModelBuffers.length}`,
              });
            }
          }
        }
      }
    } catch (fitErr) {
      console.error(`[Generate] Failed to load fit model images:`, fitErr);
    }
    console.log(`[Generate] 2-4. Loaded ${fitModelBuffers.length} fit model angles`);

    // 5. Wardrobe top image
    try {
      const jobDoc = await jobsCol.doc(jobId).get();
      const jobData = jobDoc.data();
      const wardrobeIds = jobData?.wardrobeItemIds || {};
      for (const [wCat, wId] of Object.entries(wardrobeIds)) {
        const wCatLower = (wCat as string).toLowerCase().trim();
        if (wCatLower === 'shirt' || wCatLower === 'top' || wCatLower === 't-shirt') {
          const item = await getWardrobeItem(wId as string);
          const itemData = item as any;
          if (itemData?.fitModelUrls?.[0] || itemData?.imageUrls?.[0]) {
            const url = (itemData.fitModelUrls?.[0] || itemData.imageUrls?.[0]).split('?')[0];
            const buf = await downloadGarmentImage(url);
            referenceImages.push({
              buffer: buf,
              mimeType: 'image/jpeg',
              label: `Top Reference (${itemData.name || 'Top'})`,
            });
            console.log(`[Generate] 5. Top reference loaded: ${itemData.name}`);
          }
          break;
        }
      }
    } catch (topErr) {
      console.error(`[Generate] Failed to load wardrobe top:`, topErr);
    }

    // 6. Wardrobe shoes image
    try {
      const jobDoc = await jobsCol.doc(jobId).get();
      const jobData = jobDoc.data();
      const wardrobeIds = jobData?.wardrobeItemIds || {};
      for (const [wCat, wId] of Object.entries(wardrobeIds)) {
        const wCatLower = (wCat as string).toLowerCase().trim();
        if (wCatLower === 'shoes') {
          const item = await getWardrobeItem(wId as string);
          const itemData = item as any;
          if (itemData?.fitModelUrls?.[0] || itemData?.imageUrls?.[0]) {
            const url = (itemData.fitModelUrls?.[0] || itemData.imageUrls?.[0]).split('?')[0];
            const buf = await downloadGarmentImage(url);
            referenceImages.push({
              buffer: buf,
              mimeType: 'image/jpeg',
              label: `Shoes Reference (${itemData.name || 'Shoes'})`,
            });
            console.log(`[Generate] 6. Shoes reference loaded: ${itemData.name}`);
          }
          break;
        }
      }
    } catch (shoesErr) {
      console.error(`[Generate] Failed to load wardrobe shoes:`, shoesErr);
    }

    await reportProgress('Building prompt', 10);

    // ── Build parameterized prompt ──
    let hemlineDescription = 'Floor-length. The hem rests heavily on top of the shoes, mostly concealing them.';
    let skinToneInstruction = 'Natural skin tone, consistent across all visible areas';
    let topDescription = 'Plain white baby t-shirt, completely tucked into the pants to reveal the full waistband.';
    let footwearDescription = 'Leather shoes matching the shoe reference.';
    let topName = 'Top';
    let shoesName = 'Shoes';

    try {
      const jobDoc = await jobsCol.doc(jobId).get();
      const jobData = jobDoc.data() as any;

      // Extract hemline from description
      if (jobData?.description) {
        const desc = (jobData.description as string).toLowerCase();
        if (desc.includes('floor-length') || desc.includes('floor length')) {
          hemlineDescription = 'Floor-length. The hem rests heavily on top of the shoes, mostly concealing them.';
        } else if (desc.includes('ankle-length') || desc.includes('ankle length') || desc.includes('cropped')) {
          hemlineDescription = 'Ankle-length. The hem ends at the ankle, full shoe visible.';
        } else if (desc.includes('wide leg') || desc.includes('wide-leg') || desc.includes('relaxed')) {
          hemlineDescription = 'Floor-length with wide leg opening. The hem rests on top of the shoes, mostly concealing them.';
        }
        // else keep default floor-length
      }

      // Get skin tone instruction
      const modelDoc = await getModel(modelId);
      const modelData = modelDoc as any;
      if (modelData?.skinToneHex) {
        skinToneInstruction = `Exact match to ${modelData.skinToneHex} across all visible skin`;
      }

      // Get wardrobe item names and descriptions
      const wardrobeIds = jobData?.wardrobeItemIds || {};
      for (const [wCat, wId] of Object.entries(wardrobeIds)) {
        const wCatLower = (wCat as string).toLowerCase().trim();
        const item = await getWardrobeItem(wId as string);
        const itemData = item as any;
        if (wCatLower === 'shirt' || wCatLower === 'top' || wCatLower === 't-shirt') {
          topName = itemData?.name || 'Top';
          topDescription = `${topName}, completely tucked into the pants to reveal the full waistband.`;
        }
        if (wCatLower === 'shoes') {
          shoesName = itemData?.name || 'Shoes';
          footwearDescription = `Leather shoes matching the '${shoesName}' reference.`;
        }
      }
    } catch (paramErr) {
      console.warn(`[Generate] Failed to extract parameters (non-blocking):`, paramErr);
    }

    const promptText = `ROLE: Expert fashion e-commerce photographer and retoucher.
OBJECTIVE: Generate a photorealistic, full-body, front-view studio shot of a model wearing the exact provided garment.
GARMENT SPECIFICATIONS (GROUND TRUTH):
* Garment Type: ${garmentCategory || 'Pants'}.
* Color & Wash: The fabric must perfectly match the target color and mirror the exact wash gradient shown in the fit model references.
* Topology & Construction: Reproduce the exact seam structures, fly stitching, and front pocket placements. look in detail at the flat image and look at the model pictures how this translate on an anatomical model. all details are important. everything must be in the generated picture. look in detail at the waist level, at the knee level and at the ankle level. also look for seems who go from top to bottom and follow their path exactly on the generation
* Fabric Condition: The denim fabric is pristine, completely intact, and features a smooth, continuous surface.
* Hemline: ${hemlineDescription}.
MODEL & STYLING:
* Identity: Female, slim build with feminine curves and visible bust — like a fashion model. Face identity is secondary to garment accuracy.
* Skin Tone: ${skinToneInstruction}
* Top: ${topDescription}
* Footwear: ${footwearDescription}
* Pose: E-commerce standard feminine stance. Slight hip tilt, soft bend in one knee, weight shifted to one leg. Hands relaxed at sides or lightly resting on the hip. Ensure a slight 3/4 body angle to display the garment's 3D fit. Expression is confident, relaxed, with lips together.
STUDIO ENVIRONMENT:
* Backdrop: Clean, uniform, warm light grey (#D5D3CC) seamless paper.
* Lighting: Bright, even e-commerce studio lighting.
* Floor: A single, soft, realistic drop shadow under the model.
STRICT SYSTEM EXCLUSIONS:
* The image must be completely unbranded (zero text, logos, watermarks, or leather patches).
* The styling must exclude caps, sunglasses, sneakers, or visible undergarments.
═══════════════════════════════════════════════════════════════
REFERENCE IMAGES PROVIDED:
1. Garment Flat Image (Ground truth for proportions)
2. Fit Model Front Angle
3. Fit Model Angle 1
4. Fit Model Angle 7
5. Top Reference (${topName})
6. Shoes Reference (${shoesName})`;

    console.log(`[Generate] Built prompt with ${referenceImages.length} reference images`);
    await reportProgress('Generating image', 20);

    // ── Single phase generation with gemini-3.0-pro-image-preview ──
    const result = await generateImage({
      prompt: promptText,
      referenceImages,
      aspectRatio: '9:16',
      imageSize: '2K',
      model: 'gemini-3.0-pro-image-preview',
    });

    let finalImageData = result.imageData;
    console.log(`[Generate] Image generated successfully`);
    await reportProgress('Post-processing', 75);

    // ── POST-PROCESS: Basic background brightness check + garment brightness correction ──
    try {
      const meta = await sharp(finalImageData).metadata();
      const genW = meta.width || 1440;
      const genH = meta.height || 2560;
      const TARGET_BG_BRIGHTNESS = 210;

      // Background brightness (top corners)
      const topLeft = await sharp(finalImageData)
        .extract({ left: 0, top: 0, width: Math.round(genW * 0.15), height: Math.round(genH * 0.08) })
        .resize(10, 10, { fit: 'fill' })
        .raw()
        .toBuffer();
      const topRight = await sharp(finalImageData)
        .extract({ left: Math.round(genW * 0.85), top: 0, width: Math.round(genW * 0.15), height: Math.round(genH * 0.08) })
        .resize(10, 10, { fit: 'fill' })
        .raw()
        .toBuffer();

      let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;
      for (const buf of [topLeft, topRight]) {
        for (let p = 0; p < buf.length; p += 3) {
          bgR += buf[p];
          bgG += buf[p + 1];
          bgB += buf[p + 2];
          bgCount++;
        }
      }
      bgR = Math.round(bgR / bgCount);
      bgG = Math.round(bgG / bgCount);
      bgB = Math.round(bgB / bgCount);

      const bgBrightness = bgR * 0.299 + bgG * 0.587 + bgB * 0.114;
      const bgDrift = (bgBrightness - TARGET_BG_BRIGHTNESS) / TARGET_BG_BRIGHTNESS;
      console.log(`[Generate] POST: Background brightness=${bgBrightness.toFixed(0)}, drift=${(bgDrift * 100).toFixed(1)}%`);

      const bgThreshold = -0.10;
      if (bgDrift < bgThreshold) {
        const factor = Math.min(1.35, TARGET_BG_BRIGHTNESS / bgBrightness);
        console.log(`[Generate] POST: Brightening by ${((factor - 1) * 100).toFixed(1)}%`);
        finalImageData = await sharp(finalImageData)
          .modulate({ brightness: factor })
          .jpeg({ quality: 95 })
          .toBuffer();
      } else {
        console.log(`[Generate] POST: Lighting within tolerance`);
      }
    } catch (colorFixErr) {
      console.error(`[Generate] POST: Brightness correction failed (non-blocking):`, colorFixErr);
    }

    // Upload to GCS
    await reportProgress('Uploading image', 90);
    const ver = version || 1;
    const filename = `${modelId}_M03${variant !== 'A' ? variant : ''}_v${ver}.png`;
    const imageUrl = await uploadGeneratedImage(designNumber, filename, finalImageData);

    const currentShotDoc = await shotsCol.doc(shotId!).get();
    const currentShotData = currentShotDoc.data();

    // VERSION HISTORY
    try {
      if (currentShotData?.imageUrl && currentShotData.imageUrl !== imageUrl) {
        const prev = currentShotData.previousVersions || [];
        prev.push({
          imageUrl: currentShotData.imageUrl,
          version: currentShotData.version || 1,
          createdAt: currentShotData.updatedAt || new Date(),
        });
        await shotsCol.doc(shotId!).update({ previousVersions: prev });
        console.log(`[Generate] Version history: saved v${currentShotData.version || 1} to previousVersions (${prev.length} total)`);
      }
    } catch (vhErr) {
      console.error(`[Generate] Version history save failed (non-blocking):`, vhErr);
    }

    // Save M03 garment anchor for future shots
    try {
      await jobsCol.doc(jobId).update({
        phase1AnchorUrl: imageUrl,
      });
      console.log(`[Generate] M03 garment anchor saved`);
    } catch (anchorErr) {
      console.error(`[Generate] M03 anchor save failed (non-blocking):`, anchorErr);
    }

    // Update shot record
    await updateShot(shotId!, {
      status: 'done',
      imageUrl,
      version: ver,
      progressStep: '',
      progressPct: 100,
    });

    // Check if all shots for this job are done — move job to 'review'
    try {
      const allShots = await listShots(jobId);
      // v40: "held" shots don't block job completion — only queued/generating/failed do
      const allDone = allShots.length > 0 && allShots.every(
        (s: any) => s.status === 'done' || s.status === 'approved' || s.status === 'held'
      );
      if (allDone) {
        await updateJobStatus(jobId, 'review');
        console.log(`[Generate] All shots done — job ${jobId} moved to 'review'`);
      }
    } catch (statusErr) {
      console.error('[Generate] Job status check failed (non-blocking):', statusErr);
    }

    return NextResponse.json({
      success: true,
      shotId,
      imageUrl,
      filename,
    });
  } catch (error) {
    console.error('Generation error:', error);

    try {
      if (shotId) await updateShot(shotId, { status: 'failed' });
    } catch { /* ignore */ }

    return NextResponse.json(
      { error: 'Generation failed', details: String(error) },
      { status: 500 }
    );
  }
}
