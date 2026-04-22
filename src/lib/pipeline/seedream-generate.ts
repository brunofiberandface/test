/**
 * Seedream-backed shot generation — single-pass for all 5 shots.
 *
 * DESIGN NOTES
 * ------------
 * - Mirrors the reference-assembly logic of the legacy Gemini generateM* functions
 *   (src/lib/pipeline/generate.ts), but passes ref images as URLs instead of
 *   downloading them to Buffers. The GCS bucket has public read, so BytePlus can
 *   fetch them directly.
 * - Uses the SAME prompts as Gemini — no Seedream-specific overrides. Per Bruno:
 *   "start with the prompts as we have them now, this very small poc is not the
 *   base to change it all."
 * - No dressed base Phase 1 for M03/M04: the dressed-base pipeline is a
 *   Gemini-specific correction for foot proportion drift. Seedream is single-pass
 *   at every shot. If output quality regresses vs Gemini, we iterate.
 * - Image labels (which the Gemini pipeline interleaves as text between image
 *   payloads) are dropped — Seedream's API is prompt + image-URL array only.
 *   We log them for debugging.
 *
 * Shot ref assembly follows the LEGACY (pre-dressed-base) patterns:
 *   M03: model ref + flat front + 3 front angles + top front + shoes front   = 7
 *   M04: back ref (+ front ref) + flat back + 3 back angles + top back + shoes back = 8–9
 *   M01: model ref + M03 anchor + flat front + 3 front angles + top + shoes  = 8
 *   M02: back ref (+ front ref) + M04 anchor + flat back + 3 back angles + top + shoes = 9–10
 *   M05: (back ref|model ref) + M04 anchor + M03 anchor + flat back + 3 back angles = 7
 *
 * All within BytePlus's 10-ref limit.
 */
import { getWardrobeItem, getModel } from '@/lib/firestore';
import { injectSilhouette, injectStylingDescriptions, injectGender, injectGarmentType, type LoadedPrompt } from './prompt-loader';
import { APP_CONFIG } from '@/lib/config';
import type { ShotType, JobWardrobe, FitModelAngles } from '@/types';
import { normalizeWardrobeItem } from '@/lib/wardrobe-compat';
import { generateSeedreamImage, type SeedreamReferenceImage } from './seedream-client';
import { ensureSeedreamSafeUrl } from './seedream-image-safe';

export interface SeedreamGenerationContext {
  wardrobe: JobWardrobe;
  modelId: string;
  silhouette: { front: string; back: string };
  m03AnchorUrl?: string;
  m04AnchorUrl?: string;
  apiKey?: string; // BytePlus API key override; falls back to env
}

export interface SeedreamGenerationResult {
  imageData: Buffer;
  mimeType: string;
}

/** Strip query string (?v=..., signed URL params) so BytePlus fetches the raw object. */
function cleanUrl(url: string): string {
  return url.split('?')[0];
}

/**
 * Build a Seedream ref. Runs the URL through the 10 MiB guard — oversized GCS
 * objects get a cached `_seedream.jpg` sibling and we return that path instead.
 */
async function refFromUrl(url: string, label: string): Promise<SeedreamReferenceImage> {
  const safeUrl = await ensureSeedreamSafeUrl(cleanUrl(url));
  return { url: safeUrl, label };
}

/** Focus garment info + selected fit model angles + flat for the view. */
async function getFocusGarmentUrls(wardrobe: JobWardrobe, view: 'front' | 'back') {
  const focusSlot = Object.entries(wardrobe).find(([, v]) => v.isFocus);
  if (!focusSlot) throw new Error('No focus garment marked in wardrobe');

  const item = await getWardrobeItem(focusSlot[1].itemId) as any;
  if (!item) throw new Error(`Focus garment not found: ${focusSlot[1].itemId}`);

  const normalized = normalizeWardrobeItem(item);
  if (!normalized) throw new Error(`Focus garment has no fit model images: ${focusSlot[1].itemId}`);
  if (!normalized.fitModels?.front) throw new Error(`fitModels.front missing for ${focusSlot[1].itemId}`);

  const fitModels: FitModelAngles = normalized.fitModels;

  const angles = view === 'front'
    ? [fitModels.front, fitModels.front45Left, fitModels.front45Right]
    : [fitModels.back, fitModels.back45Left, fitModels.back45Right];

  // Always use flat front — flat back retired. For back shots, the prompt
  // tells Seedream to use flat front only for garment length/silhouette
  // proportions, not for copying front details onto the back.
  const flat = normalized.flatFrontUrl;

  return { angles, flat, item };
}

