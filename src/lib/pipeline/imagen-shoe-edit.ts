/**
 * Imagen 3 shoe-edit pipeline step (replaces gemini-shoe-edit).
 *
 * Architecture context (LEARNINGS #82, #83):
 *   V1 — Gemini-3-pro-image-preview shoe-edit (rev 00458) airbrushed the
 *        denim texture across the WHOLE image. Reverted in 00462. Gemini is
 *        a generative model, not an inpainter — even with "preserve pixel-
 *        by-pixel" instructions, it regenerates the entire image.
 *   V2 — This file: Imagen 3 (`imagen-3.0-capability-001`) with explicit
 *        bottom-strip mask. Imagen guarantees pixel preservation outside
 *        the mask via the platform's edit API, exactly the property we need.
 *        Validated 2026-05-07: top portion pixel-perfect, bottom portion
 *        re-rendered with correct boot-under-pant geometry.
 *
 * Pipeline order: Seedream M0x → tee-edit (Gemini) → shoe-edit (Imagen 3) →
 *                 matte+grounding-shadow → upload.
 *
 * Skipped for M05 (no shoes in frame) and for cropped/cuffed garments
 * (silhouette pattern match — see CROPPED_HEM_PATTERNS below).
 */
import sharp from 'sharp';
import { GoogleAuth } from 'google-auth-library';
import { getWardrobeItem } from '@/lib/firestore';
import { normalizeWardrobeItem } from '@/lib/wardrobe-compat';
import type { ShotType, JobWardrobe } from '@/types';

export interface ShoeEditParams {
  sourceImage: Buffer;
  wardrobe: JobWardrobe;
  shotType: ShotType;
  /** Optional API key override; Imagen 3 uses Vertex OAuth so this is unused. */
  apiKey?: string;
}

export interface ShoeEditResult {
  imageData: Buffer;
  mimeType: string;
  edited: boolean;
  error?: string;
}

/** Shot types that get shoe-edit treatment. M05 has no shoes in frame.
 *  M01/M02 are crops of M03/M04 anchors and inherit the parent's shoe-edit.
 *
 *  DISABLED 2026-05-07 (Bruno): Imagen V2 worked on the rev53 CONTOR EXTREME
 *  LOOSE test case (where the garment's natural balloon volume let Imagen
 *  extend pants to floor smoothly), but failed on Judee straight-leg + suede
 *  boots — Imagen produced concertina/ruffle/tear artifacts. The Imagen
 *  approach isn't universal; it works only for garments whose silhouette
 *  already gestures toward the floor.
 *
 *  Code path is preserved for future iteration. To re-enable: restore
 *  ['M03', 'M04', 'M06']. Also need the size-fix in PNG handling (see code
 *  below — sharp() PNG re-encoding bloats Seedream's source past Imagen's
 *  27MB base64 limit).
 */
const SHOE_EDIT_SHOTS: Set<ShotType> = new Set();

const ASPECT_RATIOS: Record<string, string> = {
  M03: '3:4',
  M04: '3:4',
  M06: '3:4',
};

