/**
 * Silhouette analysis via Flash Lite.
 * Analyzes garment width, fit, drape, and proportions from fit model images.
 * Output is injected into generation prompts as {silhouette}.
 */
import { analyzeWithFlashLite } from '@/lib/vertex';
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

5. HEM-TO-FLOOR RELATIONSHIP: Does the hem touch the floor? Pool on the shoe? Sit above the ankle? Be very specific about what you see in the fit model images.

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

5. HEM-TO-FLOOR RELATIONSHIP: Does the hem touch the floor? Pool on the shoe? Sit above the ankle? Be very specific about what you see in the fit model images.

6. WAIST FIT: Is the waist fitted, loose, sitting on the hips, or high-waisted?

7. UNIQUE SILHOUETTE FEATURES: Any distinctive panel seams, darts, back pockets, or construction details that affect the shape from behind.

Write in direct, visual language. No bullet points — write flowing descriptive paragraphs. This description will be injected directly into an image generation prompt, so write it as INSTRUCTIONS for how the pants should look.`;

export interface SilhouetteResult {
  front: string;
  back: string;
}

/**
 * Run silhouette analysis for both front and back views.
 * Input: flat images + 3 fit model angles per view direction.
 */
export async function analyzeSilhouette(images: {
  flatFront: Buffer;
  flatBack: Buffer | null;  // null if not available
  frontAngles: Buffer[];    // [front, front45Left, front45Right]
  backAngles: Buffer[];     // [back, back45Left, back45Right]
}): Promise<SilhouetteResult> {
  console.log('[Silhouette] Starting front + back analysis');

  // Prepare images at 1200px
  const frontFlat = await prepareForAnalysis(images.flatFront);
  const frontAnglesBufs = await Promise.all(images.frontAngles.map(b => prepareForAnalysis(b)));

  const backFlat = images.flatBack
    ? await prepareForAnalysis(images.flatBack)
    : frontFlat; // fallback to front flat if no back available
  const backAnglesBufs = await Promise.all(images.backAngles.map(b => prepareForAnalysis(b)));

  // Run both analyses in parallel
  const [frontResult, backResult] = await Promise.all([
    analyzeWithFlashLite({
      prompt: FRONT_ANALYSIS_PROMPT,
      images: [
        { buffer: frontFlat, mimeType: 'image/jpeg' },
        ...frontAnglesBufs.map(b => ({ buffer: b, mimeType: 'image/jpeg' as const })),
      ],
    }),
    analyzeWithFlashLite({
      prompt: BACK_ANALYSIS_PROMPT,
      images: [
        { buffer: backFlat, mimeType: 'image/jpeg' },
        ...backAnglesBufs.map(b => ({ buffer: b, mimeType: 'image/jpeg' as const })),
      ],
    }),
  ]);

  console.log(`[Silhouette] Front: ${frontResult.length} chars, Back: ${backResult.length} chars`);

  return {
    front: frontResult,
    back: backResult,
  };
}
