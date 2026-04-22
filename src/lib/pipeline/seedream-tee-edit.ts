/**
 * Seedream → Gemini tee-edit pipeline step.
 *
 * Seedream generates all shots with a "simple black sports bra" to avoid the
 * body seam artifact that occurs when rendering full tops. This module takes
 * the Seedream output and uses Gemini image editing to paint the REAL top onto
 * the model, using the flat top reference image + Opus-generated description.
 *
 * The V2 "layered under waistband" prompt consistently produces a tucked-in
 * look across all top styles tested (tees, vnecks, shirts, polos, etc.).
 *
 * Skipped for M05 (pocket close-up — no top visible).
 */
import { generateImage, type ReferenceImage } from '@/lib/vertex';
import { getWardrobeItem } from '@/lib/firestore';
import { normalizeWardrobeItem } from '@/lib/wardrobe-compat';
import type { ShotType, JobWardrobe } from '@/types';

export interface TeeEditParams {
  /** Seedream-generated image buffer (sports bra version) */
  sourceImage: Buffer;
  /** Job wardrobe config — used to look up top item */
  wardrobe: JobWardrobe;
  /** Shot type — determines front/back view for flat image selection */
  shotType: ShotType;
  /** Gemini API key override (optional, falls back to env) */
  apiKey?: string;
}

export interface TeeEditResult {
  /** Edited image with real top painted in */
  imageData: Buffer;
  mimeType: string;
  /** Whether the edit was actually performed (false = no top in wardrobe, returned original) */
  edited: boolean;
}

/** Shot types that should get tee-edit treatment. M05 (pocket close-up) does not — no top visible. */
const TEE_EDIT_SHOTS: Set<ShotType> = new Set(['M01', 'M02', 'M03', 'M04']);

/** Aspect ratios per shot type */
const ASPECT_RATIOS: Record<string, string> = {
  M01: '3:4',
  M02: '3:4',
  M03: '3:4',
  M04: '3:4',
};

/**
 * Check if a shot type needs tee-edit.
 * M05 (pocket close-up) does not — no top visible.
 */
export function needsTeeEdit(shotType: ShotType): boolean {
  return TEE_EDIT_SHOTS.has(shotType);
}

/**
 * Build the V2 "layered under waistband" edit prompt.
 * This prompt was validated across 20+ style variants.
 */
function buildEditPrompt(topDescription: string, shotType: ShotType): string {
  const view = shotType === 'M01' || shotType === 'M03' ? 'front' : 'back';

  return `Edit this e-commerce studio photo. The model is currently wearing a simple black sports bra. Replace it with the top shown in the reference image.

TOP TO PAINT: ${topDescription}

CRITICAL LAYERING INSTRUCTION:
The top covers the entire torso from shoulders to below the waistband. The bottom of the top is hidden UNDER the jeans — the denim waistband sits ON TOP of the shirt fabric. The shirt is completely tucked in with no fabric hanging over or bunching above the waistband. The waistband line is clean and unbroken.

VIEW: This is a ${view} view. Paint the top as it would appear from the ${view}.

PRESERVE EVERYTHING ELSE EXACTLY:
- Same skin tone, body pose, body proportions
- Same jeans (color, wash, fit, hem, pockets, stitching)
- Same shoes
- Same background (warm light-grey #D5D3CC)
- Same lighting (bright even studio)
- Same overall framing and composition

Only change: replace the sports bra with the described top, tucked into the jeans.`;
}

/**
 * Run the Gemini tee-edit step on a Seedream-generated image.
 *
 * Returns the original image unchanged if:
 * - Shot type doesn't need tee-edit (M05)
 * - No top item in wardrobe
 * - Top has no description and no flat image
 */
