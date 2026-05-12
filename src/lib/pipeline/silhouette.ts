/**
 * Silhouette analysis via Claude Opus 4.6.
 * Analyzes garment width, fit, drape, and proportions from fit model images.
 * Output is injected into generation prompts as {silhouette}.
 *
 * Upgraded from Gemini 2.5 Flash Lite → Claude Opus 4.6 (April 2026).
 * A/B test showed Opus produces significantly more precise silhouette
 * descriptions (specific width ratios per zone, 3D construction details,
 * drape mechanics) at ~$0.03/job — negligible vs generation cost.
 */
import { analyzeWithClaude } from '@/lib/anthropic';
import { prepareForAnalysis } from './image-prep';

const FRONT_ANALYSIS_PROMPT = `You are a garment analysis expert. Study these 4 images of the same pair of pants:
- Image 1: Flat lay front (garment laid flat on surface)
- Images 2-4: Fit model wearing the garment from different angles

Write a DETAILED description of the garment's silhouette, width, and proportions that another AI image generator will use to reproduce this garment EXACTLY. Be very specific and visual.

Cover ALL of the following in your description:

1. FIT CATEGORY: Is this skinny, slim, straight, relaxed, wide-leg, or oversized? Be precise.

2. WIDTH PROGRESSION: Describe how the width changes from waist → hip → thigh → knee → ankle → hem. For each zone, describe the width relative to the body part it covers (e.g., "at the knee, each leg is approximately 2x the width of the knee itself").

3. LEG OPENING: Describe the diameter of the hem opening. How does it compare to the width of the shoe? Does it cover the shoe partially or fully?

4. VOLUME & DRAPE: How does the fabric hang? Is it structured or flowing? Does it billow out? Are there folds or creases from excess fabric?

5. HEM-TO-GROUND RELATIONSHIP — write this as TWO parts in the same paragraph, clearly labelled.

PART A (observed): The fit model is barefoot or in socks. Describe the hem position in concrete ground-relative terms — exactly what you see in the photos. Use phrasings like:
  • "ends at the ankle bone with no excess length"
  • "ends mid-foot, covering the upper foot"
  • "extends to the floor with visible fabric piling in soft folds"
  • "extends past the foot with deep fabric pile resting on the ground"
  • "cuffed/rolled at the ankle, with the cuff sitting at mid-ankle height"
  • "ends mid-shin or mid-calf, exposing the ankle (cropped style)"

PART B (production translation): In the production render the model wears sneakers, which raise the foot ~3 cm above the floor. State explicitly what the hem-to-ground relationship should be in the production render with shoes — derive it from PART A:
  • If PART A is floor-length / cascading: the production hem is rendered slightly LONGER than the barefoot reference so the fabric still rests on the floor and pools over the shoes. "In production, the hem extends past the shoes to rest on the floor with visible fabric pooling."
  • If PART A is cuffed / cropped / above-the-ankle: the hem stays above the shoe regardless of footwear. "In production, the hem stays at the same body-relative position as the barefoot reference — above/around the ankle, with the entire shoe visible below."
  • If PART A is mid-foot / partial-shoe-cover: the production hem extends slightly more than the barefoot reference so the foot coverage stays similar with shoes added. "In production, the hem covers a similar portion of the foot, adjusted for the added shoe height."

Match the SHAPE exactly from the references; adjust LENGTH only as needed to maintain the observed ground relationship when shoes are on the foot. The fit-model photos are the SOURCE OF TRUTH for SHAPE and FIT, not for absolute hem height with shoes.

6. WAIST FIT: Is the waist fitted, loose, sitting on the hips, or high-waisted?

7. UNIQUE SILHOUETTE FEATURES: Any distinctive panel seams, darts, or construction details that affect the shape.

Write in direct, visual language. No bullet points — write flowing descriptive paragraphs. This description will be injected directly into an image generation prompt, so write it as INSTRUCTIONS for how the pants should look.`;

