/**
 * Gemini-3-pro-image-preview pass-2 for top-focus M01/M02.
 *
 * Validated 2026-05-24 step 11/12 A/B: ~70% single-seed clean across 23 renders.
 * Failure modes are framing-only (head crop, occasional unbutton) — no twins,
 * no pants drift, no front-feature leak, no color drift.
 *
 * Input:  pass-1 Seedream buffer (full-body with correct pants + sports bra)
 * Output: Gemini-painted buffer (sports bra replaced with the wardrobe top,
 *         untucked, hem over waistband)
 *
 * Pass-1 buffer is passed as a Buffer directly (Gemini takes buffers via the
 * Vertex API — no GCS upload step needed).
 *
 * Replaces the previous Seedream pass-2 + applyTeeEdit path which produced
 * 0/16 deliverable outputs in earlier A/B (step 7-10).
 */
import { generateImage, type ReferenceImage } from '@/lib/vertex';
import { getWardrobeItem } from '@/lib/firestore';
import { normalizeWardrobeItem } from '@/lib/wardrobe-compat';
import type { JobWardrobe } from '@/types';

export interface GeminiPaintTopParams {
  /** Pass-1 Seedream output (full-body, correct pants, sports bra still on torso). */
  pass1Buffer: Buffer;
  /** Job wardrobe — used to look up top item by `wardrobe.top.itemId`. */
  wardrobe: JobWardrobe;
  /** M01 (front view) or M02 (back view). */
  shotType: 'M01' | 'M02';
  /** Optional Gemini API key override. Falls back to env. */
  apiKey?: string;
}

export interface GeminiPaintTopResult {
  /** Final painted buffer if `edited` is true; original `pass1Buffer` if false. */
  imageData: Buffer;
  mimeType: string;
  /** True when the Gemini paint actually ran and produced new pixels. */
  edited: boolean;
  /** Set when `edited === false` AND the cause is an error (vs intentional skip). */
  error?: string;
}

/**
 * v4 prompt — validated step 11/12 (2026-05-24).
 *
 * Design notes (LEARNINGS #55, #56, #88, #97, #101 applied):
 *   - Lean structure (~130 words). No FRAMING block, no FORBIDDEN block.
 *   - Positive layer-order ("OUTER layer", "IN FRONT OF", "emerging below") —
 *     never "DO NOT tuck" (LEARNING #55 trap).
 *   - Per-ref scoping: IMAGE 2 = color/texture/material (view-agnostic flat);
 *     IMAGE 3 = silhouette + drape + view direction (LEARNING #56 / #101).
 *   - Pose preservation tied to IMAGE 1 anchor (single sentence).
 *   - Single-instance + view + framing in the final sentence (the same
 *     augmentation that took pass-1 step6 → step7 from 2/8 → 5/8 clean).
 */
function buildV4Prompt(topName: string, topDescription: string, view: 'front' | 'back'): string {
  const descSentence = topDescription?.trim() ? ` ${topDescription.trim()}` : '';
  return `Replace the black sports bra in IMAGE 1 with the top shown in IMAGE 2 and IMAGE 3.

The top is "${topName}".${descSentence}

Render the top as the OUTER layer at the torso, hanging from the shoulders at the natural length shown in IMAGE 3 (fit-model). The bottom hem of the top sits IN FRONT OF the pants waistband from IMAGE 1 — fabric visible as a layer covering the waistband, with the pants emerging cleanly below the hem.

Take color, fabric texture, stripes / pattern, finish, and material from IMAGE 2 (flat product photo). Take silhouette, drape, sleeve shape, hem position on the body, view direction, and how the garment falls on the body from IMAGE 3 (fit-model).

Preserve every other pixel of IMAGE 1 exactly, including the model's pose, stance, body angle, foot placement, and arm position.

The output is a single-instance render of one model — the same model shown in IMAGE 1, in ${view} view, full body head-to-toe, centered horizontally.`;
}