export async function applyTeeEdit(params: TeeEditParams): Promise<TeeEditResult> {
  const { sourceImage, wardrobe, shotType, apiKey } = params;

  // Guard: only M01-M04
  if (!needsTeeEdit(shotType)) {
    console.log(`[TeeEdit] Skipping for ${shotType} (no top visible)`);
    return { imageData: sourceImage, mimeType: 'image/png', edited: false };
  }

  // Find top item in wardrobe
  const topConfig = wardrobe['top' as keyof JobWardrobe];
  if (!topConfig?.itemId) {
    console.log(`[TeeEdit] No top item in wardrobe, returning Seedream output as-is`);
    return { imageData: sourceImage, mimeType: 'image/png', edited: false };
  }

  const topItem = await getWardrobeItem(topConfig.itemId) as any;
  if (!topItem) {
    console.warn(`[TeeEdit] Top item not found: ${topConfig.itemId}`);
    return { imageData: sourceImage, mimeType: 'image/png', edited: false };
  }

  // Get the Opus-cached top description
  let topDescription = topItem.topDescription || topItem.description || topItem.name || '';
  if (!topDescription) {
    // Lazy-compute via Opus if missing
    try {
      const { runTopDescriptionForWardrobe } = await import('@/lib/pipeline/top-description');
      topDescription = await runTopDescriptionForWardrobe(topConfig.itemId);
    } catch (err) {
      console.warn(`[TeeEdit] Top description analysis failed:`, err);
      topDescription = topItem.name || 'fitted top';
    }
  }

  // Get flat top reference image URL
  const normalized = normalizeWardrobeItem(topItem);
  const view = shotType === 'M01' || shotType === 'M03' ? 'front' : 'back';
  const flatUrl = view === 'front'
    ? (normalized?.flatFrontUrl || topItem.flatFrontUrl || topItem.flatImageUrl || topItem.imageUrl)
    : (normalized?.flatBackUrl || topItem.flatBackUrl || normalized?.flatFrontUrl || topItem.flatFrontUrl);

  if (!flatUrl) {
    console.warn(`[TeeEdit] No flat image URL for top item, skipping edit`);
    return { imageData: sourceImage, mimeType: 'image/png', edited: false };
  }

  // Download flat top image
  console.log(`[TeeEdit] Downloading flat top image: ${flatUrl.substring(0, 80)}...`);
  const flatResp = await fetch(flatUrl, { signal: AbortSignal.timeout(30_000) });
  if (!flatResp.ok) {
    console.error(`[TeeEdit] Failed to download flat top image: ${flatResp.status}`);
    return { imageData: sourceImage, mimeType: 'image/png', edited: false };
  }
  const flatBuffer = Buffer.from(await flatResp.arrayBuffer());
  const flatMime = flatResp.headers.get('content-type') || 'image/jpeg';

  // Build reference images for Gemini
  const referenceImages: ReferenceImage[] = [
    {
      buffer: sourceImage,
      mimeType: 'image/png',
      label: 'SOURCE IMAGE — model wearing sports bra (replace the bra with the real top)',
    },
    {
      buffer: flatBuffer,
      mimeType: flatMime,
      label: 'TOP REFERENCE — flat image of the top to paint onto the model',
    },
  ];

  const prompt = buildEditPrompt(topDescription, shotType);
  const aspectRatio = ASPECT_RATIOS[shotType] || '3:4';

  console.log(`[TeeEdit] ${shotType}: Calling Gemini edit (${topDescription.substring(0, 60)}..., aspect=${aspectRatio})`);

  try {
    const result = await generateImage({
      prompt,
      referenceImages,
      aspectRatio,
      model: 'gemini-3-pro-image-preview',
      apiKey,
    });

    console.log(`[TeeEdit] ${shotType}: Gemini edit complete (${result.imageData.length} bytes)`);
    return { imageData: result.imageData, mimeType: result.mimeType, edited: true };
  } catch (err) {
    console.error(`[TeeEdit] ${shotType}: Gemini edit failed, returning Seedream original:`, err);
    return { imageData: sourceImage, mimeType: 'image/png', edited: false };
  }
}
