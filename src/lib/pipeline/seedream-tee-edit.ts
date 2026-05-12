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
import type { ShotType, JobWardrobe, FocusSlot } from '@/types';

export interface TeeEditParams {
  /** Seedream-generated image buffer (sports bra version) */
  sourceImage: Buffer;
  /** Job wardrobe config — used to look up top item */
  wardrobe: JobWardrobe;
  /** Shot type — determines front/back view for flat image selection */
  shotType: ShotType;
  /** Gemini API key override (optional, falls back to env) */
  apiKey?: string;
  /** Slot of the wardrobe item flagged isFocus. When 'top', tee-edit is
   *  skipped — the focus garment was painted directly by Seedream and
   *  re-tucking it would force the focus jacket into the jeans. */
  focusSlot?: FocusSlot;
}

export interface TeeEditResult {
  /** Edited image with real top painted in */
  imageData: Buffer;
  mimeType: string;
  /** Whether the edit was actually performed (false = no top in wardrobe, returned original) */
  edited: boolean;
  /** When edited=false because of a Gemini/network error (vs intentional skip), the error message */
  error?: string;
}

/** Shot types that should get tee-edit treatment.
 *
 * M01/M02 are crops of M03/M04 (which are already tee-edited) — re-running
 * tee-edit on them would double-paint the top. M03/M04/M06 are full Seedream
 * generations rendered with a sports bra; they need the real top painted in.
 *
 * M05 (Pocket Detail) was originally excluded under the assumption that its
 * back-pocket close-up crop wouldn't show the upper body. In practice the M05
 * Seedream output renders a noticeable portion of the lower back / waistline /
 * shoulders, and Seedream regenerates the upper body WITHOUT the tee even
 * when given the post-tee-edit M03/M04 anchors as references (Seedream weighs
 * fit-model photos more heavily than anchor photos for outfit info, and the
 * fit-model photos for tops are taken without the tee yet). Result:
 * topless-above-waist M05 outputs (Bruno 2026-05-07: JwkvmgkVxUIkHGATlsyG +
 * aMKyujUYcQILzPjlQ9Mv). Adding M05 to this set so tee-edit also runs on it.
 */
// 2026-05-11: removed M05. The rev 32 prompt + Track A cropped refs lets
// Seedream render the tee correctly natively (validated H6Is/F9). Tee-edit's
// re-render was reframing M05 to standard back view, defeating the tight
// low-angle crop. Bruno-approved: ship Seedream-only output for M05.
const TEE_EDIT_SHOTS: Set<ShotType> = new Set(['M03', 'M04', 'M06']);

/** Aspect ratios per shot type */
const ASPECT_RATIOS: Record<string, string> = {
  M01: '3:4',
  M02: '3:4',
  M03: '3:4',
  M04: '3:4',
  M06: '3:4',
};

/**
 * Check if a shot type needs tee-edit.
 * M05 (pocket close-up) does not — no top visible.
 *
 * Also skips tee-edit when the shot was generated with Seedream 5.0+ — that
 * model handles tucked-in tops natively without the body-seam artifact, so
 * the seedream-generate path passes the real Opus top description directly
 * (rather than the "simple black sports bra" placeholder used for 4.5).
 * Running tee-edit on a 5.0 shot would re-paint an already-correct top and
 * waste a Gemini call (~$0.04 + ~30s).
 *
 * Also skips tee-edit when the focus garment IS the top (focusSlot='top').
 * In that case the seedream-generate path passed the real Opus description
 * straight to Seedream so the focus jacket was painted directly. Running
 * tee-edit would either no-op (sports bra not present to replace) or
 * destructively repaint the focus top tucked into the jeans, contradicting
 * how a jacket is worn. Same skip path as 5.0 — different reason.
 */
export function needsTeeEdit(shotType: ShotType, seedreamModel?: string, focusSlot?: FocusSlot): boolean {
  if (!TEE_EDIT_SHOTS.has(shotType)) return false;
  if (seedreamModel && seedreamModel.startsWith('seedream-5-')) return false;
  if (focusSlot === 'top') return false;
  return true;
}

/**
 * Build the V2 "layered under waistband" edit prompt.
 * This prompt was validated across 20+ style variants.
 */
