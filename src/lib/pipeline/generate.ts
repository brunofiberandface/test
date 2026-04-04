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
import { injectSilhouette, type LoadedPrompt } from './prompt-loader';
import { APP_CONFIG } from '@/lib/config';
import type { ShotType, JobWardrobe, FitModelAngles } from '@/types';

export interface GenerationContext {
  wardrobe: JobWardrobe;
  modelId: string;
  silhouette: { front: string; back: string };
  // Anchor URLs from previous shots in the dependency chain
  m03AnchorUrl?: string;
  m04AnchorUrl?: string;
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

  const fitModels: FitModelAngles = item.fitModels;

  // Select 3 angles based on view direction
  const angles = view === 'front'
    ? [fitModels.front, fitModels.front45Left, fitModels.front45Right]
    : [fitModels.back, fitModels.back45Left, fitModels.back45Right];

  // Select flat based on view direction
  const flat = view === 'back' && item.flatBackUrl
    ? item.flatBackUrl
    : item.flatFrontUrl;

  return { angles, flat, item };
}

/**
 * Get styling items (non-focus) — returns 1-2 reference images per item.
 */
async function getStylingImages(wardrobe: JobWardrobe): Promise<ReferenceImage[]> {
  const refs: ReferenceImage[] = [];

  for (const [slot, config] of Object.entries(wardrobe)) {
    if (config.isFocus) continue; // skip focus garment

    const item = await getWardrobeItem(config.itemId) as any;
    if (!item) continue;

    const label = slot === 'shoe' ? 'Shoes Reference' :
                  slot === 'top' ? 'Top Reference' :
                  `${slot} Reference`;

    // Front image (always available)
    if (item.flatFrontUrl) {
      refs.push(await loadRef(item.flatFrontUrl, `${label} (${item.name})`));
    } else if (item.fitModels?.front) {
      refs.push(await loadRef(item.fitModels.front, `${label} (${item.name})`));
    }

    // Back image (if available)
    if (item.flatBackUrl) {
      refs.push(await loadRef(item.flatBackUrl, `${label} Back (${item.name})`));
    }
  }

  return refs;
}

/**
 * Generate M03 — Full body front view.
 * Images: model ref + flat front + 3 front fit models + top ref + shoes ref
 */
export async function generateM03(
  ctx: GenerationContext,
  prompt: LoadedPrompt,
): Promise<GenerationResult> {
  const { angles, flat } = await getFocusGarmentImages(ctx.wardrobe, 'front');
  const model = await getModel(ctx.modelId) as any;
  if (!model?.referenceImageUrl) throw new Error('Model reference image not found');

  const refs: ReferenceImage[] = [];

  // Image 1: Model reference
  refs.push(await loadRef(model.referenceImageUrl, 'MODEL IDENTITY REFERENCE — match this face and hair EXACTLY'));

  // Image 2: Flat front
  refs.push(await loadRef(flat, 'Garment Flat Front Image (Ground truth for proportions)'));

  // Images 3-5: Front fit model angles
  for (let i = 0; i < angles.length; i++) {
    refs.push(await loadRef(angles[i], `Fit Model Front Angle ${i + 1}`));
  }

  // Images 6-7+: Styling items (top, shoes)
  const styling = await getStylingImages(ctx.wardrobe);
  refs.push(...styling);

  // Inject silhouette and generate
  const finalPrompt = injectSilhouette(prompt.generationPrompt, ctx.silhouette.front);

  console.log(`[Generate] M03: ${refs.length} reference images`);

  return generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: APP_CONFIG.shots.M03.aspect,
    imageSize: APP_CONFIG.imageSize,
    model: APP_CONFIG.generationModel,
  });
}

/**
 * Generate M04 — Full body back view.
 * Images: model ref + flat back + 3 back fit models + top ref + shoes ref + M03 anchor
 */
