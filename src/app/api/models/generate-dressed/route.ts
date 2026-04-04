import { NextRequest, NextResponse } from 'next/server';
import { computeWardrobeHash } from '@/lib/wardrobe-hash';
import {
  getModel,
  getWardrobeItem,
  createDressedBase,
  listDressedBases,
  deleteDressedBase,
  type DressedView,
} from '@/lib/firestore';
import { generateImage } from '@/lib/vertex';
import { downloadGarmentImage, uploadDressedBaseImage } from '@/lib/gcs';
import { resizeForFeed } from '@/lib/zone-grids';
import sharp from 'sharp';
import { getEcomPosingRules, ECOM_NO_GOS } from '@/lib/prompts';

// ── View pose instructions (0°, 90°, 180°, 270°) ─────────────────────────────
// EVERY view instruction ends with the framing rule to prevent headless generations.
// Gemini ignores global framing rules — repeating per-view is more reliable.
const FRAMING_RULE = 'MANDATORY FRAMING: The ENTIRE person from top of head (including hair) to bottom of shoes MUST be visible. Leave 10% empty space ABOVE the head and 10% BELOW the shoes. The HEAD is the MOST IMPORTANT part — if the head is cut off, the image is UNUSABLE. Place the figure in the CENTER of the frame vertically, NOT pushed to the top edge.';

const VIEW_POSES: Record<DressedView, string> = {
  front: `FRONT VIEW (0°): Model faces camera directly. Face visible — cool confident composure, lips TOGETHER (no teeth visible), chin slightly up, eyes on camera. Arms relaxed at sides or hands lightly at hips. Feet hip-width apart with slight weight shift. ${FRAMING_RULE}`,
  right: `RIGHT PROFILE VIEW (90°): The model has rotated 90° so their RIGHT SHOULDER points directly toward the camera. The model's face looks to the RIGHT (away from camera). Only the right side of the body is visible — the left arm, left leg, and left side of the torso are hidden behind the body. The camera sees the right side silhouette of the outfit. Both legs visible in profile. ${FRAMING_RULE}`,
  back:  `BACK VIEW (180°): Model faces completely AWAY from the camera. The model's back and rear are visible. Face is NOT visible. Arms relaxed at sides. Shows rear construction of garments. The back of the HEAD and HAIR must be visible at the top of the frame. ${FRAMING_RULE}`,
  left:  `LEFT PROFILE VIEW (270°): The model has rotated 90° so their LEFT SHOULDER points directly toward the camera. The model's face looks to the LEFT (away from camera). Only the left side of the body is visible — the right arm, right leg, and right side of the torso are hidden behind the body. The camera sees the left side silhouette of the outfit. Both legs visible in profile. ${FRAMING_RULE}`,
};

const VALID_VIEWS: DressedView[] = ['front', 'right', 'back', 'left'];