async function downloadToRef(url: string): Promise<ReferenceImage> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url.slice(-60)} → ${r.status}`);
  return {
    buffer: Buffer.from(await r.arrayBuffer()),
    mimeType: r.headers.get('content-type') || 'image/jpeg',
    label: '',
  };
}

/**
 * Ref structure (per step 12 spec, Bruno-approved):
 *   M01 (front, 6 refs):
 *     - IMAGE 1: pass-1 buffer (the canvas with correct pants + bra)
 *     - IMAGE 2: top fm.front (primary silhouette/view)
 *     - IMAGE 3: top fm.front45Left
 *     - IMAGE 4: top fm.front45Right
 *     - IMAGE 5: top flatFrontUrl (color/texture authority)
 *     - IMAGE 6: pass-1 buffer (silent anchor — anti-twin, mirrors step 8 M01 fix)
 *   M02 (back, 5 refs):
 *     - IMAGE 1: pass-1 buffer
 *     - IMAGE 2: top fm.back
 *     - IMAGE 3: top fm.back45Left
 *     - IMAGE 4: top fm.back45Right
 *     - IMAGE 5: pass-1 buffer (silent anchor)
 *     (No flat-back for current tops — flat-front excluded from M02 per
 *      LEARNING #88 to avoid front-feature leak onto back render.)
 *
 * Missing-ref fallbacks: 45-degree angles fall back to fm.front/back if
 * unavailable. fm.front/back is hard-required and will error if missing.
 */
async function buildGarmentRefs(topItem: Record<string, unknown>, isBack: boolean): Promise<ReferenceImage[]> {
  const normalized = normalizeWardrobeItem(topItem);
  if (!normalized) throw new Error('top item has no usable images');
  const fm = normalized.fitModels;

  let urls: string[];
  if (isBack) {
    if (!fm.back) throw new Error('top missing fitModels.back for M02');
    const back45L = fm.back45Left  || fm.back;
    const back45R = fm.back45Right || fm.back;
    urls = [fm.back, back45L, back45R];
  } else {
    if (!fm.front) throw new Error('top missing fitModels.front for M01');
    if (!normalized.flatFrontUrl) throw new Error('top missing flatFrontUrl for M01');
    const front45L = fm.front45Left  || fm.front;
    const front45R = fm.front45Right || fm.front;
    urls = [fm.front, front45L, front45R, normalized.flatFrontUrl];
  }

  return Promise.all(urls.map(downloadToRef));
}

export async function geminiPaintTop(params: GeminiPaintTopParams): Promise<GeminiPaintTopResult> {
  const { pass1Buffer, wardrobe, shotType, apiKey } = params;
  const isBack = shotType === 'M02';

  const topId = wardrobe.top?.itemId;
  if (!topId) {
    return { imageData: pass1Buffer, mimeType: 'image/png', edited: false, error: 'no top in wardrobe' };
  }

  let topItem: Record<string, unknown> | null;
  try {
    topItem = await getWardrobeItem(topId) as Record<string, unknown> | null;
  } catch (e) {
    return {
      imageData: pass1Buffer,
      mimeType: 'image/png',
      edited: false,
      error: `getWardrobeItem(${topId}) failed: ${(e as Error).message}`,
    };
  }
  if (!topItem) {
    return { imageData: pass1Buffer, mimeType: 'image/png', edited: false, error: `top item ${topId} not found` };
  }

  let garmentRefs: ReferenceImage[];
  try {
    garmentRefs = await buildGarmentRefs(topItem, isBack);
  } catch (e) {
    return {
      imageData: pass1Buffer,
      mimeType: 'image/png',
      edited: false,
      error: `ref construction: ${(e as Error).message}`,
    };
  }

  // Pass-1 buffer goes in IMAGE 1 slot AND IMAGE 6 (M01) / IMAGE 5 (M02) silent-anchor slot.
  const pass1Ref: ReferenceImage = { buffer: pass1Buffer, mimeType: 'image/png', label: '' };
  const refs: ReferenceImage[] = [pass1Ref, ...garmentRefs, pass1Ref];

  const topName = (topItem.name as string) || 'top';
  const topDescription = (topItem.topDescription as string) || (topItem.description as string) || '';
  const prompt = buildV4Prompt(topName, topDescription, isBack ? 'back' : 'front');

  console.log(
    `[geminiPaintTop] ${shotType} refs=${refs.length} topId=${topId.slice(0, 8)}… name="${topName.slice(0, 40)}"`,
  );

  try {
    const result = await generateImage({
      prompt,
      referenceImages: refs,
      aspectRatio: '1:1',
      imageSize: '4K',
      model: 'gemini-3-pro-image-preview',
      apiKey,
    });
    return { imageData: result.imageData, mimeType: result.mimeType, edited: true };
  } catch (e) {
    return {
      imageData: pass1Buffer,
      mimeType: 'image/png',
      edited: false,
      error: `gemini call failed: ${(e as Error).message}`,
    };
  }
}
