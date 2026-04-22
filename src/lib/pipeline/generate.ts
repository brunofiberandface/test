/**
 * Pro pipeline — single-pass image generation.
 *
 * Each shot type has a specific image layout (which references go in, in what order).
 * The prompt comes from the golden vault .md files.
 * Silhouette analysis text is injected via {silhouette} placeholder.
 */
import { generateImage, type ReferenceImage } from '@/lib/vertex';
import { downloadGarmentImage } from '@/lib/gcs';
import { getWardrobeItem, getModel } from '@/lib/firestore';
import { prepareForGeneration } from './image-prep';
import { injectSilhouette, injectStylingDescriptions, injectGender, injectGarmentType, type LoadedPrompt } from './prompt-loader';
import { APP_CONFIG } from '@/lib/config';
import type { ShotType, JobWardrobe, FitModelAngles } from '@/types';
import { normalizeWardrobeItem } from '@/lib/wardrobe-compat';

export interface GenerationContext {
  wardrobe: JobWardrobe;
  modelId: string;
  silhouette: { front: string; back: string };
  // Anchor URLs from previous shots in the dependency chain
  m03AnchorUrl?: string;
  m04AnchorUrl?: string;
  // API key for Generative Language API (enables parallel generation)
  apiKey?: string;
}

export interface GenerationResult {
  imageData: Buffer;
  mimeType: string;
}

/**
 * Download and prepare an image from a URL.
 */
async function loadRef(url: string, label: string): Promise<ReferenceImage> {
  const cleanUrl = url.split('?')[0];
  const raw = await downloadGarmentImage(cleanUrl);
  const prepared = await prepareForGeneration(raw);
  return { buffer: prepared, mimeType: 'image/jpeg', label };
}

/**
 * Get the focus garment's wardrobe item and its fit model angles + flats.
 */
async function getFocusGarmentImages(wardrobe: JobWardrobe, view: 'front' | 'back') {
  // Find which slot is focus
  const focusSlot = Object.entries(wardrobe).find(([, v]) => v.isFocus);
  if (!focusSlot) throw new Error('No focus garment marked in wardrobe');

  const item = await getWardrobeItem(focusSlot[1].itemId) as any;
  if (!item) throw new Error(`Focus garment not found: ${focusSlot[1].itemId}`);

  console.log(`[Generate] Focus item ${focusSlot[1].itemId}: fitModels=${!!item.fitModels}, fitModelUrls=${item.fitModelUrls?.length || 0}`);
  const normalized = normalizeWardrobeItem(item);
  if (!normalized) throw new Error(`Focus garment has no fit model images: ${focusSlot[1].itemId}`);
  if (!normalized.fitModels?.front) throw new Error(`Normalize returned but fitModels.front missing for ${focusSlot[1].itemId}`);
  const fitModels: FitModelAngles = normalized.fitModels;

  // Select 3 angles based on view direction
  const angles = view === 'front'
    ? [fitModels.front, fitModels.front45Left, fitModels.front45Right]
    : [fitModels.back, fitModels.back45Left, fitModels.back45Right];

  // Always use flat front — flat back retired. For back shots, the prompt
  // tells the model to use flat front only for garment length/silhouette
  // proportions, not for copying front details onto the back.
  const flat = normalized.flatFrontUrl;

  return { angles, flat, item };
}

/**
 * Get top and shoes descriptions from wardrobe items for prompt injection.
 */
async function getStylingDescriptions(wardrobe: JobWardrobe): Promise<{ topDescription: string; shoesDescription: string }> {
  let topDescription = '';
  let shoesDescription = '';

  for (const [slot, config] of Object.entries(wardrobe)) {
    if (!config?.itemId) continue;
    const item = await getWardrobeItem(config.itemId) as any;
    if (!item) continue;

    if (slot === 'top') {
      topDescription = item.description || item.name || '';
    } else if (slot === 'shoe') {
      shoesDescription = item.description || item.name || '';
    }
  }

  return { topDescription, shoesDescription };
}

