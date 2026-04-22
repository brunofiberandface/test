/**
 * A/B test: Silhouette analysis across 3 models.
 *
 * POST /api/admin/silhouette-ab
 * Body: { wardrobeItemId: string }
 *
 * Runs the same front silhouette prompt through:
 *   1. Gemini 2.5 Flash Lite (current)
 *   2. Claude Sonnet 4.6
 *   3. Claude Opus 4.6
 *
 * Returns all 3 results side-by-side with timing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getWardrobeItem, wardrobeCol } from '@/lib/firestore';
import { analyzeWithFlashLite } from '@/lib/vertex';
import { analyzeWithClaude } from '@/lib/anthropic';
import { prepareForAnalysis } from '@/lib/pipeline/image-prep';

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

async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { wardrobeItemId } = body;

    if (!wardrobeItemId) {
      return NextResponse.json({ error: 'wardrobeItemId required' }, { status: 400 });
    }

    // Try direct doc ID first, then search by designNumber / name
    let item = await getWardrobeItem(wardrobeItemId) as any;

    if (!item) {
      // Search by designNumber field
      const byDesign = await wardrobeCol
        .where('designNumber', '==', wardrobeItemId)
        .limit(1)
        .get();

      if (byDesign.empty) {
        // Search by name containing the design number
        const allItems = await wardrobeCol.get();
        const match = allItems.docs.find(d => {
          const data = d.data();
          const name = (data.name || '').toLowerCase();
          const desc = (data.description || '').toLowerCase();
          const design = (data.designNumber || '').toLowerCase();
          const search = wardrobeItemId.toLowerCase();
          return name.includes(search) || desc.includes(search) || design.includes(search);
        });
        if (match) {
          item = { id: match.id, ...match.data() };
        }
      } else {
        const doc = byDesign.docs[0];
        item = { id: doc.id, ...doc.data() };
      }
    }

    if (!item) {
      return NextResponse.json({ error: `Wardrobe item "${wardrobeItemId}" not found by ID, designNumber, or name` }, { status: 404 });
    }

    console.log(`[Silhouette A/B] Starting for wardrobe: ${item.name || wardrobeItemId}`);

    // Collect images: flat front + 3 front fit model angles
    const flatFrontUrl = item.flatFrontUrl;
    if (!flatFrontUrl) {
      return NextResponse.json({ error: 'No flat front URL found' }, { status: 400 });
    }

    // Use fitModels dict (named slots) for front angles
    // Fallback: fitModelUrls list (first 3 entries)
    const fm = item.fitModels || {};
    let angleUrls: string[] = [];

    if (fm.front && fm.front45Left && fm.front45Right) {
      // Named slots available — use front, front45Left, front45Right
      angleUrls = [fm.front, fm.front45Left, fm.front45Right];
    } else if (Array.isArray(item.fitModelUrls) && item.fitModelUrls.length >= 3) {
      // Flat list fallback — first 3 are typically front angles
      angleUrls = item.fitModelUrls.slice(0, 3);
    }

    if (angleUrls.length < 3) {
      return NextResponse.json({ error: `Need at least 3 front angles, found ${angleUrls.length}` }, { status: 400 });
    }

    // Download all images
    console.log(`[Silhouette A/B] Downloading flat + 3 angles...`);
    const [flatBuf, ...angleBufs] = await Promise.all([
      downloadImage(flatFrontUrl),
      ...angleUrls.map((url: string) => downloadImage(url)),
    ]);

    // Prepare at 1200px (same as production)
    const flatPrepped = await prepareForAnalysis(flatBuf);
    const anglesPrepped = await Promise.all(angleBufs.map((b: any) => prepareForAnalysis(b)));

    const allImages = [
      { buffer: flatPrepped, mimeType: 'image/jpeg' },
      ...anglesPrepped.map(b => ({ buffer: b, mimeType: 'image/jpeg' as const })),
    ];

    // Build fit hint if available
    const fitHint = (item.description || item.name || '').trim();
    const fitHintBlock = fitHint
      ? `PRODUCT FIT SPEC (GROUND TRUTH): The product description for this garment is: "${fitHint}".\nYour analysis MUST be consistent with this description. If the description indicates a boyfriend, relaxed, loose, wide-leg, or oversized fit, do NOT classify it as skinny or slim just because the fit model's body happens to be slim. Describe the garment as the fit the product description specifies. If the description indicates a skinny or slim fit, describe it as such. When in doubt, the product description wins.\n\n`
      : '';

    const fullPrompt = fitHintBlock + FRONT_ANALYSIS_PROMPT;

    // Run all 3 models in parallel
    console.log(`[Silhouette A/B] Running 3 models in parallel...`);

    interface ModelResult {
      model: string;
      result: string;
      elapsedMs: number;
      error: string | null;
      charCount: number;
      wordCount: number;
    }

    const runModel = async (
      name: string,
      fn: () => Promise<string>
    ): Promise<ModelResult> => {
      const start = Date.now();
      try {
        const result = await fn();
        const elapsed = Date.now() - start;
        return {
          model: name,
          result,
          elapsedMs: elapsed,
          error: null,
          charCount: result.length,
          wordCount: result.split(/\s+/).length,
        };
      } catch (err: any) {
        return {
          model: name,
          result: '',
          elapsedMs: Date.now() - start,
          error: err.message || String(err),
          charCount: 0,
          wordCount: 0,
        };
      }
    };

    const [flashLite, sonnet, opus] = await Promise.all([
      runModel('gemini-2.5-flash-lite', () =>
        analyzeWithFlashLite({ prompt: fullPrompt, images: allImages })
      ),
      runModel('claude-sonnet-4-6', () =>
        analyzeWithClaude({ prompt: fullPrompt, images: allImages, model: 'claude-sonnet-4-6' })
      ),
      runModel('claude-opus-4-6', () =>
        analyzeWithClaude({ prompt: fullPrompt, images: allImages, model: 'claude-opus-4-6' })
      ),
    ]);

    console.log(`[Silhouette A/B] Done. Flash Lite: ${flashLite.elapsedMs}ms, Sonnet: ${sonnet.elapsedMs}ms, Opus: ${opus.elapsedMs}ms`);

    return NextResponse.json({
      wardrobeItem: {
        id: wardrobeItemId,
        name: item.name,
        description: item.description,
      },
      results: [flashLite, sonnet, opus],
      summary: {
        fastestModel: [flashLite, sonnet, opus]
          .filter(r => !r.error)
          .sort((a, b) => a.elapsedMs - b.elapsedMs)[0]?.model || 'none',
        longestOutput: [flashLite, sonnet, opus]
          .filter(r => !r.error)
          .sort((a, b) => b.wordCount - a.wordCount)[0]?.model || 'none',
      },
    });
  } catch (err: any) {
    console.error('[Silhouette A/B] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