/** Top + shoes descriptions (for prompt injection).
 * Top: uses Opus-cached `topDescription` field (rich visual description) if available,
 * otherwise lazy-computes it via Claude Opus. Falls back to item name if all else fails.
 * This text replaces the top reference IMAGE for Seedream — prevents crop-top copying. */
async function getStylingDescriptions(wardrobe: JobWardrobe): Promise<{ topDescription: string; shoesDescription: string }> {
  let topDescription = '';
  let shoesDescription = '';

  for (const [slot, config] of Object.entries(wardrobe)) {
    if (!config?.itemId) continue;
    const item = await getWardrobeItem(config.itemId) as any;
    if (!item) continue;
    if (slot === 'top') {
      // Prefer Opus-cached description (rich visual detail)
      if (item.topDescription) {
        topDescription = item.topDescription;
      } else {
        // Lazy-compute: run Opus analysis now, cache for next time
        try {
          const { runTopDescriptionForWardrobe } = await import('@/lib/pipeline/top-description');
          topDescription = await runTopDescriptionForWardrobe(config.itemId);
        } catch (err) {
          console.warn(`[Seedream] Top description analysis failed, falling back to name:`, err);
          topDescription = item.description || item.name || '';
        }
      }
    } else if (slot === 'shoe') {
      shoesDescription = item.description || item.name || '';
    }
  }
  return { topDescription, shoesDescription };
}

/** Styling item reference images — shoes only for Seedream.
 * Top reference image is INTENTIONALLY excluded — Seedream copies crop-top styling
 * from the reference image, overriding tuck instructions. The top is described via
 * text only (Opus-generated {top_description}) in the prompt. */
async function getStylingRefs(wardrobe: JobWardrobe, view: 'front' | 'back'): Promise<SeedreamReferenceImage[]> {
  const refs: SeedreamReferenceImage[] = [];

  // Only shoes — top is text-only for Seedream
  const shoeConfig = wardrobe['shoe' as keyof JobWardrobe];
  if (shoeConfig?.itemId && !shoeConfig.isFocus) {
    const item = await getWardrobeItem(shoeConfig.itemId) as any;
    if (item) {
      const norm = normalizeWardrobeItem(item);
      const flatUrl = view === 'front'
        ? (norm?.flatFrontUrl || item.flatFrontUrl || norm?.fitModels?.front)
        : (norm?.flatBackUrl || item.flatBackUrl || norm?.flatFrontUrl || item.flatFrontUrl || norm?.fitModels?.back);

      if (flatUrl) {
        refs.push(await refFromUrl(flatUrl, `Shoes Reference (${item.name})`));
      }
    }
  }
  return refs;
}

// ── Seedream prompt builder ──────────────────────────────────────────
// All styling rules, pose, tuck, and framing instructions now live in the
// vault prompts (pipeline: 'seedream'). No code-side prepend/append.
/** Force sports bra for Seedream — the real top is painted on afterward by Gemini
 * tee-edit (seedream-tee-edit.ts). This avoids the body seam artifact that Seedream
 * produces when rendering full tops directly. */
function rewriteTopForSeedream(_opusDescription: string): string {
  return 'simple black sports bra';
}

async function buildPrompt(prompt: LoadedPrompt, wardrobe: JobWardrobe, modelId: string, focusItem: any, view: 'front' | 'back', silhouette: { front: string; back: string }, skipSilhouette = false): Promise<string> {
  const model = await getModel(modelId) as any;
  const { topDescription, shoesDescription } = await getStylingDescriptions(wardrobe);

  // Rewrite top description for Seedream — make it a "cropped top ending at waistband"
  // instead of a full tee, so Seedream renders it short rather than hanging loose.
  const seedreamTopDescription = rewriteTopForSeedream(topDescription);
  console.log(`[Seedream] Top description rewrite: "${topDescription}" → "${seedreamTopDescription}"`);

  let finalPrompt = prompt.generationPrompt;
  if (!skipSilhouette) {
    finalPrompt = injectSilhouette(finalPrompt, (view === 'front' ? silhouette?.front : silhouette?.back) || '');
  }
  finalPrompt = injectStylingDescriptions(finalPrompt, seedreamTopDescription, shoesDescription);
  finalPrompt = injectGender(finalPrompt, model?.gender || 'female');
  finalPrompt = injectGarmentType(finalPrompt, focusItem?.category || 'Pants');

  return finalPrompt;
}