/**
 * Get styling items (non-focus) — returns 1 reference image per item, matching the view direction.
 * Front views get flat front, back views get flat back. This keeps the image count predictable
 * and avoids confusing Gemini with the wrong side of a styling garment.
 * Order: top first, then shoes — matching the prompt image numbering.
 */
async function getStylingImages(wardrobe: JobWardrobe, view: 'front' | 'back'): Promise<ReferenceImage[]> {
  const refs: ReferenceImage[] = [];

  // Process in fixed order: top first, then shoe — matches prompt image numbering
  const orderedSlots = ['top', 'shoe'];

  for (const slot of orderedSlots) {
    const config = wardrobe[slot as keyof JobWardrobe];
    if (!config?.itemId || config.isFocus) continue;

    const item = await getWardrobeItem(config.itemId) as any;
    if (!item) continue;

    const label = slot === 'shoe' ? 'Shoes Reference' :
                  slot === 'top' ? 'Top Reference' :
                  `${slot} Reference`;

    const norm = normalizeWardrobeItem(item);

    // Pick the image matching the view direction
    const flatUrl = view === 'front'
      ? (norm?.flatFrontUrl || item.flatFrontUrl || norm?.fitModels?.front)
      : (norm?.flatBackUrl || item.flatBackUrl || norm?.flatFrontUrl || item.flatFrontUrl || norm?.fitModels?.back);

    if (flatUrl) {
      refs.push(await loadRef(flatUrl, `${label} (${item.name})`));
    }

    console.log(`[Generate] Styling slot "${slot}" (${item.name}): view=${view}, flatUrl=${!!flatUrl}, refsAdded=${refs.length}`);
  }

  return refs;
}

/**
 * Generate M03 with dressed base anchor — full body front view.
 * Uses a pre-corrected dressed base (model in t-shirt + shorts + shoes with correct
 * foot proportions) as the primary anchor. The dressed base locks identity, pose,
 * and proportions; this call replaces the outfit with the target garments.
 *
 * Images: dressed base + flat front + 3 front fit models + top ref + shoes ref
 */
export async function generateM03WithDressedBase(
  ctx: GenerationContext,
  prompt: LoadedPrompt,
  dressedBase: Buffer,
): Promise<GenerationResult> {
  const { angles, flat, item: focusItem } = await getFocusGarmentImages(ctx.wardrobe, 'front');
  const model = await getModel(ctx.modelId) as any;

  const refs: ReferenceImage[] = [];

  // Image 1: Dressed base — primary anchor (identity + pose + foot position LOCKED; garment silhouette comes from {silhouette} + fit model images)
  refs.push({
    buffer: await prepareForGeneration(dressedBase),
    mimeType: 'image/jpeg',
    label: 'DRESSED BASE — anchor for face identity, hair, skin tone, pose/stance, and foot position. KEEP those PIXEL-IDENTICAL. The garment silhouette (width, drape, volume) is NOT defined by this image — the dressed base shows compression shorts so body proportions are visible. The actual garment may be WIDER, LOOSER, or BAGGIER than the bare legs shown. Follow the SILHOUETTE & WIDTH section of the prompt and the fit model reference images for the correct garment width and drape.',
  });

  // Image 2: Flat front
  refs.push(await loadRef(flat, 'JEANS FLAT FRONT — Primary ground truth for garment proportions, color, wash, details.'));

  // Images 3-5: Front fit model angles
  for (let i = 0; i < angles.length; i++) {
    refs.push(await loadRef(angles[i], `Fit Model Front Angle ${i + 1} — real jeans on a body for fit, drape, silhouette.`));
  }

  // Images 6-7: Styling items — top front, shoes front
  const styling = await getStylingImages(ctx.wardrobe, 'front');
  refs.push(...styling);

  // Inject silhouette + styling descriptions
  const { topDescription, shoesDescription } = await getStylingDescriptions(ctx.wardrobe);
  let finalPrompt = injectSilhouette(prompt.generationPrompt, ctx.silhouette?.front || '');
  finalPrompt = injectStylingDescriptions(finalPrompt, topDescription, shoesDescription);
  finalPrompt = injectGender(finalPrompt, model?.gender || 'female');
  finalPrompt = injectGarmentType(finalPrompt, focusItem?.category || 'Pants');

  console.log(`[Generate] M03 (dressed base): ${refs.length} reference images, top="${topDescription}", shoes="${shoesDescription}"`);

  return generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: prompt.aspectOverride || APP_CONFIG.shots.M03.aspect,
    imageSize: APP_CONFIG.imageSize,
    model: prompt.modelOverride || APP_CONFIG.generationModel,
    apiKey: ctx.apiKey,
  });
}

