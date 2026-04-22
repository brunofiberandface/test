/**
 * Tee-overlay — two-stage Seedream→Gemini composite pipeline.
 *
 * PROBLEM: Seedream can't render a tucked-in tee. It always hangs loose.
 * SOLUTION: Seedream generates perfect jeans + sports bra. Gemini generates
 * a version with the real tee tucked in. Sharp composites: jeans from Seedream
 * (below waistband), tee from Gemini (above waistband), feathered blend zone.
 *
 * Result: pixel-perfect Seedream jeans + Gemini's tucked tee.
 *
 * WAISTBAND POSITIONS (fraction from top of image):
 * - M03/M04 (full body): ~0.40 (waistband at 40% from top)
 * - M01/M02 (cropped at hip): ~0.06 (waistband near top of frame)
 * - M05: no overlay needed (pocket close-up)
 */
import sharp from 'sharp';
import { generateImage, type ReferenceImage } from '@/lib/vertex';
import type { ShotType } from '@/types';

/** Blend line y-position as fraction from top of image, per shot type.
 * This is where the transition from Gemini (above) to Seedream (below) happens.
 * Set BELOW the waistband so the entire waistband + tuck zone comes from Gemini.
 * Only the legs/jeans below this line come from Seedream. */
const BLEND_RATIO: Record<string, number> = {
  M01: 0.10,  // cropped: frame starts at hip, blend just below waistband
  M02: 0.10,
  M03: 0.46,  // full body: blend well below waistband (waistband at ~40%, blend at 46%)
  M04: 0.46,
};

/** Height of the blend zone (in pixels) where Gemini and Seedream are feathered together. */
const BLEND_ZONE_PX = 60;

export interface TeeOverlayParams {
  /** Seedream-generated image with sports bra + perfect jeans */
  seedreamBuffer: Buffer;
  seedreamMimeType: string;
  /** Original Opus top description (e.g., "olive-green crew-neck relaxed-fit tee") */
  topDescription: string;
  /** Shot type — determines waistband position and whether overlay is needed */
  shotType: ShotType;
  /** Front or back view — affects the Gemini prompt */
  view: 'front' | 'back';
  /** Gemini API key */
  apiKey?: string;
}

export interface TeeOverlayResult {
  imageData: Buffer;
  mimeType: string;
}

/**
 * Run the tee-overlay pipeline:
 * 1. Gemini generates a version with the tee tucked in (using Seedream image as reference)
 * 2. Sharp composites: Seedream jeans (below waistband) + Gemini tee (above), feathered blend
 *
 * Returns the composited image. For M05, returns the Seedream image unchanged.
 */
export async function applyTeeOverlay(params: TeeOverlayParams): Promise<TeeOverlayResult> {
  const { seedreamBuffer, seedreamMimeType, topDescription, shotType, view, apiKey } = params;

  // M05 (pocket close-up) — no overlay needed
  if (shotType === 'M05' || !BLEND_RATIO[shotType]) {
    return { imageData: seedreamBuffer, mimeType: seedreamMimeType };
  }

  const waistbandRatio = BLEND_RATIO[shotType];

  console.log(`[TeeOverlay] ${shotType} ${view}: generating Gemini tee version...`);

  // Step 1: Ask Gemini to generate a version with the real tee tucked in
  const geminiPrompt = buildGeminiTeePrompt(topDescription, shotType, view);
  const geminiResult = await generateImage({
    prompt: geminiPrompt,
    referenceImages: [{
      buffer: seedreamBuffer,
      mimeType: seedreamMimeType,
      label: 'REFERENCE PHOTOGRAPH — reproduce this exact image but replace the sports bra with the described top, tucked into the jeans. Keep everything else identical: same pose, same jeans, same background, same lighting.',
    }],
    aspectRatio: (shotType === 'M03' || shotType === 'M04') ? '9:16' : '3:4',
    apiKey,
  });

  console.log(`[TeeOverlay] ${shotType}: Gemini version generated (${geminiResult.imageData.length} bytes)`);

  // Step 2: Composite — Seedream jeans (below waistband) + Gemini tee (above)
  const composited = await compositeAtWaistband(
    seedreamBuffer,
    geminiResult.imageData,
    waistbandRatio,
  );

  console.log(`[TeeOverlay] ${shotType}: composite complete (${composited.length} bytes)`);

  return { imageData: composited, mimeType: 'image/jpeg' };
}

/**
 * Build the Gemini prompt for generating the tucked-tee version.
 */