// ── M03 — Full body front ──────────────────────────────────────────────
async function seedreamM03(ctx: SeedreamGenerationContext, prompt: LoadedPrompt): Promise<SeedreamGenerationResult> {
  const { angles, flat, item: focusItem } = await getFocusGarmentUrls(ctx.wardrobe, 'front');
  const model = await getModel(ctx.modelId) as any;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;
  if (!modelRefUrl) throw new Error(`Model reference image not found for ${ctx.modelId}`);

  const refs: SeedreamReferenceImage[] = [];
  refs.push(await refFromUrl(modelRefUrl, 'MODEL IDENTITY REFERENCE'));
  refs.push(await refFromUrl(flat, 'Garment Flat Front'));
  for (let i = 0; i < angles.length; i++) {
    refs.push(await refFromUrl(angles[i], `Fit Model Front Angle ${i + 1}`));
  }
  refs.push(...(await getStylingRefs(ctx.wardrobe, 'front')));

  const finalPrompt = await buildPrompt(prompt, ctx.wardrobe, ctx.modelId, focusItem, 'front', ctx.silhouette);
  console.log(`[Seedream] M03: ${refs.length} refs`);

  return generateSeedreamImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: (prompt.aspectOverride || APP_CONFIG.shots.M03.aspect) as '9:16' | '3:4',
    apiKey: ctx.apiKey,
  });
}

// ── M04 — Full body back ───────────────────────────────────────────────
async function seedreamM04(ctx: SeedreamGenerationContext, prompt: LoadedPrompt): Promise<SeedreamGenerationResult> {
  const { angles, flat, item: focusItem } = await getFocusGarmentUrls(ctx.wardrobe, 'back');
  const model = await getModel(ctx.modelId) as any;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;
  if (!modelRefUrl) throw new Error(`Model reference image not found for ${ctx.modelId}`);
  const backRefUrl = model?.backReferenceImageUrl;

  const refs: SeedreamReferenceImage[] = [];
  if (backRefUrl) {
    refs.push(await refFromUrl(backRefUrl, 'MODEL BACK REFERENCE'));
    refs.push(await refFromUrl(modelRefUrl, 'MODEL FRONT REFERENCE'));
  } else {
    refs.push(await refFromUrl(modelRefUrl, 'MODEL IDENTITY REFERENCE'));
  }
  refs.push(await refFromUrl(flat, 'Garment Flat Back'));
  for (let i = 0; i < angles.length; i++) {
    refs.push(await refFromUrl(angles[i], `Fit Model Back Angle ${i + 1}`));
  }
  refs.push(...(await getStylingRefs(ctx.wardrobe, 'back')));

  const finalPrompt = await buildPrompt(prompt, ctx.wardrobe, ctx.modelId, focusItem, 'back', ctx.silhouette);
  console.log(`[Seedream] M04: ${refs.length} refs`);

  return generateSeedreamImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: (prompt.aspectOverride || APP_CONFIG.shots.M04.aspect) as '9:16' | '3:4',
    apiKey: ctx.apiKey,
  });
}

// ── M01 — Chest-up front (Seedream) ────────────────────────────────────
async function seedreamM01(ctx: SeedreamGenerationContext, prompt: LoadedPrompt): Promise<SeedreamGenerationResult> {
  if (!ctx.m03AnchorUrl) throw new Error('M01 requires M03 anchor — run M03 first');
  const { angles, flat, item: focusItem } = await getFocusGarmentUrls(ctx.wardrobe, 'front');
  const model = await getModel(ctx.modelId) as any;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;
  if (!modelRefUrl) throw new Error(`Model reference image not found for ${ctx.modelId}`);

  const refs: SeedreamReferenceImage[] = [];
  refs.push(await refFromUrl(modelRefUrl, 'MODEL IDENTITY REFERENCE'));
  refs.push(await refFromUrl(ctx.m03AnchorUrl, 'M03 ANCHOR — full body front'));
  refs.push(await refFromUrl(flat, 'Garment Flat Front'));
  for (let i = 0; i < angles.length; i++) {
    refs.push(await refFromUrl(angles[i], `Fit Model Front Angle ${i + 1}`));
  }
  refs.push(...(await getStylingRefs(ctx.wardrobe, 'front')));

  const finalPrompt = await buildPrompt(prompt, ctx.wardrobe, ctx.modelId, focusItem, 'front', ctx.silhouette);
  console.log(`[Seedream] M01: ${refs.length} refs`);

  return generateSeedreamImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: (prompt.aspectOverride || APP_CONFIG.shots.M01.aspect) as '9:16' | '3:4',
    apiKey: ctx.apiKey,
  });
}