/**
 * Generate M04 with dressed base anchor — full body back view.
 */
export async function generateM04WithDressedBase(
  ctx: GenerationContext,
  prompt: LoadedPrompt,
  dressedBase: Buffer,
): Promise<GenerationResult> {
  const { angles, flat, item: focusItem } = await getFocusGarmentImages(ctx.wardrobe, 'back');
  const model = await getModel(ctx.modelId) as any;
  const backRefUrl = model?.backReferenceImageUrl;

  const refs: ReferenceImage[] = [];

  // Image 1: Dressed base — primary anchor
  refs.push({
    buffer: await prepareForGeneration(dressedBase),
    mimeType: 'image/jpeg',
    label: 'DRESSED BASE — anchor for face identity, hair, skin tone, pose/stance, and foot position. KEEP those PIXEL-IDENTICAL. The garment silhouette (width, drape, volume) is NOT defined by this image — the dressed base shows compression shorts so body proportions are visible. The actual garment may be WIDER, LOOSER, or BAGGIER than the bare legs shown. Follow the SILHOUETTE & WIDTH section of the prompt and the fit model reference images for the correct garment width and drape.',
  });

  // Image 1b: Back reference for hair/build consistency from behind
  if (backRefUrl) {
    refs.push(await loadRef(backRefUrl, 'MODEL BACK REFERENCE — match hair from behind, skin tone, build PRECISELY.'));
  }

  // Image 2: Flat back
  refs.push(await loadRef(flat, 'JEANS FLAT BACK — Primary ground truth for garment proportions, color, wash, details.'));

  // Images 3-5: Back fit model angles
  for (let i = 0; i < angles.length; i++) {
    refs.push(await loadRef(angles[i], `Fit Model Back Angle ${i + 1}`));
  }

  // Images 6-7: Styling items — top back, shoes back
  const styling = await getStylingImages(ctx.wardrobe, 'back');
  refs.push(...styling);

  // Inject silhouette + styling descriptions
  const { topDescription, shoesDescription } = await getStylingDescriptions(ctx.wardrobe);
  let finalPrompt = injectSilhouette(prompt.generationPrompt, ctx.silhouette?.back || '');
  finalPrompt = injectStylingDescriptions(finalPrompt, topDescription, shoesDescription);
  finalPrompt = injectGender(finalPrompt, model?.gender || 'female');
  finalPrompt = injectGarmentType(finalPrompt, focusItem?.category || 'Pants');
  console.log(`[Generate] M04 (dressed base): ${refs.length} reference images, top="${topDescription}", shoes="${shoesDescription}"`);

  return generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: prompt.aspectOverride || APP_CONFIG.shots.M04.aspect,
    imageSize: APP_CONFIG.imageSize,
    model: prompt.modelOverride || APP_CONFIG.generationModel,
    apiKey: ctx.apiKey,
  });
}

/**
 * Generate M03 — Full body front view (legacy single-pass).
 * Images: model ref + flat front + 3 front fit models + top ref + shoes ref
 */
