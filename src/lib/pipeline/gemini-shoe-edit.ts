/**
 * Gemini shoe-edit pipeline step (post-tee-edit).
 *
 * Seedream cannot reliably render the hem-over-shoe interaction for tall
 * footwear. The fit-model photos always show the garment on bare feet (or
 * the same height of footwear the silhouette text was anchored to), so when
 * Seedream pairs the garment with different shoes (cowboy boots, knee-high,
 * etc.) the hem ends up at the boot top instead of the floor.
 *
 * This step runs AFTER tee-edit. Takes the (now-tee'd) image + the actual
 * shoe reference, asks Gemini-3-pro to (a) extend the pant hem to floor
 * level (b) reposition the footwear UNDER the cascading hem so the boot is
 * mostly hidden inside the outer fabric tube, with only heel/sole visible.
 *
 * Validated 2026-05-07 against TLXfhGjJIrKh1IRYSPzH (CONTOR 3D EXTREME LOOSE
 * + cowboy boots regression). Locked prompt = v2 (prompt-only, no fit-model
 * reference; v3 with fit-model anchor caused the hem to copy bare-feet
 * proportions and pinch around the boot).
 *
 * Skipped for M05 (pocket close-up — no shoes visible).
 */
import { generateImage, type ReferenceImage } from '@/lib/vertex';
import { getWardrobeItem } from '@/lib/firestore';
import { normalizeWardrobeItem } from '@/lib/wardrobe-compat';
import type { ShotType, JobWardrobe } from '@/types';
import { silhouetteIndicatesCroppedHem } from './cropped-hem-detector';

export interface ShoeEditParams {
  /** Image buffer fresh out of tee-edit (or Seedream if tee-edit was skipped) */
  sourceImage: Buffer;
  /** Job wardrobe config — used to look up shoe item */
  wardrobe: JobWardrobe;
  /** Shot type — drives view (front/back) for shoe ref selection */
  shotType: ShotType;
  /** Gemini API key override (optional, falls back to env) */
  apiKey?: string;
}

export interface ShoeEditResult {
  imageData: Buffer;
  mimeType: string;
  /** False when intentionally skipped (M05, no shoe item) or all retries failed */
  edited: boolean;
  /** When edited=false because of a Gemini/network error (vs intentional skip), the error message */
  error?: string;
}

/** Shot types that should get the shoe-edit treatment.
 *
 * DISABLED 2026-05-07 (Bruno): Gemini-3-pro-image-preview was airbrushing
 * the denim texture across the WHOLE garment whenever it did the edit pass —
 * losing whisker fades, pocket details, fabric grain. Even with "preserve
 * pixel-by-pixel" prompt language, Gemini's image-edit regenerates pixels
 * around the edited region. Net regression worse than the boots-on-top-of-
 * pants problem we were trying to fix.
 *
 * The boots-on-top-of-pants issue affected only floor-length garments paired
 * with tall boots (rare combo). Reverting to Seedream-only output for those
 * shots is the lesser evil until we find a preservation strategy.
 *
 * To re-enable later: restore the prior set ['M03', 'M04', 'M06']. The skip
 * rule for cropped/cuffed garments is still in place below for when we do.
 */
const SHOE_EDIT_SHOTS: Set<ShotType> = new Set();

// Cropped-hem detector lives in ./cropped-hem-detector (shared with
// seedream-twopass.ts since 2026-05-12).

const ASPECT_RATIOS: Record<string, string> = {
  M03: '3:4',
  M04: '3:4',
  M06: '3:4',
};

/**
 * V2 prompt — locked by Bruno 2026-05-07 after iterating against the cowboy-
 * boots-tucked regression. Key principles:
 *   - Garment is OUTER LAYER, footwear is INNER (under) layer
 *   - Hem reaches FLOOR (not boot top, not mid-boot)
 *   - Hem-opening width preserves natural wide-leg drop (no pinching)
 *   - Only heel + sole + toe-tip visible at floor level
 */