// ── Imagen 3 endpoint ───────────────────────────────────────────────────────
const PROJECT = process.env.GCP_PROJECT_ID || 'gstar-ai-studio';
// Imagen capability is hosted in us-central1 only.
const LOCATION = 'us-central1';
const MODEL = 'imagen-3.0-capability-001';
const IMAGEN_URL = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:predict`;

let _auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!_auth) {
    _auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }
  return _auth;
}

// ── Cropped-hem skip rule (carried over from V1) ────────────────────────────
const CROPPED_HEM_PATTERNS: RegExp[] = [
  /\brolled\s+(cuff|hem|leg)/i,
  /\bcuffed\s+(hem|leg|cuff|edge)/i,
  /\bcropped\s+(length|leg|hem|pant|pants|jean|jeans|fit|cut|with)/i,
  /\babove[-\s]ankle\b/i,
  /\bankle[-\s]length\b/i,
  /\bcalf[-\s]length\b/i,
  /\bmid[-\s]calf\b/i,
  /\braw\s+selvedge/i,
  /\bcropped[-\s]with[-\s]cuff/i,
  /\bdeliberate\s+rolled\s+cuff/i,
];

function silhouetteIndicatesCroppedHem(silhouette: string | undefined): boolean {
  if (!silhouette) return false;
  return CROPPED_HEM_PATTERNS.some(p => p.test(silhouette));
}

// ── Mask generation ─────────────────────────────────────────────────────────
/**
 * Build a vertical bottom-strip mask: WHITE pixels = will be re-rendered,
 * BLACK = preserved. The transition is a feathered gradient so the mask
 * boundary is invisible after Imagen's internal blend.
 *
 * Mask covers the bottom 30% of the image (legs/feet/floor area). Pant
 * waistband + pockets + upper jeans + body + face + top all stay above
 * the mask and are guaranteed-preserved by Imagen.
 */
async function buildBottomStripMask(width: number, height: number): Promise<Buffer> {
  const seamY = Math.round(height * 0.70);
  const feather = Math.round(height * 0.06);
  const start = seamY - Math.round(feather / 2);
  const end = seamY + Math.round(feather / 2);
  const raw = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    let v: number;
    if (y < start) v = 0;
    else if (y > end) v = 255;
    else v = Math.round(((y - start) / (end - start)) * 255);
    raw.fill(v, y * width, (y + 1) * width);
  }
  return sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

// ── Prompt ──────────────────────────────────────────────────────────────────
function buildImagenPrompt(shoesDescription: string, shotType: ShotType): string {
  const view = shotType === 'M04' ? 'back' : 'front';
  return `Photorealistic studio photograph, ${view} view. The pant fabric drapes from the leg straight down to the floor in soft natural folds. The pant is the OUTER LAYER. The footwear (${shoesDescription}) sits UNDER the pant fabric — the boots/shoes are mostly hidden behind the cascading hem, with only the heel and the very bottom of the sole visible at floor level.

The wide-leg silhouette is preserved at the bottom; the hem opening width matches the leg opening width above it. NO pinching, NO wrapping around the footwear, NO bunching at the boot top, NO tucking. The fabric falls in soft natural folds the way denim falls under gravity.

The fabric reaches the floor surface where the footwear sole rests on the ground. The garment is OUTSIDE / ABOVE; the footwear is UNDER / INSIDE.