export async function generateM03(
  ctx: GenerationContext,
  prompt: LoadedPrompt,
): Promise<GenerationResult> {
  const { angles, flat, item: focusItem } = await getFocusGarmentImages(ctx.wardrobe, 'front');
  const model = await getModel(ctx.modelId) as any;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;
  if (!modelRefUrl) throw new Error(`Model reference image not found for ${ctx.modelId} (keys: ${Object.keys(model || {}).join(',')})`);

  const refs: ReferenceImage[] = [];

  // Image 1: Model reference
  refs.push(await loadRef(modelRefUrl, 'MODEL IDENTITY REFERENCE — match this face and hair EXACTLY'));

  // Image 2: Flat front
  refs.push(await loadRef(flat, 'Garment Flat Front Image (Ground truth for proportions)'));

  // Images 3-5: Front fit model angles
  for (let i = 0; i < angles.length; i++) {
    refs.push(await loadRef(angles[i], `Fit Model Front Angle ${i + 1}`));
  }

  // Images 6-7: Styling items — top front, shoes front (1 image each, front view only)
  const styling = await getStylingImages(ctx.wardrobe, 'front');
  refs.push(...styling);

  // Inject silhouette + styling descriptions
  const { topDescription, shoesDescription } = await getStylingDescriptions(ctx.wardrobe);
  let finalPrompt = injectSilhouette(prompt.generationPrompt, ctx.silhouette?.front || '');
  finalPrompt = injectStylingDescriptions(finalPrompt, topDescription, shoesDescription);
  finalPrompt = injectGender(finalPrompt, model?.gender || 'female');
  finalPrompt = injectGarmentType(finalPrompt, focusItem?.category || 'Pants');

  console.log(`[Generate] M03: ${refs.length} reference images, top="${topDescription}", shoes="${shoesDescription}", gender=${model?.gender}, garment=${focusItem?.category}`);

  return generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: prompt.aspectOverride || APP_CONFIG.shots.M03.aspect,
    imageSize: APP_CONFIG.imageSize,
    model: prompt.modelOverride || APP_CONFIG.generationModel,
    apiKey: ctx.apiKey,
  });
}

/**
 * Generate M04 — Full body back view.
 * Images: model ref + flat back + 3 back fit models + top back ref + shoes back ref
 */
export async function generateM04(
  ctx: GenerationContext,
  prompt: LoadedPrompt,
): Promise<GenerationResult> {
  const { angles, flat, item: focusItem } = await getFocusGarmentImages(ctx.wardrobe, 'back');
  const model = await getModel(ctx.modelId) as any;
  const modelRefUrl2 = model?.referenceImageUrl || model?.cardImageUrl;
  if (!modelRefUrl2) throw new Error(`Model reference image not found for ${ctx.modelId}`);

  // Use back reference if available for back view shots
  const backRefUrl = model?.backReferenceImageUrl;

  const refs: ReferenceImage[] = [];

  // Image 1: Back reference (preferred) or front reference
  if (backRefUrl) {
    refs.push(await loadRef(backRefUrl, 'MODEL BACK REFERENCE — this is the EXACT back view. Match hair, skin, build, proportions PRECISELY.'));
    // Also include front ref for identity consistency
    refs.push(await loadRef(modelRefUrl2, 'MODEL FRONT REFERENCE — match face identity, skin tone, hair color'));
  } else {
    refs.push(await loadRef(modelRefUrl2, 'MODEL IDENTITY REFERENCE — match this person\'s hair, skin, build'));
  }

  // Image 2: Flat back
  refs.push(await loadRef(flat, 'Garment Flat Back Image (Ground truth for proportions)'));

  // Images 3-5: Back fit model angles
  for (let i = 0; i < angles.length; i++) {
    refs.push(await loadRef(angles[i], `Fit Model Back Angle ${i + 1}`));
  }

  // Images 6-7: Styling items — top back, shoes back (1 image each, back view only)
  const styling = await getStylingImages(ctx.wardrobe, 'back');
  refs.push(...styling);

  // Inject silhouette + styling descriptions
  const { topDescription, shoesDescription } = await getStylingDescriptions(ctx.wardrobe);
  let finalPrompt = injectSilhouette(prompt.generationPrompt, ctx.silhouette?.back || '');
  finalPrompt = injectStylingDescriptions(finalPrompt, topDescription, shoesDescription);
  finalPrompt = injectGender(finalPrompt, model?.gender || 'female');
  finalPrompt = injectGarmentType(finalPrompt, focusItem?.category || 'Pants');
  console.log(`[Generate] M04: ${refs.length} reference images, backRef=${!!backRefUrl}, top="${topDescription}", shoes="${shoesDescription}", gender=${model?.gender}, garment=${focusItem?.category}`);

  return generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: prompt.aspectOverride || APP_CONFIG.shots.M04.aspect,
    imageSize: APP_CONFIG.imageSize,
    model: prompt.modelOverride || APP_CONFIG.generationModel,
    apiKey: ctx.apiKey,
  });
}