export async function generateM04(
  ctx: GenerationContext,
  prompt: LoadedPrompt,
): Promise<GenerationResult> {
  if (!ctx.m03AnchorUrl) throw new Error('M04 requires M03 anchor — M03 must generate first');

  const { angles, flat } = await getFocusGarmentImages(ctx.wardrobe, 'back');
  const model = await getModel(ctx.modelId) as any;
  if (!model?.referenceImageUrl) throw new Error('Model reference image not found');

  const refs: ReferenceImage[] = [];

  // Image 1: Model reference
  refs.push(await loadRef(model.referenceImageUrl, 'MODEL IDENTITY REFERENCE — match this person\'s hair, skin, build'));

  // Image 2: Flat back
  refs.push(await loadRef(flat, 'Garment Flat Back Image (Ground truth for proportions)'));

  // Images 3-5: Back fit model angles
  for (let i = 0; i < angles.length; i++) {
    refs.push(await loadRef(angles[i], `Fit Model Back Angle ${i + 1}`));
  }

  // Images 6-7+: Styling items
  const styling = await getStylingImages(ctx.wardrobe);
  refs.push(...styling);

  // Image 8: M03 anchor
  refs.push(await loadRef(ctx.m03AnchorUrl, 'FRONT VIEW of the same garment (match color, wash, and construction)'));

  // Inject silhouette and generate
  const finalPrompt = injectSilhouette(prompt.generationPrompt, ctx.silhouette.back);

  console.log(`[Generate] M04: ${refs.length} reference images`);

  return generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: APP_CONFIG.shots.M04.aspect,
    imageSize: APP_CONFIG.imageSize,
    model: APP_CONFIG.generationModel,
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

  const { angles, flat } = await getFocusGarmentImages(ctx.wardrobe, 'front');

  const refs: ReferenceImage[] = [];

  // Image 1: M03 full-body (anchor)
  refs.push(await loadRef(ctx.m03AnchorUrl, 'FULL-BODY FRONT SHOT — the SAME pants, model, and session. Match this garment EXACTLY.'));

  // Image 2: Flat front
  refs.push(await loadRef(flat, 'Garment Flat Front Image'));

  // Images 3-5: Front fit model angles
  for (let i = 0; i < angles.length; i++) {
    refs.push(await loadRef(angles[i], `Fit Model Front Angle ${i + 1}`));
  }

  // Image 6: Shoes only (from styling items)
  for (const [slot, config] of Object.entries(ctx.wardrobe)) {
    if (slot === 'shoe' && !config.isFocus) {
      const item = await getWardrobeItem(config.itemId) as any;
      if (item?.flatFrontUrl) {
        refs.push(await loadRef(item.flatFrontUrl, `Shoes Reference (${item.name})`));
      } else if (item?.fitModels?.front) {
        refs.push(await loadRef(item.fitModels.front, `Shoes Reference (${item.name})`));
      }
    }
  }

  const finalPrompt = injectSilhouette(prompt.generationPrompt, ctx.silhouette.front);

  console.log(`[Generate] M01: ${refs.length} reference images`);

  return generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: APP_CONFIG.shots.M01.aspect,
    imageSize: APP_CONFIG.imageSize,
    model: APP_CONFIG.generationModel,
  });
}

/**
 * Generate M02 — Cropped back view (navel to feet).
 * Images: M04 anchor + flat back + 3 back fit models + shoes ref
 */
export async function generateM02(
  ctx: GenerationContext,
  prompt: LoadedPrompt,
): Promise<GenerationResult> {
  if (!ctx.m04AnchorUrl) throw new Error('M02 requires M04 anchor');

  const { angles, flat } = await getFocusGarmentImages(ctx.wardrobe, 'back');

  const refs: ReferenceImage[] = [];

  // Image 1: M04 full-body back (anchor)
  refs.push(await loadRef(ctx.m04AnchorUrl, 'FULL-BODY BACK SHOT — the SAME pants, model, and session. Match this garment EXACTLY.'));

  // Image 2: Flat back
  refs.push(await loadRef(flat, 'Garment Flat Back Image'));

  // Images 3-5: Back fit model angles
  for (let i = 0; i < angles.length; i++) {
    refs.push(await loadRef(angles[i], `Fit Model Back Angle ${i + 1}`));
  }

  // Image 6: Shoes
  for (const [slot, config] of Object.entries(ctx.wardrobe)) {
    if (slot === 'shoe' && !config.isFocus) {
      const item = await getWardrobeItem(config.itemId) as any;
      if (item?.flatFrontUrl) {
        refs.push(await loadRef(item.flatFrontUrl, `Shoes Reference (${item.name})`));
      } else if (item?.fitModels?.front) {
        refs.push(await loadRef(item.fitModels.front, `Shoes Reference (${item.name})`));
      }
    }
  }

  const finalPrompt = injectSilhouette(prompt.generationPrompt, ctx.silhouette.back);

  console.log(`[Generate] M02: ${refs.length} reference images`);

  return generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: APP_CONFIG.shots.M02.aspect,
    imageSize: APP_CONFIG.imageSize,
    model: APP_CONFIG.generationModel,
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

  const { angles, flat } = await getFocusGarmentImages(ctx.wardrobe, 'back');

  const refs: ReferenceImage[] = [];

  // Image 1: M04 full-body back (primary anchor)
  refs.push(await loadRef(ctx.m04AnchorUrl, 'Full-body BACK shot (anchor — match garment exactly)'));

  // Image 2: M03 full-body front (color anchor)
  refs.push(await loadRef(ctx.m03AnchorUrl, 'Full-body FRONT shot (anchor — match garment color exactly)'));

  // Image 3: Flat back
  refs.push(await loadRef(flat, 'Garment Flat Back (pocket construction ground truth)'));

  // Images 4-6: Back fit model angles
  for (let i = 0; i < angles.length; i++) {
    refs.push(await loadRef(angles[i], `Fit Model Back Angle ${i + 1}`));
  }

  // M05 has no {silhouette} placeholder — use prompt directly
  const finalPrompt = prompt.generationPrompt;

  console.log(`[Generate] M05: ${refs.length} reference images`);

  return generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: APP_CONFIG.shots.M05.aspect,
    imageSize: APP_CONFIG.imageSize,
    model: APP_CONFIG.generationModel,
  });
}

/**
 * Route to the correct generator based on shot type.
 */
export async function generateShot(
  shotType: ShotType,
  ctx: GenerationContext,
  prompt: LoadedPrompt,
): Promise<GenerationResult> {
  switch (shotType) {
    case 'M03': return generateM03(ctx, prompt);
    case 'M04': return generateM04(ctx, prompt);
    case 'M01': return generateM01(ctx, prompt);
    case 'M02': return generateM02(ctx, prompt);
    case 'M05': return generateM05(ctx, prompt);
    default: throw new Error(`Unknown shot type: ${shotType}`);
  }
}
