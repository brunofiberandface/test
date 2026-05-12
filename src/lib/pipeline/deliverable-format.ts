/**
 * Deliverable formatter — produces the two final brand-spec output formats
 * from any source shot (M01, M02, M05, M06).
 *
 * Two formats per the G-Star brand spec sheet:
 *
 *   PDP (ECOM Product Detail Page)
 *     Canvas:   4000 × 4000 px (square)
 *     Margins:  500 px L/R, 400 px T/B
 *     Image area: 3000 × 3200 (aspect 1.067, near-square)
 *
 *   PLP (ECOM Product Listing Page)
 *     Canvas:   1500 × 2025 px (portrait)
 *     Margins:  200 px L/R, 200 px T/B
 *     Image area: 1100 × 1625 (aspect 1.477, portrait)
 *
 * Both:
 *   - sRGB color profile
 *   - JPEG, 300 DPI metadata
 *   - Background fill: #D5D3CC (matches the studio backdrop in our prompts)
 *
 * Operation: resize source-fit-inside the image area (preserve aspect, no crop),
 * then composite onto a #D5D3CC canvas of the target size, centered.
 *
 * M03 and M04 are intermediate artifacts (sources for M01/M02 crops) — they
 * are NOT formatted as deliverables. M05 and M06 are independent generations
 * and DO get formatted.
 */
import sharp from 'sharp';
import type { ShotType } from '@/types';

// Brand-spec backdrop hex from prompts
const BG_HEX = '#D5D3CC';
const BG_RGB = { r: 0xd5, g: 0xd3, b: 0xcc, alpha: 1 };
const JPEG_QUALITY = 92;
const DPI = 300;

interface FormatTarget {
  canvasW: number;
  canvasH: number;
  marginX: number;
  marginY: number;
  label: string;
}

// PDP target = 4000×4000 square. Source is natively 4000×4000 (post Seedream +
// lanczos upscale), so this is a direct passthrough — no scaling, no padding.
const PDP: FormatTarget = { canvasW: 4000, canvasH: 4000, marginX: 0, marginY: 0, label: 'PDP' };
// PLP target = 1500×2025 portrait. Square 4000×4000 source is COVER-cropped
// to portrait, keeping the subject centered (the model was generated centred
// in the square frame). Horizontal sides are trimmed equally; no #D5D3CC
// borders. Earlier fit-inside behaviour produced top/bottom letterboxing
// because square-into-portrait can't fit without padding — cover-crop is
// the right answer when the subject is centred.
const PLP: FormatTarget = { canvasW: 1500, canvasH: 2025, marginX: 0, marginY: 0, label: 'PLP' };

const DELIVERABLE_SHOTS: ReadonlySet<ShotType> = new Set(['M01', 'M02', 'M05', 'M06']);

export function isDeliverableShot(shotType: ShotType): boolean {
  return DELIVERABLE_SHOTS.has(shotType);
}

/**
 * COVER-resize source to fill canvasW × canvasH exactly, centered. The
 * subject is preserved centrally (the model is always rendered in the middle
 * of the source frame); aspect mismatch is resolved by cropping the over-
 * spilling axis equally on both sides.
 *
 * If marginX/marginY are nonzero, the source is COVER-resized to the inner
 * box and composited onto a full canvas with #D5D3CC borders — kept for
 * back-compat with non-zero-margin configs (none active in production now).
 *
 * sRGB output, JPEG @ 300 DPI metadata.
 */
/**
 * Sample the source's actual backdrop color from a 4-corner average. Used
 * for padding when aspect-mismatched sources need letterboxing — guarantees
 * the padding seamlessly matches the rendered backdrop instead of leaving
 * visible vertical/horizontal bands.
 *
 * The brand spec is #D5D3CC, but Gemini-generated M06 masters routinely
 * render their backdrop a few shades darker (≈ RGB 156/146/138). Using a
 * fixed BG_RGB for the padding produced visible side-bars on PDPs because
 * the Gemini render and the brand-spec hex didn't match. Sampling avoids
 * that mismatch entirely — whatever color the master used IS the pad color.
 */