/**
 * Generate M01 — Cropped front view (navel to feet).
 * Images: M03 anchor + flat front + 3 front fit models + shoes ref
 */
export async function generateM01(
  ctx: GenerationContext,
  prompt: LoadedPrompt,
): Promise<GenerationResult> {
  if (!ctx.m03AnchorUrl) throw new Error('M01 requires M03 anchor');

  const { angles, flat, item: focusItem } = await getFocusGarmentImages(ctx.wardrobe, 'front');
  const model = await getModel(ctx.modelId) as any;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;

  const refs: ReferenceImage[] = [];

  // Image 1: Model identity reference — ensures consistent skin, hair, build
  if (modelRefUrl) {
    refs.push(await loadRef(modelRefUrl, 'MODEL IDENTITY REFERENCE — match this person\'s face, skin tone, hair, and build EXACTLY'));
  }

  // Image 2: M03 full-body (anchor)
  refs.push(await loadRef(ctx.m03AnchorUrl, 'FULL-BODY FRONT SHOT — the SAME pants, model, and session. Match this garment EXACTLY.'));

  // Image 3: Flat front
  refs.push(await loadRef(flat, 'Garment Flat Front Image'));

  // Images 3-5: Front fit model angles
  for (let i = 0; i < angles.length; i++) {
    refs.push(await loadRef(angles[i], `Fit Model Front Angle ${i + 1}`));
  }

  // Images 7-8: Styling items — top front, shoes front (1 image each, front view only)
  const styling = await getStylingImages(ctx.wardrobe, 'front');
  refs.push(...styling);

  // Inject silhouette + styling descriptions
  const { topDescription, shoesDescription } = await getStylingDescriptions(ctx.wardrobe);
  let finalPrompt = injectSilhouette(prompt.generationPrompt, ctx.silhouette?.front || '');
  finalPrompt = injectStylingDescriptions(finalPrompt, topDescription, shoesDescription);
  finalPrompt = injectGender(finalPrompt, model?.gender || 'female');
  finalPrompt = injectGarmentType(finalPrompt, focusItem?.category || 'Pants');

  console.log(`[Generate] M01: ${refs.length} reference images, top="${topDescription}", shoes="${shoesDescription}", gender=${model?.gender}, garment=${focusItem?.category}`);

  return generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: prompt.aspectOverride || APP_CONFIG.shots.M01.aspect,
    imageSize: APP_CONFIG.imageSize,
    model: prompt.modelOverride || APP_CONFIG.generationModel,
    apiKey: ctx.apiKey,
  });
}

/**
 * Generate M02 — Cropped back view (navel to feet).
 * Images: M04 anchor + flat back + 3 back fit models + top ref + shoes ref
 */
