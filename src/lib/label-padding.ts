/**
 * Pad a label PNG with surrounding transparency so Seedance reads it as a
 * "small accent on a big surface" rather than "dominant subject".
 *
 * Background — labelAssets PNGs were observed to be 98-100% canvas-filled,
 * which Seedance interprets as the label being the hero element. Real G-Star
 * leather patches occupy only ~7% of the pocket area. Padding the label PNG
 * before passing to Seedance brings the apparent fill ratio down to ~16%,
 * which empirically matches a "small detail" signal.
 *
 * Algorithm:
 *   1. Find the bbox of non-transparent pixels in the input.
 *   2. Compute current fill ratio = bbox_area / canvas_area.
 *   3. If fill ratio is already ≤ TARGET_RATIO, return input unchanged.
 *   4. Else create a new canvas large enough that the label sits at TARGET_RATIO
 *      of the new canvas area, centered, with full transparency around it.
 *
 * Returns: PNG Buffer (RGBA).
 *
 * Tunable: TARGET_RATIO = 0.16 → ~2.5× linear padding for a 98%-filled input.
 *   Lower → smaller label rendered. Adjust if Seedance still over- or
 *   under-sizes the label after the first generation test.
 */
import sharp from 'sharp';

const TARGET_RATIO = 0.16;
const MIN_PAD_FACTOR = 1.5;   // never make the canvas smaller than this even if input is already padded
const MAX_PAD_FACTOR = 4.0;   // safety cap so we don't blow up to 50MB PNGs

export async function padLabelForSeedance(input: Buffer): Promise<Buffer> {
  const img = sharp(input).ensureAlpha();
  const meta = await img.metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (!w || !h) return input;

  // Read raw RGBA to find tight bbox of opaque pixels.
  const raw = await img.raw().toBuffer();
  // raw is RGBA row-major
  let xMin = w, xMax = -1, yMin = h, yMax = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4 + 3; // alpha channel index
      if (raw[idx] > 8) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
  }
  if (xMax < 0) {
    // Fully transparent input — nothing to do.
    return input;
  }
  const bboxW = xMax - xMin + 1;
  const bboxH = yMax - yMin + 1;
  const bboxArea = bboxW * bboxH;
  const canvasArea = w * h;
  const currentRatio = bboxArea / canvasArea;
  if (currentRatio <= TARGET_RATIO) {
    // Already padded enough.
    return input;
  }

  // Compute pad factor. We want bboxArea / newCanvasArea = TARGET_RATIO.
  // newCanvasArea = bboxArea / TARGET_RATIO. Linear factor = sqrt(newArea / canvasArea).
  let linearFactor = Math.sqrt((bboxArea / TARGET_RATIO) / canvasArea);
  linearFactor = Math.max(MIN_PAD_FACTOR, Math.min(MAX_PAD_FACTOR, linearFactor));

  const newW = Math.round(w * linearFactor);
  const newH = Math.round(h * linearFactor);

  // Center the original on a new transparent canvas.
  // We composite the original PNG (full canvas) at ((newW-w)/2, (newH-h)/2).
  // Important: we use the original input (not the bbox crop) so any anti-aliased
  // edges or soft alpha around the visible label is preserved.
  const out = await sharp({
    create: {
      width: newW,
      height: newH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input,
        left: Math.round((newW - w) / 2),
        top: Math.round((newH - h) / 2),
      },
    ])
    .png()
    .toBuffer();

  return out;
}