const BACK_ANALYSIS_PROMPT = `You are a garment analysis expert. Study these 4 images of the same pair of pants:
- Image 1: Flat lay back (garment laid flat on surface, back view)
- Images 2-4: Fit model wearing the garment from different back angles

Write a DETAILED description of the garment's silhouette, width, and proportions that another AI image generator will use to reproduce this garment EXACTLY. Be very specific and visual.

Cover ALL of the following in your description:

1. FIT CATEGORY: Is this skinny, slim, straight, relaxed, wide-leg, or oversized? Be precise.

2. WIDTH PROGRESSION: Describe how the width changes from waist → hip → thigh → knee → ankle → hem. For each zone, describe the width relative to the body part it covers (e.g., "at the knee, each leg is approximately 2x the width of the knee itself").

3. LEG OPENING: Describe the diameter of the hem opening. How does it compare to the width of the shoe? Does it cover the shoe partially or fully?

4. VOLUME & DRAPE: How does the fabric hang? Is it structured or flowing? Does it billow out? Are there folds or creases from excess fabric?

5. HEM-TO-GROUND RELATIONSHIP — write this as TWO parts in the same paragraph, clearly labelled.

PART A (observed): The fit model is barefoot or in socks. Describe the hem position in concrete ground-relative terms — exactly what you see in the photos. Use phrasings like:
  • "ends at the ankle bone with no excess length"
  • "ends mid-foot, covering the upper foot"
  • "extends to the floor with visible fabric piling in soft folds"
  • "extends past the foot with deep fabric pile resting on the ground"
  • "cuffed/rolled at the ankle, with the cuff sitting at mid-ankle height"
  • "ends mid-shin or mid-calf, exposing the ankle (cropped style)"

PART B (production translation): In the production render the model wears sneakers, which raise the foot ~3 cm above the floor. State explicitly what the hem-to-ground relationship should be in the production render with shoes — derive it from PART A:
  • If PART A is floor-length / cascading: the production hem is rendered slightly LONGER than the barefoot reference so the fabric still rests on the floor and pools over the shoes. "In production, the hem extends past the shoes to rest on the floor with visible fabric pooling."
  • If PART A is cuffed / cropped / above-the-ankle: the hem stays above the shoe regardless of footwear. "In production, the hem stays at the same body-relative position as the barefoot reference — above/around the ankle, with the entire shoe visible below."
  • If PART A is mid-foot / partial-shoe-cover: the production hem extends slightly more than the barefoot reference so the foot coverage stays similar with shoes added. "In production, the hem covers a similar portion of the foot, adjusted for the added shoe height."

Match the SHAPE exactly from the references; adjust LENGTH only as needed to maintain the observed ground relationship when shoes are on the foot. The fit-model photos are the SOURCE OF TRUTH for SHAPE and FIT, not for absolute hem height with shoes.

6. WAIST FIT: Is the waist fitted, loose, sitting on the hips, or high-waisted?

7. UNIQUE SILHOUETTE FEATURES: Any distinctive panel seams, darts, back pockets, or construction details that affect the shape from behind.

Write in direct, visual language. No bullet points — write flowing descriptive paragraphs. This description will be injected directly into an image generation prompt, so write it as INSTRUCTIONS for how the pants should look.`;

export interface SilhouetteResult {
  front: string;
  back: string;
}

/**
 * Build a fit-hint block to prepend to the analysis prompt.
 * Uses the wardrobe item's product description (e.g. "LOUX BOYFRIEND WMN",
 * "G-STRAIGHT", "SKINNY") as ground truth so the model cannot drift
 * toward a slimmer classification when the fit model is slim-bodied.
 */
function buildFitHintBlock(fitHint?: string): string {
  const trimmed = (fitHint || '').trim();
  if (!trimmed) return '';
  return `PRODUCT FIT SPEC (GROUND TRUTH): The product description for this garment is: "${trimmed}".
Your analysis MUST be consistent with this description. If the description indicates a boyfriend, relaxed, loose, wide-leg, or oversized fit, do NOT classify it as skinny or slim just because the fit model's body happens to be slim. Describe the garment as the fit the product description specifies. If the description indicates a skinny or slim fit, describe it as such. When in doubt, the product description wins.

`;
}

/**
 * Run silhouette analysis for both front and back views.
 * Input: flat images + 3 fit model angles per view direction.
 * Optional fitHint (typically the wardrobe item's description) is
 * prepended to the analysis prompt as a ground-truth anchor.
 */