export async function generateM02(
  ctx: GenerationContext,
  prompt: LoadedPrompt,
): Promise<GenerationResult> {
  if (!ctx.m04AnchorUrl) throw new Error('M02 requires M04 anchor');

  const { angles, flat, item: focusItem } = await getFocusGarmentImages(ctx.wardrobe, 'back');
  const model = await getModel(ctx.modelId) as any;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;
  const backRefUrl = model?.backReferenceImageUrl;

  const refs: ReferenceImage[] = [];

  // Image 1: Back reference (preferred) or front reference for identity
  if (backRefUrl) {
    refs.push(await loadRef(backRefUrl, 'MODEL BACK REFERENCE — match this back view: hair, skin, build, proportions EXACTLY'));
  }
  if (modelRefUrl) {
    refs.push(await loadRef(modelRefUrl, 'MODEL IDENTITY REFERENCE — match this person\'s face, skin tone, hair, and build EXACTLY'));
  }

  // Image 2: M04 full-body back (anchor)
  refs.push(await loadRef(ctx.m04AnchorUrl, 'FULL-BODY BACK SHOT — the SAME pants, model, and session. Match this garment EXACTLY.'));

  // Image 3: Flat back
  refs.push(await loadRef(flat, 'Garment Flat Back Image'));

  // Images 3-5: Back fit model angles
  for (let i = 0; i < angles.length; i++) {
    refs.push(await loadRef(angles[i], `Fit Model Back Angle ${i + 1}`));
  }

  // Images 7-8: Styling items — top back, shoes back (1 image each, back view only)
  const styling = await getStylingImages(ctx.wardrobe, 'back');
  refs.push(...styling);

  // Inject silhouette + styling descriptions
  const { topDescription, shoesDescription } = await getStylingDescriptions(ctx.wardrobe);
  let finalPrompt = injectSilhouette(prompt.generationPrompt, ctx.silhouette?.back || '');
  finalPrompt = injectStylingDescriptions(finalPrompt, topDescription, shoesDescription);
  finalPrompt = injectGender(finalPrompt, model?.gender || 'female');
  finalPrompt = injectGarmentType(finalPrompt, focusItem?.category || 'Pants');
  console.log(`[Generate] M02: ${refs.length} reference images, backRef=${!!backRefUrl}, top="${topDescription}", shoes="${shoesDescription}", gender=${model?.gender}, garment=${focusItem?.category}`);

  return generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: prompt.aspectOverride || APP_CONFIG.shots.M02.aspect,
    imageSize: APP_CONFIG.imageSize,
    model: prompt.modelOverride || APP_CONFIG.generationModel,
    apiKey: ctx.apiKey,
  });
}

/**
 * Generate M05 — Back pocket detail shot.
 * Images: M04 anchor + M03 anchor + flat back + 3 back fit models
 * No silhouette analysis needed for this shot.
 */