function buildEditPrompt(topDescription: string, shotType: ShotType): string {
  // M06 is the free-pose front shot (mostly front-facing archetypes per the
  // G-Star vault). Treat as 'front' view for tee-edit.
  const view = shotType === 'M01' || shotType === 'M03' || shotType === 'M06' ? 'front' : 'back';

  // M05 — STRICT FRAMING LOCK
  // The default tee-edit prompt below tells Gemini "the top covers the entire
  // torso from shoulders to below the waistband" — accurate for M03/M04
  // (full-body) but WRONG for M05 (tight low-angle close-up where only a
  // sliver of tee is visible above the waistband, no shoulders, no head).
  // Gemini sees "shoulders to waistband torso" + "back view" and re-renders
  // the entire image at standard back-view framing, destroying M05's
  // low-camera buttock-central composition.
  //
  // M05-specific prompt: tell Gemini explicitly this is a tight low-angle
  // close-up, only paint the bare-skin slice above the waistband, preserve
  // everything else byte-equivalent. Validated 2026-05-11 against the
  // H6Is/F9 fixture — preserves framing perfectly while painting the tee
  // slice cleanly tucked into the jeans waistband.
  if (shotType === 'M05') {
    return `This is a TIGHT M05 PRODUCT CLOSE-UP. The SOURCE IMAGE shows a low-angle close-up of a model's back-hip / buttock area, with the camera positioned BELOW the buttock looking UPWARD. The framing is intentionally tight — buttock dominates the central composition, top of frame shows a sliver of bare back/skin above the waistband, bottom of frame is mid-thigh.

═══ ABSOLUTELY CRITICAL: FRAMING LOCK ═══
DO NOT REFRAME. DO NOT ZOOM OUT. DO NOT change the camera angle. DO NOT render a standard back view. The output frame MUST be byte-equivalent to the source image's framing:
- Camera height: same (low, below buttock)
- Camera angle: same (tilted upward looking at buttock)
- Crop: same (waist-to-mid-thigh, buttock-central)
- Body pose: same (three-quarter rotation, right hip forward)
- Body orientation: same
- Background: same studio backdrop
- Model identity: same skin tone, same body shape, same proportions
- Jeans: same color, wash, fit, pocket geometry, hem position
- Everything below the waistband: BYTE-IDENTICAL to the source image

═══ THE ONLY CHANGE ═══
At the TOP of the frame (above the jeans waistband), there is currently a small slice of bare back skin visible. PAINT THAT BARE SKIN STRIP with the bottom edge of this top:

${topDescription}

The top is tucked into the jeans. Only the BOTTOM EDGE of the top is visible in this tight crop — the bottom hem of the tee disappears under the waistband. From the camera's view, we see the tee fabric going from the top edge of the frame down to where the jeans waistband begins. That's it. NO full tee visible. NO shoulders visible. NO arms visible. NO head visible. NO neckline visible.

The visible portion of the tee is roughly the top 15-25% of the frame, from the top edge down to the jeans waistband. Match the tee's color, fabric, and texture from the TOP REFERENCE image.

═══ WHAT NOT TO DO ═══
- DO NOT render a full back view of the model wearing the tee.
- DO NOT reframe to chest-height or eye-level camera.
- DO NOT make the model stand straight up.
- DO NOT change the buttock-central composition.
- DO NOT add shoulders, arms, head, or neck.
- DO NOT change the jeans or the buttock area.

ONLY the bare-skin slice at the TOP of the source image becomes a slice of tee fabric. Everything else is preserved byte-equivalent.`;
  }

  return `Edit this e-commerce studio photo. The model is currently wearing a simple black sports bra. Replace it with the top shown in the reference image.

TOP TO PAINT: ${topDescription}

CRITICAL LAYERING INSTRUCTION:
The top covers the entire torso from shoulders to below the waistband. The bottom of the top is hidden UNDER the jeans — the denim waistband sits ON TOP of the shirt fabric. The shirt is completely tucked in with no fabric hanging over or bunching above the waistband. The waistband line is clean and unbroken.

LENGTH OVERRIDE: Regardless of any "cropped", "short", "boxy", "hits at hip", or similar fit descriptor in the TOP TO PAINT text, render the top at full tucked length with the bottom disappearing under the denim waistband. Fit descriptors in that text describe the garment's off-body silhouette, not how it is worn on this model.

VIEW: This is a ${view} view. Paint the top as it would appear from the ${view}.

PRESERVE EVERYTHING ELSE EXACTLY:
- Same face — features, structure, expression. Do not alter the head in any way.
- Same hair — color, length, cut, parting, styling
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
  const { sourceImage, wardrobe, shotType, apiKey, focusSlot } = params;

  // Guard: shotType eligible, not Seedream 5.0+, focus is not the top.
  // (Caller already gated via needsTeeEdit at the call site, but the inline
  //  guard makes applyTeeEdit safe to call directly without duplicated logic.)
  if (!needsTeeEdit(shotType, undefined, focusSlot)) {
    console.log(`[TeeEdit] Skipping for ${shotType} (focus=${focusSlot || 'none'})`);
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
  // M06 is the free-pose front shot (mostly front-facing archetypes per the
  // G-Star vault). M05 is the back-pocket close-up (back view). Treat the rest
  // of the front/back assignments per the shot-type convention.
  const view = shotType === 'M01' || shotType === 'M03' || shotType === 'M06' ? 'front' : 'back';
  // Fall back order (Bruno 2026-05-07: jobs were skipping tee-edit when wardrobe
  // tops only had fit-model angles, no flats — QcR5jfsRfznRpagzz1LN).
  // Try flats first (cleanest for Gemini to read), then fit-model angles
  // (still show the garment, just on a body), then any other image.
  const flatUrl = view === 'front'
    ? (normalized?.flatFrontUrl || topItem.flatFrontUrl || topItem.flatImageUrl
        || normalized?.fitModels?.front || topItem.fitModels?.front
        || topItem.imageUrl || topItem.thumbnailUrl)
    : (normalized?.flatBackUrl || topItem.flatBackUrl
        || normalized?.fitModels?.back || topItem.fitModels?.back
        || normalized?.flatFrontUrl || topItem.flatFrontUrl
        || normalized?.fitModels?.front || topItem.fitModels?.front
        || topItem.imageUrl || topItem.thumbnailUrl);

  if (!flatUrl) {
    console.warn(`[TeeEdit] No reference image URL on top item (no flats, no fit-model angles); skipping edit`);
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

  // Two-attempt retry: silent Gemini failures (rate limit, transient error,
  // safety filter false-positive) were leaving shots without a tee — sports
  // bra remained visible. Retry once after a short delay before giving up.
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
      console.log(`[TeeEdit] ${shotType}: Gemini edit complete on attempt ${attempt} (${result.imageData.length} bytes)`);
      return { imageData: result.imageData, mimeType: result.mimeType, edited: true };
    } catch (err) {
      lastErr = err;
      console.error(`[TeeEdit] ${shotType}: Gemini edit attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  console.error(`[TeeEdit] ${shotType}: All ${MAX_ATTEMPTS} attempts failed, returning Seedream original (sports bra visible).`);
  return {
    imageData: sourceImage,
    mimeType: 'image/png',
    edited: false,
    error: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}