function buildShoeEditPrompt(shoesDescription: string, shotType: ShotType): string {
  const view = shotType === 'M04' ? 'back' : 'front';
  return `Edit this e-commerce studio photo. The model is wearing pants. The current rendering may have the visible footwear positioned INCORRECTLY relative to the pant hem — either fully visible below a too-short hem, or stopping at the boot/shoe top.

YOUR TASK:
Lower the pant hem to the floor with the hem opening maintaining its NATURAL drop and width. The leg-opening width that the pant has at the knee / mid-leg continues UNCHANGED down to the floor — the hem opening width at floor level is the SAME as the leg opening width visible above (no narrowing, no tapering, no pinching, no cinching, no wrapping around the boot). The fabric falls straight down from the knee/mid-leg in soft natural folds, exactly as the same garment would hang on bare feet — except the hem reaches the floor instead of stopping at the ankle, because the hem has been extended downward to compensate for the footwear's height.

The footwear (${shoesDescription}, matching the FOOTWEAR REFERENCE image — Image 2) sits BEHIND / UNDERNEATH the cascading pant fabric. The pant fabric is the OUTER LAYER and remains the SAME WIDTH at the floor as it is above. The footwear is enveloped behind the outer tube of fabric. Only a small portion of the footwear remains visible: the heel from behind (peeking out under the hem at floor level) and the lower portion of the sole. The bulk of the boot/shoe upper exterior, the opening, and the shaft are HIDDEN behind the pant fabric, not because the fabric wraps around the boot but because the cascading wide-leg hem covers it from above and the front.

CRITICAL — PRESERVE NATURAL HEM SILHOUETTE:
- The hem of the pant in the output retains the EXACT WIDTH and DROP it would have on bare feet — wide, cylindrical, falling straight down. The output should look like the same garment just hemmed slightly longer to reach the floor over the footwear.
- The hem must NOT pinch, taper, narrow, wrap, cinch, gather, or shape itself around the boot at floor level.
- The hem must NOT bunch or stack at any single height (no "balloon at boot top", no "ankle-puddle around boot").
- The fabric falls in soft natural folds the way denim falls under gravity — the wide-leg silhouette is preserved at the bottom.

VIEW: This is a ${view} view. The footwear's visible portion (heel from behind, sole, toe-tip) is rendered as it would appear from the ${view}.

PRESERVE EVERYTHING ELSE EXACTLY:
- Same model identity, face, hair, body proportions, pose
- Same garment (pants): fabric, color, wash, seams, hardware, waistband, pocket placement, all construction details. Only the LENGTH is extended to reach the floor — the leg width, drape, and hem-opening shape stay matching the natural drop.
- Same top — do NOT alter the top in any way (color, fabric, fit, length, sleeves, neckline). The tee-edit step has already finalized the top; this step only adjusts the hem and footwear.
- Same backdrop and lighting
- Same framing, composition, aspect ratio, resolution

Only changes: (a) extend the pant hem downward to reach the floor (preserving the natural wide-leg drop and hem width), (b) re-position the footwear behind the cascading hem (mostly hidden, only heel + sole visible at floor level).`;
}

/**
 * Run the Gemini shoe-edit step. Returns sourceImage unchanged on any
 * intentional skip (M05, no shoe item, no shoe ref image) or after all
 * retries exhaust.
 */