export async function generateM05(
  ctx: GenerationContext,
  prompt: LoadedPrompt,
): Promise<GenerationResult> {
  if (!ctx.m03AnchorUrl || !ctx.m04AnchorUrl) {
    throw new Error('M05 requires both M03 and M04 anchors');
  }

  const { angles, flat, item: focusItem } = await getFocusGarmentImages(ctx.wardrobe, 'back');
  const model = await getModel(ctx.modelId) as any;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;
  const backRefUrl = model?.backReferenceImageUrl;

  const refs: ReferenceImage[] = [];

  // Image 1: Back reference for skin tone consistency (preferred) or front reference
  if (backRefUrl) {
    refs.push(await loadRef(backRefUrl, 'MODEL BACK REFERENCE — match skin tone and back view EXACTLY'));
  } else if (modelRefUrl) {
    refs.push(await loadRef(modelRefUrl, 'MODEL IDENTITY REFERENCE — match this person\'s skin tone EXACTLY'));
  }

  // Image 2: M04 full-body back (primary anchor)
  refs.push(await loadRef(ctx.m04AnchorUrl, 'Full-body BACK shot (anchor — match garment exactly)'));

  // Image 3: M03 full-body front (color anchor)
  refs.push(await loadRef(ctx.m03AnchorUrl, 'Full-body FRONT shot (anchor — match garment color exactly)'));

  // Image 3: Flat back
  refs.push(await loadRef(flat, 'Garment Flat Back (pocket construction ground truth)'));

  // Images 4-6: Back fit model angles
  for (let i = 0; i < angles.length; i++) {
    refs.push(await loadRef(angles[i], `Fit Model Back Angle ${i + 1}`));
  }

  // M05 has no {silhouette} placeholder — use prompt directly
  let finalPrompt = prompt.generationPrompt;
  finalPrompt = injectGender(finalPrompt, model?.gender || 'female');
  finalPrompt = injectGarmentType(finalPrompt, focusItem?.category || 'Pants');

  console.log(`[Generate] M05: ${refs.length} reference images, gender=${model?.gender}, garment=${focusItem?.category}`);

  return generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: prompt.aspectOverride || APP_CONFIG.shots.M05.aspect,
    imageSize: APP_CONFIG.imageSize,
    model: prompt.modelOverride || APP_CONFIG.generationModel,
    apiKey: ctx.apiKey,
  });
}

/**
 * Get model reference + shoes reference for dressed base pipeline.
 * Used by route.ts to create the DressedBaseContext.
 */
export async function getDressedBaseInputs(ctx: GenerationContext): Promise<{
  modelRefImage: ReferenceImage;
  shoesRefImage: ReferenceImage;
  shoesDescription: string;
  openShoes: boolean;
}> {
  const model = await getModel(ctx.modelId) as any;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;
  if (!modelRefUrl) throw new Error(`Model reference image not found for ${ctx.modelId}`);

  const modelRefImage = await loadRef(modelRefUrl, 'MODEL IDENTITY REFERENCE — match this face, hair, skin tone, body type PRECISELY.');

  // Get shoes from wardrobe
  const shoeSlot = ctx.wardrobe?.shoe;
  if (!shoeSlot?.itemId) throw new Error('No shoes in wardrobe');

  const shoeItem = await getWardrobeItem(shoeSlot.itemId) as any;
  if (!shoeItem) throw new Error(`Shoe item not found: ${shoeSlot.itemId}`);

  const norm = normalizeWardrobeItem(shoeItem);
  const shoeUrl = norm?.flatFrontUrl || shoeItem.flatFrontUrl || norm?.fitModels?.front;
  if (!shoeUrl) throw new Error('No shoe image URL found');

  const shoesRefImage = await loadRef(shoeUrl, 'SHOES REFERENCE — the model wears these exact shoes.');
  const shoesDescription = shoeItem.description || shoeItem.name || 'Shoes';
  const openShoes = shoeItem.openShoes === true;

  return { modelRefImage, shoesRefImage, shoesDescription, openShoes };
}

/**
 * Route to the correct generator based on shot type.
 */
export async function generateShot(
  shotType: ShotType,
  ctx: GenerationContext,
  prompt: LoadedPrompt,
): Promise<GenerationResult> {
  if (prompt.modelOverride) {
    console.log(`[Generate] Model override: ${prompt.modelOverride}`);
  }
  if (prompt.aspectOverride) {
    console.log(`[Generate] Aspect ratio override: ${prompt.aspectOverride}`);
  }
  switch (shotType) {
    case 'M03': return generateM03(ctx, prompt);
    case 'M04': return generateM04(ctx, prompt);
    case 'M01': return generateM01(ctx, prompt);
    case 'M02': return generateM02(ctx, prompt);
    case 'M05': return generateM05(ctx, prompt);
    default: throw new Error(`Unknown shot type: ${shotType}`);
  }
}