// ── GET /api/models/generate-dressed?modelId=X ─────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const modelId = searchParams.get('modelId');

  if (!modelId) {
    return NextResponse.json({ error: 'modelId required' }, { status: 400 });
  }

  try {
    const bases = await listDressedBases(modelId);
    return NextResponse.json({ bases });
  } catch (err) {
    console.error('[GenerateDressed GET] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── POST /api/models/generate-dressed ──────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { modelId, wardrobeItemIds, view: viewParam, seed, previousViewImages } = await req.json() as {
      modelId: string;
      wardrobeItemIds: Record<string, string>;
      view?: string;
      seed?: number;  // Fixed seed for cross-view consistency (passed by generate-dressed-all)
      previousViewImages?: Array<{ url: string; view: string }>;  // Color anchors from already-generated views
    };

    if (!modelId) return NextResponse.json({ error: 'modelId required' }, { status: 400 });
    if (!wardrobeItemIds || Object.keys(wardrobeItemIds).length === 0) {
      return NextResponse.json({ error: 'wardrobeItemIds required (at least one item)' }, { status: 400 });
    }

    const view: DressedView = VALID_VIEWS.includes(viewParam as DressedView)
      ? (viewParam as DressedView)
      : 'front';

    const wardrobeHash = computeWardrobeHash(wardrobeItemIds);
    console.log(`[GenerateDressed] model=${modelId} hash=${wardrobeHash} view=${view}`);

    // 1. Load model card
    const modelDoc = await getModel(modelId);
    if (!modelDoc) return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    const modelData = modelDoc as any;
    const modelGender: 'male' | 'female' = modelData.gender || 'female';

    const referenceImages: Array<{ buffer: Buffer; mimeType: string; label: string }> = [];

    // Model card as identity anchor — full resolution for maximum fidelity
    if (modelData.cardImageUrl) {
      const cleanUrl = modelData.cardImageUrl.split('?')[0];
      const cardBuffer = await downloadGarmentImage(cleanUrl);
      referenceImages.push({
        buffer: cardBuffer,
        mimeType: 'image/png',
        label: `MODEL IDENTITY REFERENCE — the generated image MUST be this EXACT person. Same face, same hair color and length, same skin tone, same body type. Do NOT alter any physical attribute.`,
      });
      console.log(`[GenerateDressed] Model card loaded for ${modelId}`);
    }

    // 2. Load wardrobe items — build outfit lines
    const wardrobeItemNames: Record<string, string> = {};
    const outfitLines: string[] = [];
    const garmentDnaLines: string[] = [];
    let refIdx = 2; // Image 1 = model card

    const sortedEntries = Object.entries(wardrobeItemIds)
      .filter(([, id]) => id)
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [category, itemId] of sortedEntries) {
      const item = await getWardrobeItem(itemId);
      if (!item) {
        console.warn(`[GenerateDressed] Wardrobe item not found: ${category}/${itemId}`);
        continue;
      }
      const itemData = item as any;
      wardrobeItemNames[category] = itemData.name;

      // Track open shoes for post-gen foot resize
      if (category.toLowerCase() === 'shoes' && itemData.openShoes) {
        (wardrobeItemNames as any).__hasOpenShoes = true;
        console.log(`[GenerateDressed] Open shoes detected: "${itemData.name}" — foot resize will apply after generation`);
      }

      let outfitLine = `${category.toUpperCase()}: "${itemData.name}" — reference image ${refIdx} shows this exact item.`;
      if (itemData.description) outfitLine += ` STYLING: ${itemData.description}`;
      outfitLines.push(outfitLine);

      // Note: garment DNA is now dynamically analyzed at generation time (not at dressed base time).
      // Dressed bases don't need garment construction DNA — they're about model identity + outfit.

      // ── Send ALL available reference images per wardrobe item ──
      // Structure per item: fit model images (fitModelUrls) + flat front/back (flatFrontUrl/flatBackUrl)
      // More angles = better garment accuracy for Gemini.
      let itemImageCount = 0;

      // A) Fit model images — primary garment reference (replaces mannequin 360°)
      if (itemData.fitModelUrls?.length > 0) {
        for (let imgIdx = 0; imgIdx < itemData.fitModelUrls.length; imgIdx++) {
          try {
            const buf = await downloadGarmentImage(itemData.fitModelUrls[imgIdx]);
            const resized = await resizeForFeed(buf, 900);
            const angleLabel = imgIdx === 0
              ? `WARDROBE ITEM — ${category.toUpperCase()}: "${itemData.name}". FIT MODEL REFERENCE. The model wears THIS EXACT item — copy color, material, silhouette, sole shape, and all details precisely.${itemData.description ? ' ' + itemData.description : ''}`
              : `${category.toUpperCase()} "${itemData.name}" — FIT MODEL angle ${imgIdx + 1}/${itemData.fitModelUrls.length}. Additional perspective for garment detail verification.`;
            referenceImages.push({ buffer: resized, mimeType: 'image/jpeg', label: angleLabel });
            refIdx++;
            itemImageCount++;
          } catch (dlErr) {
            console.warn(`[GenerateDressed] ${category}: failed to download fit model image ${imgIdx}: ${String(dlErr).substring(0, 100)}`);
          }
        }
      } else if (itemData.imageUrls?.length > 0) {
        // Legacy fallback: mannequin images for old wardrobe items not yet migrated
        for (let imgIdx = 0; imgIdx < itemData.imageUrls.length; imgIdx++) {
          try {
            const buf = await downloadGarmentImage(itemData.imageUrls[imgIdx]);
            const resized = await resizeForFeed(buf, 900);
            const angleLabel = imgIdx === 0
              ? `WARDROBE ITEM — ${category.toUpperCase()}: "${itemData.name}". REFERENCE. The model wears THIS EXACT item — copy color, material, silhouette, and all details precisely.${itemData.description ? ' ' + itemData.description : ''}`
              : `${category.toUpperCase()} "${itemData.name}" — angle ${imgIdx + 1}/${itemData.imageUrls.length}.`;
            referenceImages.push({ buffer: resized, mimeType: 'image/jpeg', label: angleLabel });
            refIdx++;
            itemImageCount++;
          } catch (dlErr) {
            console.warn(`[GenerateDressed] ${category}: failed to download legacy image ${imgIdx}: ${String(dlErr).substring(0, 100)}`);
          }
        }
      }

      // B) Flat front image
      if (itemData.flatFrontUrl || itemData.flatImageUrl) {
        try {
          const buf = await downloadGarmentImage((itemData.flatFrontUrl || itemData.flatImageUrl));
          const resized = await resizeForFeed(buf, 900);
          referenceImages.push({
            buffer: resized,
            mimeType: 'image/jpeg',
            label: `${category.toUpperCase()} "${itemData.name}" — FLAT FRONT image. Shows garment laid flat — use for color accuracy, fabric texture, and construction details.`,
          });
          refIdx++;
          itemImageCount++;
        } catch (dlErr) {
          console.warn(`[GenerateDressed] ${category}: failed to download flat front image: ${String(dlErr).substring(0, 100)}`);
        }
      }

      // C) Flat back image
      if (itemData.flatBackUrl) {
        try {
          const buf = await downloadGarmentImage(itemData.flatBackUrl);
          const resized = await resizeForFeed(buf, 900);
          referenceImages.push({
            buffer: resized,
            mimeType: 'image/jpeg',
            label: `${category.toUpperCase()} "${itemData.name}" — FLAT BACK image. Back construction reference: pocket shape, stitching, label placement.`,
          });
          refIdx++;
          itemImageCount++;
        } catch (dlErr) {
          console.warn(`[GenerateDressed] ${category}: failed to download flat back image: ${String(dlErr).substring(0, 100)}`);
        }
      }

      console.log(`[GenerateDressed] ${category}: loaded ${itemImageCount} total images for "${itemData.name}" (fitModel: ${itemData.fitModelUrls?.length || 0}, flatFront: ${itemData.flatFrontUrl ? 1 : 0}, flatBack: ${itemData.flatBackUrl ? 1 : 0})`);
    }

    if (outfitLines.length === 0) {
      return NextResponse.json({ error: 'No valid wardrobe items found' }, { status: 400 });
    }

    // 2b. Color anchors — previously generated views ensure consistent garment colors across all 4 angles
    let colorAnchorPrompt = '';
    if (previousViewImages && previousViewImages.length > 0) {
      for (const prev of previousViewImages) {
        try {
          const prevBuffer = await downloadGarmentImage(prev.url.split('?')[0]);
          const resized = await resizeForFeed(prevBuffer, 900);
          referenceImages.push({
            buffer: resized,
            mimeType: 'image/jpeg',
            label: `COLOR ANCHOR — ${prev.view.toUpperCase()} VIEW (already generated). This shows the EXACT shade/color of every garment as already established. Your output MUST match these IDENTICAL colors — same t-shirt shade, same shoe color, same skin tone warmth. Do NOT reinterpret colors from the wardrobe swatches.`,
          });
          refIdx++;
        } catch (dlErr) {
          console.warn(`[GenerateDressed] Failed to download color anchor (${prev.view}): ${String(dlErr).substring(0, 100)}`);
        }
      }
      colorAnchorPrompt = `\n\nCOLOR CONSISTENCY (CRITICAL): Previously generated views of this SAME outfit are included as color anchor references. The EXACT shade of every garment — t-shirt grey, shoe leather color, shorts black — has already been established. Your output MUST match those IDENTICAL shades. Do NOT pick a different interpretation of the color. Match pixel-for-pixel.`;
      console.log(`[GenerateDressed] Loaded ${previousViewImages.length} color anchor(s) from previous views`);
    }

    // 3. Detect uncovered zones — fill with neutral safe clothing
    const sortedCategories = sortedEntries.map(([cat]) => cat.toLowerCase());
    const hasLowerBody = sortedCategories.some(c => ['pants', 'jeans', 'shorts', 'skirt', 'trousers'].includes(c));
    const hasUpperBody = sortedCategories.some(c => ['jacket', 'shirt', 'top', 'blouse', 'coat', 'bomber', 'overshirt', 'vest'].includes(c));

    let uncoveredZoneRules = '';
    if (!hasLowerBody) {
      uncoveredZoneRules += `\n- LOWER BODY: SHORT black compression shorts — these are VERY SHORT, ending at MID-THIGH (like men's underwear boxer briefs, NOT cycling shorts, NOT leggings, NOT knee-length). Maximum 15cm inseam. The KNEES, SHINS, AND CALVES are completely BARE SKIN. If you generate anything longer than mid-thigh you have FAILED. NO leggings. NO capris. NO knee-length shorts. JUST short boxer-brief-style compression shorts and bare legs below.`;
    }
    if (!hasUpperBody) {
      uncoveredZoneRules += `\n- UPPER BODY: The model wears a plain white fitted cotton t-shirt — simple, clean, no logos or branding. Neutral basic only.`;
    }

    // 4. Build view-specific pose instruction
    const viewPoseRule = `- VIEW: ${VIEW_POSES[view]}`;

    // Gender-aware ECOM posing for dressed base
    const ecomPose = modelGender === 'female'
      ? 'Slight hip tilt, soft knee bend, weight on one leg — feminine and confident. NOT rigid military stance.'
      : 'Relaxed stance, thumbs hooked in pockets or at sides — masculine and confident.';

    const prompt = `Generate a FULL-BODY fashion reference photograph of this specific model wearing the specified outfit.

MODEL IDENTITY (image 1): This is the EXACT person to generate. Match face, hair, skin tone, body type PRECISELY. Do NOT change any physical attribute.

OUTFIT — the model wears EXACTLY these items and NOTHING ELSE (reference images provided):
${outfitLines.join('\n')}
${uncoveredZoneRules}${colorAnchorPrompt}

CRITICAL PROPORTION RULES:
- 175cm tall fashion model. Head = 1/8.5 of total height.
- Camera: 85mm lens, 5 meters distance, waist height. ZERO wide-angle distortion.
- Feet are SMALL and delicate — EU size 38. Each foot is narrower than the ankle.
- FRAMING — THIS IS THE MOST CRITICAL RULE: The HEAD (including all hair) MUST be fully visible with empty background above it. The model occupies only the MIDDLE 80% of the frame height. There MUST be at least 10% empty background ABOVE the top of the head AND 10% empty background BELOW the feet/shoes. If the head or hair is cut off at the top, the image is COMPLETELY UNUSABLE. Place the figure LOWER in the frame rather than risk cutting off the head. The soles of the shoes must also be fully visible with floor space beneath them.
- Clean warm light grey (#D5D3CC) studio backdrop — uniform, consistent, same tone everywhere. NO dark corners, NO dark patches at the bottom, NO visible gradient, NO vignetting. NOT pure white. ONE very soft, subtle floor shadow. NO glass, NO barriers, NO reflections

LIGHTING (G-STAR ECOM DIRECTION): Soft, even overhead studio lighting. Naturally warm skin tones — not cool/blue/clinical. The floor shadow should be barely visible — just a gentle hint. Clean, minimal studio feel.

EXPRESSION (G-STAR ECOM STANDARD): Relaxed, confident, approachable. Lips TOGETHER — NO smile showing teeth, NO grinning, NO forced smile. Cool self-assured composure with energy through the eyes. Chin slightly up. Eyes on camera (for front view). NOT blank stare, NOT cold — but NOT a toothy smile either. Think "I know I look good" not "say cheese".

RULES:
- Full body, head to toe visible in frame — clean full-body shot
${viewPoseRule}
- POSING: ${ecomPose}
- Copy each wardrobe item EXACTLY from its reference images — every detail (color, material, silhouette, labels, stitching) must trace back to a reference
- The model wears ONLY the listed wardrobe items plus the neutral base clothing specified above — nothing more, nothing different
- Only garments explicitly listed above appear on the model. The outfit is complete as specified.
- Accessories appear ONLY if explicitly listed above. Otherwise the model wears zero accessories (no belts, watches, jewelry, scarves, hats, bags, sunglasses).
- Neutral base clothing (plain white t-shirt, compression shorts) stays plain — no branding, no logos, no text, clean fabric only
- WARDROBE ITEM BRANDING: Labels, patches, and logos on wardrobe items must match the reference images 1:1 — correct position, size, color, and material. If a label is visible in the fit model/flat references, it appears in the output. If absent from all references, that area is clean fabric.
- Boots/shoes when listed: worn on the feet, visible below the model's base clothing
- FIT MODEL REFERENCE: The fit model reference photos show garments on a real person. Match the garment length and drape as shown in the fit model images.
- HEMS: Preserve original hem style — no rolling, cuffing, or folding unless the product description explicitly says cuffs or turn-ups
${ECOM_NO_GOS}${garmentDnaLines.length > 0 ? '\n\n' + garmentDnaLines.join('\n') : ''}`;

    console.log(`[GenerateDressed] Generating ${view} view with ${referenceImages.length} reference images`);

    // 5. Generate image — dressed bases generate once, no QC scoring
    let bestImageData: Buffer | null = null;
    let bestMimeType = 'image/png';
    const attemptLog: string[] = [];

    console.log(`[GenerateDressed] Generating ${view} view (dressed bases are reference anchors)`);

    try {
      const genResult = await generateImage({
        prompt,
        referenceImages,
        aspectRatio: '3:4',  // 3:4 gives horizontal breathing room — 9:16 was forcing zoom-in that cut off heads
        imageSize: '2K',
        model: 'gemini-3.1-flash-image-preview',
        ...(seed != null ? { seed } : {}),
      });
      bestImageData = genResult.imageData;
      bestMimeType = genResult.mimeType;
      attemptLog.push('Generation succeeded');
    } catch (genErr) {
      const msg = `Generation failed — ${String(genErr).substring(0, 200)}`;
      console.error(`[GenerateDressed] ${msg}`);
      attemptLog.push(msg);
      return NextResponse.json({ error: `Generation failed: ${String(genErr)}` }, { status: 500 });
    }

    console.log(`[GenerateDressed] Generation complete, uploading...`);

    // 5b. POST-PROCESS: Foot resize — Sharp resize + Gemini seam heal
    // Gemini often generates feet too large. Apply to ALL dressed bases.
    // But SKIP if feet are already near the frame edge (would make cropping worse).
    const hasOpenShoes = (wardrobeItemNames as any).__hasOpenShoes;
    if (bestImageData) {
      try {
        const fMeta = await sharp(bestImageData).metadata();
        const fW = fMeta.width || 1800;
        const fH = fMeta.height || 2400;

        // Sample actual background color from bottom corners (10x10 pixel patches)
        // This avoids hardcoding #D5D3CC and prevents visible canvas patches
        const cornerSize = 10;
        const bottomLeftCorner = await sharp(bestImageData)
          .extract({ left: 0, top: fH - cornerSize, width: cornerSize, height: cornerSize })
          .raw()
          .toBuffer();
        const bottomRightCorner = await sharp(bestImageData)
          .extract({ left: fW - cornerSize, top: fH - cornerSize, width: cornerSize, height: cornerSize })
          .raw()
          .toBuffer();
        // Average the corner pixels to get actual background color
        let rSum = 0, gSum = 0, bSum = 0, pxCount = 0;
        for (let i = 0; i < bottomLeftCorner.length; i += 3) {
          rSum += bottomLeftCorner[i]; gSum += bottomLeftCorner[i + 1]; bSum += bottomLeftCorner[i + 2]; pxCount++;
        }
        for (let i = 0; i < bottomRightCorner.length; i += 3) {
          rSum += bottomRightCorner[i]; gSum += bottomRightCorner[i + 1]; bSum += bottomRightCorner[i + 2]; pxCount++;
        }
        const bgR = Math.round(rSum / pxCount);
        const bgG = Math.round(gSum / pxCount);
        const bgB = Math.round(bSum / pxCount);
        console.log(`[GenerateDressed] Sampled background color: rgb(${bgR},${bgG},${bgB})`);

        // Check if feet/shoes are anywhere in the resize zone (bottom 15%)
        // Must match or exceed the resize zone (12%) to catch boots that sit above the very bottom
        const edgeCheckH = Math.round(fH * 0.15);
        const edgeStrip = await sharp(bestImageData)
          .extract({ left: Math.round(fW * 0.15), top: fH - edgeCheckH, width: Math.round(fW * 0.7), height: edgeCheckH })
          .raw()
          .toBuffer();
        let nonBgPixels = 0;
        const tolerance = 35; // color distance tolerance
        for (let i = 0; i < edgeStrip.length; i += 3) {
          const dr = Math.abs(edgeStrip[i] - bgR);
          const dg = Math.abs(edgeStrip[i + 1] - bgG);
          const db = Math.abs(edgeStrip[i + 2] - bgB);
          if (dr > tolerance || dg > tolerance || db > tolerance) nonBgPixels++;
        }
        const edgePixelCount = edgeStrip.length / 3;
        const nonBgRatio = nonBgPixels / edgePixelCount;

        if (nonBgRatio > 0.10) {
          // Feet are near frame edge — skip resize to avoid visible patches
          console.log(`[GenerateDressed] POST5a: SKIP foot resize — content in resize zone (${Math.round(nonBgRatio * 100)}% non-bg in bottom 15%). Relying on prompt for foot size.`);
        } else {
          // Clear space below feet — safe to resize
          const footFraction = 0.12;
          const footH = Math.round(fH * footFraction);
          const footTop = fH - footH;
          const scaleFactor = hasOpenShoes ? 0.60 : 0.75;
          const newFootW = Math.round(fW * scaleFactor);
          const offsetX = Math.round((fW - newFootW) / 2);

          const footStrip = await sharp(bestImageData)
            .extract({ left: 0, top: footTop, width: fW, height: footH })
            .resize(newFootW, footH, { fit: 'fill' })
            .toBuffer();

          // Use SAMPLED background color for canvas fill
          const footCanvas = await sharp({
            create: { width: fW, height: footH, channels: 3, background: { r: bgR, g: bgG, b: bgB } }
          }).jpeg({ quality: 98 }).toBuffer();

          const footComposite = await sharp(footCanvas)
            .composite([{ input: footStrip, left: offsetX, top: 0 }])
            .jpeg({ quality: 98 })
            .toBuffer();

          // Composite the resized foot strip back
          const resizedImageData = await sharp(bestImageData)
            .composite([{ input: footComposite, left: 0, top: footTop }])
            .jpeg({ quality: 95 })
            .toBuffer();

          // Gaussian blur a 6px band at the seam line to hide the transition
          const seamY = footTop;
          const blurBandH = 6;
          const blurBandTop = Math.max(0, seamY - blurBandH / 2);
          const seamBand = await sharp(resizedImageData)
            .extract({ left: 0, top: blurBandTop, width: fW, height: blurBandH })
            .blur(3)
            .toBuffer();

          bestImageData = await sharp(resizedImageData)
            .composite([{ input: seamBand, left: 0, top: blurBandTop }])
            .jpeg({ quality: 95 })
            .toBuffer();

          console.log(`[GenerateDressed] POST5a: Sharp foot resize applied (${scaleFactor * 100}% width, bottom ${footFraction * 100}%, bg=rgb(${bgR},${bgG},${bgB}), seam blur added)`);
        }
      } catch (footErr) {
        console.error(`[GenerateDressed] Foot resize failed:`, footErr);
      }
      if (hasOpenShoes) delete (wardrobeItemNames as any).__hasOpenShoes;
    }

    // 5c. NO CROP — dressed bases must be FULL BODY (head to toe).
    // They serve as identity + outfit references for all subsequent job shots.
    // Cropping was incorrectly added in v12 and removed — dressed bases need the full figure
    // including head/face for identity matching in Phase 2 generation.
    // NOTE: M01/M02 cropped shots handle their own cropping in generate/route.ts.

    // 6. Upload to GCS
    const imageUrl = await uploadDressedBaseImage(modelId, wardrobeHash, view, bestImageData);
    console.log(`[GenerateDressed] Uploaded: ${imageUrl}`);

    // 7. Store in Firestore
    const docId = await createDressedBase({
      modelId,
      wardrobeItemIds,
      wardrobeHash,
      view,
      imageUrl,
      wardrobeItemNames,
    });

    console.log(`[GenerateDressed] Saved as ${docId} (attempts=${attemptLog.length})`);

    return NextResponse.json({
      success: true,
      dressedBaseId: docId,
      imageUrl,
      wardrobeHash,
      wardrobeItemNames,
      attemptLog,
    });

  } catch (error) {
    console.error('[GenerateDressed POST] error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ── DELETE /api/models/generate-dressed?id=<docId> ─────────────────────────
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id query param required' }, { status: 400 });
  }

  try {
    await deleteDressedBase(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[GenerateDressed DELETE] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