export async function applyShoeEdit(params: ShoeEditParams): Promise<ShoeEditResult> {
  const { sourceImage, wardrobe, shotType, apiKey } = params;

  if (!SHOE_EDIT_SHOTS.has(shotType)) {
    console.log(`[ShoeEdit] Skipping for ${shotType} (no footwear in frame)`);
    return { imageData: sourceImage, mimeType: 'image/png', edited: false };
  }

  const shoeConfig = wardrobe['shoe' as keyof JobWardrobe];
  if (!shoeConfig?.itemId) {
    console.log(`[ShoeEdit] No shoe item in wardrobe — skipping`);
    return { imageData: sourceImage, mimeType: 'image/png', edited: false };
  }

  // Skip rule: garments with a cropped/cuffed/rolled/above-ankle hem must NOT
  // have their hem extended to the floor by shoe-edit. Read the focus bottom
  // garment's cached silhouette text and bail if it indicates a cropped hem.
  const bottomConfig = wardrobe['bottom' as keyof JobWardrobe];
  if (bottomConfig?.itemId) {
    const bottomItem = await getWardrobeItem(bottomConfig.itemId) as any;
    if (bottomItem) {
      const view = shotType === 'M04' ? 'back' : 'front';
      const silhouette: string = view === 'back'
        ? (bottomItem.silhouetteBack || bottomItem.silhouetteFront || '')
        : (bottomItem.silhouetteFront || bottomItem.silhouetteBack || '');
      if (silhouetteIndicatesCroppedHem(silhouette)) {
        console.log(`[ShoeEdit] ${shotType}: bottom garment has cropped/cuffed hem (silhouette signal) — skipping shoe-edit to preserve design intent`);
        return { imageData: sourceImage, mimeType: 'image/png', edited: false };
      }
    }
  }

  const shoeItem = await getWardrobeItem(shoeConfig.itemId) as any;
  if (!shoeItem) {
    console.warn(`[ShoeEdit] Shoe item not found: ${shoeConfig.itemId}`);
    return { imageData: sourceImage, mimeType: 'image/png', edited: false };
  }

  // Resolve shoe reference image for the view
  const view = shotType === 'M04' ? 'back' : 'front';
  const normalized = normalizeWardrobeItem(shoeItem);
  const shoeRefUrl = view === 'back'
    ? (normalized?.flatBackUrl || shoeItem.flatBackUrl || normalized?.flatFrontUrl || shoeItem.flatFrontUrl)
    : (normalized?.flatFrontUrl || shoeItem.flatFrontUrl || shoeItem.flatBackUrl);

  if (!shoeRefUrl) {
    console.warn(`[ShoeEdit] No shoe ref image URL for item ${shoeConfig.itemId}; skipping`);
    return { imageData: sourceImage, mimeType: 'image/png', edited: false };
  }

  // Resolve the shoe description (used inside the prompt to anchor style)
  const shoesDescription = shoeItem.description || shoeItem.name || 'footwear';

  console.log(`[ShoeEdit] ${shotType}: Downloading shoe ref: ${shoeRefUrl.substring(0, 80)}...`);
  const shoeResp = await fetch(shoeRefUrl, { signal: AbortSignal.timeout(30_000) });
  if (!shoeResp.ok) {
    console.error(`[ShoeEdit] Failed to download shoe ref: ${shoeResp.status}`);
    return { imageData: sourceImage, mimeType: 'image/png', edited: false };
  }
  const shoeBuffer = Buffer.from(await shoeResp.arrayBuffer());
  const shoeMime = shoeResp.headers.get('content-type') || 'image/jpeg';

  const referenceImages: ReferenceImage[] = [
    {
      buffer: sourceImage,
      mimeType: 'image/png',
      label: 'SOURCE IMAGE — current rendering with footwear in wrong position relative to the pant hem.',
    },
    {
      buffer: shoeBuffer,
      mimeType: shoeMime,
      label: 'FOOTWEAR REFERENCE — exact appearance of the footwear (style, color, material).',
    },
  ];

  const prompt = buildShoeEditPrompt(shoesDescription, shotType);
  const aspectRatio = ASPECT_RATIOS[shotType] || '3:4';

  console.log(`[ShoeEdit] ${shotType}: Calling Gemini (${shoesDescription.substring(0, 60)}..., aspect=${aspectRatio})`);

  // Same retry pattern as tee-edit — Gemini transients aren't unusual.
  const MAX_ATTEMPTS = 2;
  const RETRY_DELAY_MS = 3_000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await generateImage({
        prompt,
        referenceImages,
        aspectRatio,
        model: 'gemini-3-pro-image-preview',
        apiKey,
      });
      console.log(`[ShoeEdit] ${shotType}: Gemini edit complete on attempt ${attempt} (${result.imageData.length} bytes)`);
      return { imageData: result.imageData, mimeType: result.mimeType, edited: true };
    } catch (err) {
      lastErr = err;
      console.error(`[ShoeEdit] ${shotType}: Gemini edit attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  console.error(`[ShoeEdit] ${shotType}: All ${MAX_ATTEMPTS} attempts failed; returning tee-edited image unchanged.`);
  return {
    imageData: sourceImage,
    mimeType: 'image/png',
    edited: false,
    error: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}

/** Helper for callers to short-circuit before downloading the source image. */
export function needsShoeEdit(shotType: ShotType): boolean {
  return SHOE_EDIT_SHOTS.has(shotType);
}