// ── M02 — Chest-up back (Seedream) ─────────────────────────────────────
async function seedreamM02(ctx: SeedreamGenerationContext, prompt: LoadedPrompt): Promise<SeedreamGenerationResult> {
  if (!ctx.m04AnchorUrl) throw new Error('M02 requires M04 anchor — run M04 first');
  const { angles, flat, item: focusItem } = await getFocusGarmentUrls(ctx.wardrobe, 'back');
  const model = await getModel(ctx.modelId) as any;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;
  if (!modelRefUrl) throw new Error(`Model reference image not found for ${ctx.modelId}`);
  const backRefUrl = model?.backReferenceImageUrl;

  const refs: SeedreamReferenceImage[] = [];
  if (backRefUrl) {
    refs.push(await refFromUrl(backRefUrl, 'MODEL BACK REFERENCE'));
    refs.push(await refFromUrl(modelRefUrl, 'MODEL FRONT REFERENCE'));
  } else {
    refs.push(await refFromUrl(modelRefUrl, 'MODEL IDENTITY REFERENCE'));
  }
  refs.push(await refFromUrl(ctx.m04AnchorUrl, 'M04 ANCHOR — full body back'));
  refs.push(await refFromUrl(flat, 'Garment Flat Back'));
  for (let i = 0; i < angles.length; i++) {
    refs.push(await refFromUrl(angles[i], `Fit Model Back Angle ${i + 1}`));
  }
  refs.push(...(await getStylingRefs(ctx.wardrobe, 'back')));

  const finalPrompt = await buildPrompt(prompt, ctx.wardrobe, ctx.modelId, focusItem, 'back', ctx.silhouette);
  console.log(`[Seedream] M02: ${refs.length} refs`);

  return generateSeedreamImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: (prompt.aspectOverride || APP_CONFIG.shots.M02.aspect) as '9:16' | '3:4',
    apiKey: ctx.apiKey,
  });
}

// ── M05 — Back pocket detail ───────────────────────────────────────────
// Per Bruno: the fit model's left hip/pocket is the best reference for the
// pocket close-up — AI anchors add noise. Strip to 2 refs: back + back45Right.
async function seedreamM05(ctx: SeedreamGenerationContext, prompt: LoadedPrompt): Promise<SeedreamGenerationResult> {
  const focusSlot = Object.entries(ctx.wardrobe).find(([, v]) => v.isFocus);
  if (!focusSlot) throw new Error('M05: no focus garment in wardrobe');
  const item = await getWardrobeItem(focusSlot[1].itemId) as any;
  if (!item) throw new Error(`M05: focus garment not found: ${focusSlot[1].itemId}`);
  const normalized = normalizeWardrobeItem(item);
  const fitModels = normalized?.fitModels;
  if (!fitModels?.back || !fitModels?.back45Right) {
    throw new Error('M05 Seedream requires fitModels.back + fitModels.back45Right');
  }

  const refs: SeedreamReferenceImage[] = [
    await refFromUrl(fitModels.back,        'PRIMARY — fit model back (left hip/pocket visible)'),
    await refFromUrl(fitModels.back45Right, 'Fit model back 45° right — left hip closer to camera'),
  ];

  // M05 has no {silhouette} placeholder — skip silhouette injection
  const finalPrompt = await buildPrompt(prompt, ctx.wardrobe, ctx.modelId, item, 'back', ctx.silhouette, true);
  console.log(`[Seedream] M05: ${refs.length} refs (fit model back + back45right only)`);

  return generateSeedreamImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: (prompt.aspectOverride || APP_CONFIG.shots.M05.aspect) as '9:16' | '3:4',
    apiKey: ctx.apiKey,
  });
}

export async function generateSeedreamShot(
  shotType: ShotType,
  ctx: SeedreamGenerationContext,
  prompt: LoadedPrompt,
): Promise<SeedreamGenerationResult> {
  switch (shotType) {
    case 'M03': return seedreamM03(ctx, prompt);
    case 'M04': return seedreamM04(ctx, prompt);
    case 'M01': return seedreamM01(ctx, prompt);
    case 'M02': return seedreamM02(ctx, prompt);
    case 'M05': return seedreamM05(ctx, prompt);
    default: throw new Error(`Unknown shot type for Seedream: ${shotType}`);
  }
}
