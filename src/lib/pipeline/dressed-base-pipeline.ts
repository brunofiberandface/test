/**
 * Dressed base pipeline — 4-pass foot proportion correction.
 *
 * Generates a clean model reference (t-shirt + shorts + shoes) with
 * correct foot proportions, to be used as anchor in garment generation.
 *
 * Pass 1: Flash generate model with shoes only (minimal refs → better proportions)
 * Pass 2: Sharp foot resize (shrink oversized feet to EU 38)
 * Pass 3: Flash heal ankle alignment (fix seam artifacts from Sharp)
 * Pass 4: Sharp background warm grey correction (heal pass shifts bg white)
 *
 * Cost: 2× Flash calls (~$0.02-0.03) + 2× Sharp (free, <1s each)
 * Time: ~25-40s typical (Flash speed varies)
 */
import sharp from 'sharp';
import { generateImage, type ReferenceImage } from '@/lib/vertex';
import { footResize } from './foot-resize';

const FLASH_MODEL = 'gemini-3.1-flash-image-preview';
const FLASH_FALLBACK = 'gemini-2.5-flash-image';
const TARGET_BG = { r: 213, g: 211, b: 204 }; // #D5D3CC warm grey

export interface DressedBaseContext {
  modelRefImage: ReferenceImage;     // Model card / identity reference
  shoesRefImage: ReferenceImage;     // Shoes flat reference
  shoesDescription: string;          // e.g. "Black leather slingback loafers"
  view: 'front' | 'back';
  aspectRatio?: string;
  openShoes?: boolean;
  apiKey?: string;                   // API key for Generative Language API
  /** Called between passes for progress reporting */
  onProgress?: (step: string, pct: number) => Promise<void>;
}

export interface DressedBaseResult {
  imageData: Buffer;
  mimeType: string;
  timings: {
    pass1: number;
    pass2: number;
    pass3: number;
    pass4: number;
    total: number;
  };
}

/**
 * Generate a dressed base with corrected foot proportions.
 * Returns a clean model image (t-shirt + shorts + shoes) ready to
 * be used as anchor for garment generation.
 */
export async function generateDressedBase(
  ctx: DressedBaseContext,
): Promise<DressedBaseResult> {
  const totalStart = Date.now();
  const aspect = ctx.aspectRatio || '3:4';
  const timings = { pass1: 0, pass2: 0, pass3: 0, pass4: 0, total: 0 };

  const viewPose = ctx.view === 'front'
    ? 'FRONT VIEW. Arms relaxed at sides. Feet hip-width apart, slight weight shift.'
    : 'BACK VIEW. Slight 3/4 turn. Arms relaxed. Weight on one leg.';

  // ── Pass 1: Generate model + shoes ──
  console.log(`[DressedBase] Pass 1: Generating model + shoes (${ctx.view}, ${aspect})`);
  await ctx.onProgress?.('Generating dressed base', 10);
  const pass1Start = Date.now();

  const genPrompt = `Generate a FULL-BODY fashion reference photograph of this specific model wearing the specified outfit.

MODEL IDENTITY (image 1): This is the EXACT person to generate. Match face, hair, skin tone, body type PRECISELY.

OUTFIT:
- SHOES: "${ctx.shoesDescription}" — reference image 2.
- UPPER BODY: Plain white fitted cotton t-shirt — simple, clean, no logos.
- LOWER BODY: SHORT black compression shorts ending at MID-THIGH. KNEES, SHINS, CALVES are BARE SKIN.

PROPORTION RULES:
- 175cm tall fashion model. Head = 1/8.5 of total height.
- Camera: 85mm lens, 5 meters distance, waist height. ZERO wide-angle distortion.
- Feet are SMALL and delicate — EU size 38. Each foot is narrower than the ankle.
- FRAMING: Head fully visible with 10% space above. Feet visible with 10% below. Model in MIDDLE 80%.
- Clean warm light grey (#D5D3CC) studio backdrop — uniform, consistent. ONE soft floor shadow.

EXPRESSION: Relaxed, confident. Lips TOGETHER. Eyes on camera.
VIEW: ${viewPose}
POSING: Slight hip tilt, soft knee bend — feminine and confident.`;

  const pass1 = await generateWithFallback(genPrompt, [ctx.modelRefImage, ctx.shoesRefImage], aspect, ctx.apiKey);
  timings.pass1 = Date.now() - pass1Start;
  console.log(`[DressedBase] Pass 1 done (${(timings.pass1 / 1000).toFixed(1)}s)`);

  // ── Pass 2: Sharp foot resize ──
  console.log('[DressedBase] Pass 2: Sharp foot resize');
  await ctx.onProgress?.('Correcting proportions', 30);
  const pass2Start = Date.now();

  const pass2 = await footResize(pass1, { openShoes: ctx.openShoes });
  timings.pass2 = Date.now() - pass2Start;
  console.log(`[DressedBase] Pass 2 done (${(timings.pass2 / 1000).toFixed(1)}s)`);

  // ── Pass 3: Flash heal ankle alignment ──
  console.log('[DressedBase] Pass 3: Flash heal ankle alignment');
  await ctx.onProgress?.('Refining alignment', 35);
  const pass3Start = Date.now();

  const healPrompt = `You are a professional photo retoucher. This fashion photograph has a minor issue in the foot/ankle area.

The feet were digitally resized but this created an unnatural ankle-to-shoe transition.

FIX ONLY THE AREA FROM MID-SHIN DOWNWARD:
- Make the ankle-to-shoe transition anatomically correct
- Each shoe directly below its ankle joint
- Heal any visible seam, blur band, or color mismatch around ankles
- The shoe SIZE is CORRECT — do NOT enlarge them

KEEP PIXEL-IDENTICAL: face, hair, body, clothing, framing.

CRITICAL — BACKGROUND: The background is warm light grey (#D5D3CC). It must stay warm grey — NOT white, NOT cool grey.

Generate the full corrected image.`;

  const healRef: ReferenceImage = {
    buffer: pass2,
    mimeType: 'image/png',
    label: 'IMAGE TO FIX — ankle-to-shoe transition needs healing. Shoe SIZE is correct.',
  };

  const pass3 = await generateWithFallback(healPrompt, [healRef], aspect, ctx.apiKey);
  timings.pass3 = Date.now() - pass3Start;
  console.log(`[DressedBase] Pass 3 done (${(timings.pass3 / 1000).toFixed(1)}s)`);

  // ── Pass 4: Sharp background warm grey correction ──
  console.log('[DressedBase] Pass 4: Background color correction');
  await ctx.onProgress?.('Color correction', 55);
  const pass4Start = Date.now();

  const pass4 = await correctBackground(pass3);
  timings.pass4 = Date.now() - pass4Start;
  console.log(`[DressedBase] Pass 4 done (${(timings.pass4 / 1000).toFixed(1)}s)`);

  timings.total = Date.now() - totalStart;
  console.log(`[DressedBase] Pipeline complete (${(timings.total / 1000).toFixed(1)}s)`);

  return {
    imageData: pass4,
    mimeType: 'image/png',
    timings,
  };
}