Same garment construction, fabric, color, wash, seams, hardware as the surrounding image. Same backdrop and lighting. Same studio composition.`;
}

// ── Main entry point ────────────────────────────────────────────────────────
export async function applyShoeEdit(params: ShoeEditParams): Promise<ShoeEditResult> {
  const { sourceImage, wardrobe, shotType } = params;

  if (!SHOE_EDIT_SHOTS.has(shotType)) {
    console.log(`[ImagenShoeEdit] Skipping for ${shotType} (not in SHOE_EDIT_SHOTS)`);
    return { imageData: sourceImage, mimeType: 'image/png', edited: false };
  }

  const shoeConfig = wardrobe['shoe' as keyof JobWardrobe];
  if (!shoeConfig?.itemId) {
    console.log(`[ImagenShoeEdit] No shoe item — skipping`);
    return { imageData: sourceImage, mimeType: 'image/png', edited: false };
  }

  // Cropped-hem skip rule
  const bottomConfig = wardrobe['bottom' as keyof JobWardrobe];
  if (bottomConfig?.itemId) {
    const bottomItem = await getWardrobeItem(bottomConfig.itemId) as any;
    if (bottomItem) {
      const view = shotType === 'M04' ? 'back' : 'front';
      const silhouette: string = view === 'back'
        ? (bottomItem.silhouetteBack || bottomItem.silhouetteFront || '')
        : (bottomItem.silhouetteFront || bottomItem.silhouetteBack || '');
      if (silhouetteIndicatesCroppedHem(silhouette)) {
        console.log(`[ImagenShoeEdit] ${shotType}: cropped/cuffed hem in silhouette — skipping to preserve design`);
        return { imageData: sourceImage, mimeType: 'image/png', edited: false };
      }
    }
  }

  const shoeItem = await getWardrobeItem(shoeConfig.itemId) as any;
  if (!shoeItem) {
    console.warn(`[ImagenShoeEdit] Shoe item not found: ${shoeConfig.itemId}`);
    return { imageData: sourceImage, mimeType: 'image/png', edited: false };
  }
  const shoesDescription = shoeItem.description || shoeItem.name || 'footwear';

  // Build mask matching source dimensions
  const meta = await sharp(sourceImage).metadata();
  if (!meta.width || !meta.height) {
    console.warn(`[ImagenShoeEdit] Source image has no dimensions; skipping`);
    return { imageData: sourceImage, mimeType: 'image/png', edited: false };
  }
  const maskBuffer = await buildBottomStripMask(meta.width, meta.height);

  // Imagen has a 27MB max base64 limit on each reference image. Sharp's PNG
  // re-encoding bloats Seedream's already-encoded PNG (e.g., 7.7MB → 20.5MB
  // → 27.3MB base64, over limit). Pass source bytes through if already in
  // an Imagen-accepted format; otherwise re-encode to JPEG q90 (small).
  let sourceNorm: Buffer;
  if (meta.format === 'png' || meta.format === 'jpeg' || meta.format === 'jpg') {
    sourceNorm = sourceImage;
  } else {
    sourceNorm = await sharp(sourceImage).jpeg({ quality: 90 }).toBuffer();
  }
  // Defensive guard: if base64 size still > 26MB (close to Imagen's 27MB
  // limit, leaving room for prompt + mask in the request body), re-encode
  // as JPEG q85 for safety.
  if (sourceNorm.length * 1.34 > 26_000_000) {
    console.log(`[ImagenShoeEdit] ${shotType}: source too large (${sourceNorm.length}B), re-encoding to JPEG q85`);
    sourceNorm = await sharp(sourceImage).jpeg({ quality: 85 }).toBuffer();
  }
  console.log(`[ImagenShoeEdit] ${shotType}: source ${meta.width}x${meta.height}, ${sourceNorm.length}B (${meta.format})`);

  const prompt = buildImagenPrompt(shoesDescription, shotType);
  const aspectRatio = ASPECT_RATIOS[shotType] || '3:4';

  console.log(`[ImagenShoeEdit] ${shotType}: calling Imagen 3 inpaint (${shoesDescription.substring(0, 60)}..., ${meta.width}x${meta.height}, aspect=${aspectRatio})`);

  // Imagen 3 capability inpaint request
  const body = {
    instances: [{
      prompt,
      referenceImages: [
        {
          referenceType: 'REFERENCE_TYPE_RAW',
          referenceId: 1,
          referenceImage: { bytesBase64Encoded: sourceNorm.toString('base64') },
        },
        {
          referenceType: 'REFERENCE_TYPE_MASK',
          referenceId: 2,
          referenceImage: { bytesBase64Encoded: maskBuffer.toString('base64') },
          maskImageConfig: { maskMode: 'MASK_MODE_USER_PROVIDED' },
        },
      ],
    }],
    parameters: {
      editMode: 'EDIT_MODE_INPAINT_INSERTION',
      sampleCount: 1,
    },
  };

  // Retry pattern (Imagen transients exist too)
  const MAX_ATTEMPTS = 2;
  const RETRY_DELAY_MS = 3_000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const auth = getAuth();
      const client = await auth.getClient();
      const tokenResp = await client.getAccessToken();
      const token = tokenResp.token;
      if (!token) throw new Error('failed to get GCP access token');

      const t0 = Date.now();
      const resp = await fetch(IMAGEN_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(180_000),
        body: JSON.stringify(body),
      });
      const text = await resp.text();
      if (!resp.ok) {
        // Log the full body separately so it survives Error.toString newline-eating
        console.error(`[ImagenShoeEdit] ${shotType}: HTTP ${resp.status} body (full):`, text.replace(/\s+/g, ' ').slice(0, 1500));
        throw new Error(`Imagen ${resp.status}: ${text.replace(/\s+/g, ' ').substring(0, 400)}`);
      }
      const json = JSON.parse(text);
      const pred = json.predictions?.[0];
      const b64 = pred?.bytesBase64Encoded;
      if (!b64) {
        throw new Error('Imagen returned no image data');
      }
      const out = Buffer.from(b64, 'base64');
      const ms = Date.now() - t0;
      console.log(`[ImagenShoeEdit] ${shotType}: ok in ${ms}ms (${out.length} bytes) on attempt ${attempt}`);
      return { imageData: out, mimeType: 'image/png', edited: true };
    } catch (err) {
      lastErr = err;
      console.error(`[ImagenShoeEdit] ${shotType}: attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  console.error(`[ImagenShoeEdit] ${shotType}: all ${MAX_ATTEMPTS} attempts failed; returning input unchanged.`);
  return {
    imageData: sourceImage,
    mimeType: 'image/png',
    edited: false,
    error: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}

export function needsShoeEdit(shotType: ShotType): boolean {
  return SHOE_EDIT_SHOTS.has(shotType);
}