export async function analyzeSilhouette(images: {
  flatFront: Buffer;
  flatBack: Buffer | null;  // null if not available
  frontAngles: Buffer[];    // [front, front45Left, front45Right]
  backAngles: Buffer[];     // [back, back45Left, back45Right]
  fitHint?: string;         // optional product description / fit spec
}): Promise<SilhouetteResult> {
  console.log(`[Silhouette] Starting front + back analysis via Claude Opus 4.6${images.fitHint ? ` (fitHint="${images.fitHint.slice(0, 60)}${images.fitHint.length > 60 ? '…' : ''}")` : ''}`);

  // Prepare images at 1200px
  const frontFlat = await prepareForAnalysis(images.flatFront);
  const frontAnglesBufs = await Promise.all(images.frontAngles.map(b => prepareForAnalysis(b)));

  const backFlat = images.flatBack
    ? await prepareForAnalysis(images.flatBack)
    : frontFlat; // fallback to front flat if no back available
  const backAnglesBufs = await Promise.all(images.backAngles.map(b => prepareForAnalysis(b)));

  const fitHintBlock = buildFitHintBlock(images.fitHint);

  // Run both analyses in parallel
  const [frontResult, backResult] = await Promise.all([
    analyzeWithClaude({
      prompt: fitHintBlock + FRONT_ANALYSIS_PROMPT,
      images: [
        { buffer: frontFlat, mimeType: 'image/jpeg' },
        ...frontAnglesBufs.map(b => ({ buffer: b, mimeType: 'image/jpeg' as const })),
      ],
      model: 'claude-opus-4-6',
    }),
    analyzeWithClaude({
      prompt: fitHintBlock + BACK_ANALYSIS_PROMPT,
      images: [
        { buffer: backFlat, mimeType: 'image/jpeg' },
        ...backAnglesBufs.map(b => ({ buffer: b, mimeType: 'image/jpeg' as const })),
      ],
      model: 'claude-opus-4-6',
    }),
  ]);

  console.log(`[Silhouette] Front: ${frontResult.length} chars, Back: ${backResult.length} chars`);

  return {
    front: frontResult,
    back: backResult,
  };
}

// ── Helper for downloading images by URL ──
async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url.split('?')[0], { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Run silhouette analysis for a wardrobe item and store the result on the doc.
 * Called once during wardrobe upload and by the backfill endpoint.
 * Returns the silhouette result (also written to Firestore).
 */
export async function runSilhouetteForWardrobe(wardrobeItemId: string): Promise<SilhouetteResult> {
  const { wardrobeCol, getWardrobeItem } = await import('@/lib/firestore');
  const { normalizeWardrobeItem } = await import('@/lib/wardrobe-compat');

  const item = await getWardrobeItem(wardrobeItemId) as any;
  if (!item) throw new Error(`Wardrobe item ${wardrobeItemId} not found`);

  const normalized = normalizeWardrobeItem(item);
  if (!normalized?.flatFrontUrl) {
    throw new Error(`Wardrobe item ${wardrobeItemId} has no flat front image`);
  }

  const fm = normalized.fitModels;
  if (!fm?.front || !fm?.back) {
    throw new Error(`Wardrobe item ${wardrobeItemId} missing fit model angles`);
  }

  console.log(`[Silhouette] Running for wardrobe "${item.name}" (${wardrobeItemId})...`);

  // Download all images
  const [
    frontBuf, front45LBuf, front45RBuf,
    backBuf, back45LBuf, back45RBuf,
    flatFrontBuf, flatBackBuf,
  ] = await Promise.all([
    downloadImage(fm.front),
    downloadImage(fm.front45Left),
    downloadImage(fm.front45Right),
    downloadImage(fm.back),
    downloadImage(fm.back45Left),
    downloadImage(fm.back45Right),
    downloadImage(normalized.flatFrontUrl),
    normalized.flatBackUrl
      ? downloadImage(normalized.flatBackUrl)
      : Promise.resolve(null),
  ]);

  const fitHint = [item.name, item.description].filter(Boolean).join(' — ');

  const result = await analyzeSilhouette({
    flatFront: flatFrontBuf,
    flatBack: flatBackBuf,
    frontAngles: [frontBuf, front45LBuf, front45RBuf],
    backAngles: [backBuf, back45LBuf, back45RBuf],
    ...(fitHint ? { fitHint } : {}),
  });

  // Cache on the wardrobe doc
  await wardrobeCol.doc(wardrobeItemId).update({
    silhouetteFront: result.front,
    silhouetteBack: result.back,
    silhouetteAnalyzedAt: new Date(),
    updatedAt: new Date(),
  });

  console.log(`[Silhouette] Cached on wardrobe "${item.name}" (front: ${result.front.length} chars, back: ${result.back.length} chars)`);
  return result;
}