/**
 * Generate with Flash model fallback (3.1 → 2.5).
 * Flash 3.1 has better warm grey backgrounds but is often rate-limited.
 */
async function generateWithFallback(
  prompt: string,
  refs: ReferenceImage[],
  aspectRatio: string,
  apiKey?: string,
): Promise<Buffer> {
  const models = [FLASH_MODEL, FLASH_FALLBACK];

  for (const model of models) {
    try {
      const result = await generateImage({
        prompt,
        referenceImages: refs,
        aspectRatio,
        model,
        apiKey,
      });
      console.log(`[DressedBase] Generated with ${model}`);
      return result.imageData;
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('429') && model !== models[models.length - 1]) {
        console.warn(`[DressedBase] ${model} rate limited, falling back...`);
        continue;
      }
      throw e;
    }
  }

  throw new Error('[DressedBase] All Flash models rate limited');
}

/**
 * Smoothstep background color correction.
 * Shifts background pixels from whatever Gemini produced to target warm grey.
 * Model pixels (skin, clothing, shoes) stay untouched.
 */
async function correctBackground(imageData: Buffer): Promise<Buffer> {
  const meta = await sharp(imageData).metadata();
  const W = meta.width || 1800;
  const H = meta.height || 2400;

  // Sample bg color from edge columns (left/right 5%)
  const edgeW = Math.round(W * 0.05);
  const leftEdge = await sharp(imageData)
    .extract({ left: 0, top: 0, width: edgeW, height: H })
    .raw().toBuffer();
  const rightEdge = await sharp(imageData)
    .extract({ left: W - edgeW, top: 0, width: edgeW, height: H })
    .raw().toBuffer();

  let rS = 0, gS = 0, bS = 0, cnt = 0;
  for (const buf of [leftEdge, rightEdge]) {
    for (let i = 0; i < buf.length; i += 3) {
      const avg = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
      if (avg > 200) { // Only bright pixels (definitely background)
        rS += buf[i]; gS += buf[i + 1]; bS += buf[i + 2]; cnt++;
      }
    }
  }

  if (cnt === 0) {
    console.warn('[DressedBase] No bright bg pixels found, skipping correction');
    return imageData;
  }

  const healBg = { r: rS / cnt, g: gS / cnt, b: bS / cnt };
  console.log(
    `[DressedBase] BG correction: rgb(${healBg.r.toFixed(0)},${healBg.g.toFixed(0)},${healBg.b.toFixed(0)}) → ` +
    `rgb(${TARGET_BG.r},${TARGET_BG.g},${TARGET_BG.b})`,
  );

  const raw = await sharp(imageData).raw().toBuffer();
  const out = Buffer.from(raw);
  const bgTolerance = 60;

  for (let i = 0; i < out.length; i += 3) {
    const r = out[i], g = out[i + 1], b = out[i + 2];
    const dr = Math.abs(r - healBg.r);
    const dg = Math.abs(g - healBg.g);
    const db = Math.abs(b - healBg.b);
    const maxDelta = Math.max(dr, dg, db);

    if (maxDelta > bgTolerance) continue;

    // Smoothstep blend — full correction at exact bg, zero at tolerance edge
    const t = maxDelta / bgTolerance;
    const blend = 1.0 - (t * t * (3 - 2 * t));

    // Target: shift to warm grey, preserving pixel-level variation
    const tR = TARGET_BG.r + (r - healBg.r);
    const tG = TARGET_BG.g + (g - healBg.g);
    const tB = TARGET_BG.b + (b - healBg.b);

    out[i]     = Math.max(0, Math.min(255, Math.round(r + (tR - r) * blend)));
    out[i + 1] = Math.max(0, Math.min(255, Math.round(g + (tG - g) * blend)));
    out[i + 2] = Math.max(0, Math.min(255, Math.round(b + (tB - b) * blend)));
  }

  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}