function buildGeminiTeePrompt(topDescription: string, shotType: ShotType, view: 'front' | 'back'): string {
  const isCropped = shotType === 'M01' || shotType === 'M02';
  const isBack = view === 'back';

  if (isCropped) {
    // Cropped shots: only a thin band of top visible above waistband
    return `Reproduce this reference photograph exactly — same person, same ${isBack ? 'back' : 'front'} pose, same jeans, same shoes, same background, same lighting, same framing. The ONLY change: replace the sports bra visible at the top of the frame with a thin band of a ${topDescription}. The top is tucked into the jeans — the fabric of the top goes inside the waistband, so only a narrow strip of top fabric is visible above the waistband. The waistband, belt loops, and everything below are identical to the reference. No bare skin between the top and the jeans.`;
  }

  // Full body shots: entire top visible from shoulders to waistband
  if (isBack) {
    return `Reproduce this reference photograph exactly — same person seen from the back, same pose, same jeans, same shoes, same warm light-grey background (hex #D5D3CC), same lighting, same framing.

CHANGE: Remove the sports bra. The model instead wears a ${topDescription}. This shirt is LONGER than the sports bra — it extends all the way down to the jeans waistband. The bottom hem of the shirt goes INSIDE the waistband of the jeans. The shirt fabric touches the waistband — there is ZERO gap, ZERO bare skin between the bottom of the shirt and the top of the jeans. The waistband sits on top of the tucked-in shirt fabric. Belt loops visible. The shirt covers the entire back from shoulders down to the waistband with no skin showing in between.

Keep the jeans, shoes, pose, hair, and background identical.`;
  }

  return `Reproduce this reference photograph exactly — same person, same front-facing pose, same jeans, same shoes, same warm light-grey background (hex #D5D3CC), same lighting, same framing.

CHANGE: Remove the sports bra. The model instead wears a ${topDescription}. This shirt is LONGER than the sports bra — it extends all the way down to the jeans waistband. The bottom hem of the shirt goes INSIDE the waistband of the jeans. The shirt fabric touches the waistband — there is ZERO gap, ZERO bare skin between the bottom of the shirt and the top of the jeans. The waistband sits on top of the tucked-in shirt fabric. Belt loops visible. The shirt covers the entire torso from shoulders down to the waistband with no skin showing in between.

Keep the jeans, shoes, pose, face, hair, and background identical.`;
}

/**
 * Composite two images at the waistband line with a feathered blend.
 *
 * Takes the TOP portion (above waistband) from the Gemini image and the
 * BOTTOM portion (below waistband) from the Seedream image. A Gaussian
 * feather blends the transition zone so there's no visible seam.
 *
 * Returns a JPEG buffer.
 */
async function compositeAtWaistband(
  seedreamBuf: Buffer,
  geminiBuf: Buffer,
  waistbandRatio: number,
): Promise<Buffer> {
  // Get dimensions from Seedream image (source of truth)
  const seedreamMeta = await sharp(seedreamBuf).metadata();
  const width = seedreamMeta.width!;
  const height = seedreamMeta.height!;

  // Resize Gemini output to match Seedream dimensions exactly
  const geminiResized = await sharp(geminiBuf)
    .resize(width, height, { fit: 'fill' })
    .raw()
    .toBuffer();

  const seedreamRaw = await sharp(seedreamBuf)
    .resize(width, height, { fit: 'fill' })
    .raw()
    .toBuffer();

  // Waistband y-position
  const waistY = Math.round(height * waistbandRatio);
  const blendTop = Math.max(0, waistY - BLEND_ZONE_PX / 2);
  const blendBottom = Math.min(height - 1, waistY + BLEND_ZONE_PX / 2);

  // Build composite: pixel-by-pixel blend in the transition zone
  const channels = 3; // RGB
  const result = Buffer.alloc(width * height * channels);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * channels;

    if (y < blendTop) {
      // Above blend zone: 100% Gemini (tee area)
      geminiResized.copy(result, rowOffset, rowOffset, rowOffset + width * channels);
    } else if (y > blendBottom) {
      // Below blend zone: 100% Seedream (jeans area)
      seedreamRaw.copy(result, rowOffset, rowOffset, rowOffset + width * channels);
    } else {
      // Blend zone: linear interpolation from Gemini → Seedream
      const t = (y - blendTop) / (blendBottom - blendTop); // 0 = all Gemini, 1 = all Seedream
      for (let x = 0; x < width; x++) {
        const px = rowOffset + x * channels;
        for (let c = 0; c < channels; c++) {
          const geminiVal = geminiResized[px + c];
          const seedreamVal = seedreamRaw[px + c];
          result[px + c] = Math.round(geminiVal * (1 - t) + seedreamVal * t);
        }
      }
    }
  }

  // Encode as JPEG
  return sharp(result, { raw: { width, height, channels } })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}
