/**
 * Top garment description via Claude Opus 4.6.
 * Analyzes a top/shirt reference image and generates a rich text description
 * for use in Seedream prompts — replaces sending the actual top reference image
 * (which causes Seedream to copy crop-top styling instead of following tuck instructions).
 *
 * Cached on wardrobe items as `topDescription` + `topDescriptionAnalyzedAt`.
 */
import { analyzeWithClaude } from '@/lib/anthropic';
import { prepareForAnalysis } from './image-prep';

const TOP_DESCRIPTION_PROMPT = `You are a fashion photography stylist. Study this image of a top/shirt garment.

Write a concise, precise description of this top that another AI image generator will use to reproduce it. Focus ONLY on these attributes:

1. **Color**: Exact color (e.g., "olive green", "heather grey", "black"). If there's a gradient or wash, describe it.
2. **Fabric appearance**: How the fabric looks (e.g., "smooth cotton jersey", "ribbed knit", "woven linen"). Don't guess fiber content — describe visual texture.
3. **Neckline**: crew neck, V-neck, scoop, boat, etc.
4. **Sleeve length**: sleeveless, cap sleeve, short sleeve, 3/4 sleeve, long sleeve.
5. **Fit**: fitted, relaxed, oversized, cropped, boxy.
6. **Print/pattern**: solid, striped, graphic, etc. If solid, just say "solid".
7. **Any visible details**: buttons, zippers, seams, pocket, logo placement (describe position, don't reproduce logo text).

Write it as ONE sentence, max 40 words. Example: "Solid olive-green short-sleeve crew-neck fitted cotton jersey tee with clean hems and no visible print or branding."

Do NOT mention how the top should be worn (tucked/untucked) — that's handled separately.`;

/**
 * Analyze a top garment image and return a text description.
 */
export async function analyzeTopDescription(imageBuffer: Buffer): Promise<string> {
  console.log(`[TopDescription] Analyzing top via Claude Opus 4.6...`);

  const prepared = await prepareForAnalysis(imageBuffer);

  const result = await analyzeWithClaude({
    prompt: TOP_DESCRIPTION_PROMPT,
    images: [{ buffer: prepared, mimeType: 'image/jpeg' }],
    model: 'claude-opus-4-6',
    temperature: 0.2,
  });

  // Clean up — take just the first sentence/line if model is verbose
  const cleaned = result.trim().split('\n')[0].replace(/^["']|["']$/g, '').trim();
  console.log(`[TopDescription] Result (${cleaned.length} chars): ${cleaned}`);
  return cleaned;
}

// ── Helper for downloading images by URL ──
async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url.split('?')[0], { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Run top description analysis for a wardrobe item and cache on the doc.
 * Only runs for top/shirt category items with a flat front image.
 */
export async function runTopDescriptionForWardrobe(wardrobeItemId: string): Promise<string> {
  const { wardrobeCol, getWardrobeItem } = await import('@/lib/firestore');
  const { normalizeWardrobeItem } = await import('@/lib/wardrobe-compat');

  const item = await getWardrobeItem(wardrobeItemId) as any;
  if (!item) throw new Error(`Wardrobe item ${wardrobeItemId} not found`);

  const normalized = normalizeWardrobeItem(item);
  const imageUrl = normalized?.flatFrontUrl || item.flatFrontUrl;
  if (!imageUrl) {
    throw new Error(`Wardrobe item ${wardrobeItemId} has no flat front image`);
  }

  console.log(`[TopDescription] Running for wardrobe "${item.name}" (${wardrobeItemId})...`);

  const imageBuf = await downloadImage(imageUrl);
  const description = await analyzeTopDescription(imageBuf);

  // Cache on the wardrobe doc
  await wardrobeCol.doc(wardrobeItemId).update({
    topDescription: description,
    topDescriptionAnalyzedAt: new Date(),
    updatedAt: new Date(),
  });

  console.log(`[TopDescription] Cached for "${item.name}": ${description}`);
  return description;
}