async function sampleSourceBackdrop(source: Buffer): Promise<{ r: number; g: number; b: number; alpha: number }> {
  const meta = await sharp(source).metadata();
  const w = meta.width || 1024;
  const h = meta.height || 1024;
  const size = Math.max(20, Math.min(200, Math.floor(Math.min(w, h) * 0.05)));
  // 4 corners — averaging across all four reduces the risk of any single
  // corner happening to overlap a shadow, hair tip, or stray garment pixel.
  // The model's subject is always centered, so all four corners are pure
  // backdrop in production renders.
  const corners = [
    { left: 0, top: 0 },
    { left: w - size, top: 0 },
    { left: 0, top: h - size },
    { left: w - size, top: h - size },
  ];
  const samples = await Promise.all(corners.map(({ left, top }) =>
    sharp(source)
      .extract({ left, top, width: size, height: size })
      .resize(1, 1, { kernel: 'lanczos3' })
      .removeAlpha()
      .raw()
      .toBuffer(),
  ));
  const avg = (i: number) => Math.round(samples.reduce((s, b) => s + b[i], 0) / samples.length);
  return { r: avg(0), g: avg(1), b: avg(2), alpha: 1 };
}

async function formatToTarget(source: Buffer, t: FormatTarget): Promise<Buffer> {
  const innerW = t.canvasW - 2 * t.marginX;
  const innerH = t.canvasH - 2 * t.marginY;

  // 2026-05-12 FIX: pick fit mode based on source vs target aspect.
  //
  //   - If aspects match within 5%: use 'cover' (passthrough — no padding, no
  //     crop). This is the case for all Seedream shots (M01-M05) where source
  //     is natively 1:1.
  //   - If they differ: use 'contain' and SAMPLE the source's own corners for
  //     the padding color. Preserves all of the source (head + feet) and the
  //     padding seamlessly matches the rendered backdrop. This handles M06
  //     (Gemini outputs 3:4 portrait even when 1:1 is requested, because
  //     imageSize='4K' overrides the aspectRatio hint).
  //
  // 2026-05-12 BAND FIX: prior version padded with the brand-spec hex
  // (#D5D3CC) regardless of source. M06 masters render their backdrop a few
  // shades darker — so PDPs showed visible vertical bands. Sampling fixes it.
  const meta = await sharp(source).metadata();
  const srcAspect = (meta.width || 1) / (meta.height || 1);
  const tgtAspect = innerW / innerH;
  const aspectMismatch = Math.abs(srcAspect - tgtAspect) / tgtAspect > 0.05;
  const fit: 'cover' | 'contain' = aspectMismatch ? 'contain' : 'cover';

  // Only sample if we'll actually pad (contain). Sampling is ~30ms; skip
  // when not needed (cover passthrough for matching-aspect sources).
  const padColor = aspectMismatch ? await sampleSourceBackdrop(source) : BG_RGB;

  const resized = await sharp(source)
    .rotate() // honor EXIF
    .resize({
      width: innerW,
      height: innerH,
      fit,
      position: 'center',
      withoutEnlargement: false,
      background: padColor,
    })
    .toBuffer();

  // Fast path: zero margins — output is the resized buffer directly with the
  // correct JPEG/DPI metadata, no canvas composite needed.
  if (t.marginX === 0 && t.marginY === 0) {
    return await sharp(resized)
      .withMetadata({ density: DPI })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();
  }

  // Margins path: composite the cover-resized image onto a full canvas with
  // #D5D3CC borders. Only used when a non-zero margin config is active.
  const canvas = await sharp({
    create: {
      width: t.canvasW,
      height: t.canvasH,
      channels: 3,
      background: BG_RGB,
    },
  })
    .composite([{ input: resized, gravity: 'center' }])
    .withMetadata({ density: DPI })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();

  return canvas;
}

export async function formatPdp(source: Buffer): Promise<Buffer> {
  return formatToTarget(source, PDP);
}

export async function formatPlp(source: Buffer): Promise<Buffer> {
  return formatToTarget(source, PLP);
}

/**
 * One-shot helper: produce both PDP and PLP buffers in parallel.
 * Caller decides where to write them.
 */
export async function formatBoth(source: Buffer): Promise<{ pdp: Buffer; plp: Buffer }> {
  const [pdp, plp] = await Promise.all([formatPdp(source), formatPlp(source)]);
  return { pdp, plp };
}

export const DELIVERABLE_BG_HEX = BG_HEX;
