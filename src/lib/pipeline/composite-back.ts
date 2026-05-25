/**
 * Content-aware composite — undo Gemini's drift-on-preservation.
 *
 * Per LEARNING #102: generative models don't preserve — they regenerate.
 * Even when a Gemini edit prompt says "preserve everything except X", the
 * diffuser re-renders every pixel, softening the texture in areas it was
 * meant to leave alone (denim weave, pocket stitching, leather patch detail).
 *
 * This helper undoes that drift by content-aware compositing of the two
 * stage buffers:
 *
 *   - Build a per-pixel mask from the Euclidean distance between the
 *     pre-edit (Seedream) and post-edit (Gemini) RGB values.
 *   - LARGE diff → Gemini intentionally changed that region (e.g. painted
 *     a tucked tee where Seedream had bare skin) → keep Gemini's pixel.
 *   - SMALL diff → Gemini re-rendered with softening → snap back to the
 *     Seedream pixel.
 *   - The mask is then Gaussian-blurred so the transition between regions
 *     is a smooth gradient, not a hard step — no visible seam at the
 *     waistband.
 *
 * 2026-05-24 fix: was getting horizontal-band striping when Seedream
 * (2K native) and Gemini (4K native) dimensions mismatched and the
 * manual RGBA buffer construction got stride-misaligned. Rewrote to:
 *   1. Normalize both inputs to the SAME dimensions (Seedream's native).
 *   2. Use sharp.joinChannel for the alpha mask instead of manual byte ops.
 *   3. Explicit channel + size assertions at each step.
 */
import sharp from 'sharp';

export interface CompositeBackOptions {
  /**
   * Per-pixel RGB Euclidean-distance threshold below which a pixel is
   * considered "Gemini just re-rendered" (snap back to Seedream).
   * Distance is in [0, 441] (sqrt(255²·3)). Default 25.
   */
  threshold?: number;
  /**
   * Per-pixel RGB distance above which a pixel is fully attributed to
   * Gemini. Default = threshold + 50 → 75 by default.
   */
  fullSnapAt?: number;
  /**
   * Gaussian blur radius (in pixels) applied to the mask. Default 12.
   */
  blur?: number;
}

/**
 * Composite Gemini's edit over Seedream's source, content-aware.
 * Where pixels differ a lot (Gemini's intentional edit), keep Gemini.
 * Where pixels are similar (Gemini's drift-on-preservation), snap back
 * to Seedream's crisp pixel.
 *
 * Output dimensions match `seedreamBuf` (the source-of-truth resolution).
 * If `geminiBuf` is a different size, it's resized to Seedream's dims
 * before the diff is computed.
 *
 * Returns a PNG buffer.
 */
export async function compositeBackBySimilarity(
  seedreamBuf: Buffer,
  geminiBuf: Buffer,
  opts: CompositeBackOptions = {},
): Promise<Buffer> {
  const threshold = opts.threshold ?? 25;
  const fullSnapAt = opts.fullSnapAt ?? threshold + 50;
  const blur = opts.blur ?? 12;
  if (fullSnapAt <= threshold) {
    throw new Error(`compositeBackBySimilarity: fullSnapAt (${fullSnapAt}) must be > threshold (${threshold})`);
  }
  const band = fullSnapAt - threshold;

  // 1. Read Seedream's dimensions — these become the canonical output dims.
  const seedMeta = await sharp(seedreamBuf).metadata();
  if (!seedMeta.width || !seedMeta.height) {
    throw new Error('compositeBackBySimilarity: seedream buffer has no width/height in metadata');
  }
  const width = seedMeta.width;
  const height = seedMeta.height;

  // 2. Normalize BOTH buffers to: same dims, 3-channel RGB, raw bytes. The
  // explicit colorspace + removeAlpha + resize ensures no surprise from
  // Gemini being 4K, Seedream being 2K, or alpha channels lingering.
  const [seedRaw, gemRaw] = await Promise.all([
    sharp(seedreamBuf)
      .resize(width, height, { fit: 'fill' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(geminiBuf)
      .resize(width, height, { fit: 'fill' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);

  // Sanity: both must be 3 channels at the target dims.
  if (seedRaw.info.channels !== 3 || gemRaw.info.channels !== 3) {
    throw new Error(`compositeBackBySimilarity: expected 3 channels post-normalize, got seed=${seedRaw.info.channels} gem=${gemRaw.info.channels}`);
  }
  if (seedRaw.info.width !== width || seedRaw.info.height !== height) {
    throw new Error(`compositeBackBySimilarity: seedream post-resize ${seedRaw.info.width}×${seedRaw.info.height} != target ${width}×${height}`);
  }
  if (gemRaw.info.width !== width || gemRaw.info.height !== height) {
    throw new Error(`compositeBackBySimilarity: gemini post-resize ${gemRaw.info.width}×${gemRaw.info.height} != target ${width}×${height}`);
  }
  const expectedBytes = width * height * 3;
  if (seedRaw.data.length !== expectedBytes || gemRaw.data.length !== expectedBytes) {
    throw new Error(`compositeBackBySimilarity: raw byte length mismatch — expected ${expectedBytes}, seed=${seedRaw.data.length}, gem=${gemRaw.data.length}`);
  }

  // 3. Build similarity mask: 255 = Seedream wins, 0 = Gemini wins.
  const mask = Buffer.alloc(width * height);
  const seedData = seedRaw.data;
  const gemData = gemRaw.data;
  for (let i = 0; i < width * height; i++) {
    const off = i * 3;
    const dR = seedData[off] - gemData[off];
    const dG = seedData[off + 1] - gemData[off + 1];
    const dB = seedData[off + 2] - gemData[off + 2];
    const dist = Math.sqrt(dR * dR + dG * dG + dB * dB);
    let t: number;
    if (dist <= threshold) t = 0;
    else if (dist >= fullSnapAt) t = 1;
    else t = (dist - threshold) / band;
    mask[i] = Math.round((1 - t) * 255);
  }

  // 4. Blur the mask. Output via PNG → re-read so we get a guaranteed
  // pixel-aligned 1-channel buffer, not a raw byte stream that could
  // have stride padding from sharp internals.
  const softMaskPng = await sharp(mask, { raw: { width, height, channels: 1 } })
    .blur(blur)
    .png()
    .toBuffer();
  const softMaskMeta = await sharp(softMaskPng).metadata();
  if (softMaskMeta.width !== width || softMaskMeta.height !== height) {
    throw new Error(`compositeBackBySimilarity: blurred mask dims ${softMaskMeta.width}×${softMaskMeta.height} != ${width}×${height}`);
  }

  // 5. Build Seedream RGBA: RGB from the seedream raw + alpha from the
  // blurred mask. Use sharp.joinChannel (native sharp op, no manual
  // byte interleaving) so there's zero chance of stride misalignment.
  const seedRgbPng = await sharp(seedRaw.data, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  const seedRgba = await sharp(seedRgbPng)
    .joinChannel(softMaskPng)
    .png()
    .toBuffer();

  // 6. Build the gemini base as a same-dimension PNG so composite has a
  // clean canonical base buffer.
  const gemPng = await sharp(gemRaw.data, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();

  // 7. Composite Seedream-with-alpha over Gemini. Where alpha is high
  // (Seedream wins, pant region), the Gemini base is fully overwritten.
  // Where alpha is low (Gemini wins, tee region), Gemini shows through.
  const result = await sharp(gemPng)
    .composite([{ input: seedRgba, blend: 'over' }])
    .png()
    .toBuffer();

  return result;
}

// ────────────────────────────────────────────────────────────────────────
// Positional composite (M02 strip-paint, 2026-05-25)
// ────────────────────────────────────────────────────────────────────────
//
// 2026-05-25: replaces compositeBackBySimilarity for the M02 strip-paint
// path. The similarity-based composite couldn't fix the "pocket bleed"
// artifact (Gemini hallucinating back-pocket stitching onto the tee body)
// because the artifact lives INSIDE Gemini's intended-edit zone — pixel
// diff is large there, similarity composite keeps Gemini's pixels.
//
// Positional compositing is deterministic: above a fixed cut row Gemini
// wins, below it Seedream wins, with a small feathered transition.
// Combined with PRE-BLURRING Seedream's pant region in the input we send
// to Gemini, this prevents the bleed at its source — Gemini cannot see
// the high-frequency pocket detail to hallucinate from.

export interface PositionalCompositeOptions {
  /**
   * Fraction of total height where the cut sits. Above the cut → Gemini
   * wins. Below → Seedream wins. For 4096×4096 outputs:
   *   - cropped tees: 0.10 (~410 rows for Gemini above the waistband area)
   *   - tucked/untucked tees: 0.15 (~615 rows for Gemini extending below)
   */
  cutFraction: number;
  /** Width of the feather/blend band in pixels (default: 1% of height). */
  feather?: number;
}

/**
 * Composite Gemini's painted top region over Seedream's pant region by
 * ROW POSITION, with a feathered seam. Output dimensions match
 * `seedreamBuf` (the source-of-truth resolution); `geminiBuf` is resized
 * to match.
 *
 * Returns a PNG buffer.
 */
export async function positionalCompositeTop(
  seedreamBuf: Buffer,
  geminiBuf: Buffer,
  opts: PositionalCompositeOptions,
): Promise<Buffer> {
  const seedMeta = await sharp(seedreamBuf).metadata();
  if (!seedMeta.width || !seedMeta.height) {
    throw new Error('positionalCompositeTop: seedream buffer has no width/height');
  }
  const W = seedMeta.width;
  const H = seedMeta.height;
  const cutY = Math.round(H * opts.cutFraction);
  if (cutY <= 0 || cutY >= H) {
    throw new Error(
      `positionalCompositeTop: cutFraction ${opts.cutFraction} resolves to cutY=${cutY} for H=${H}`,
    );
  }
  const feather = Math.max(2, Math.round(opts.feather ?? H * 0.01));

  // Normalize both buffers to same dims, 3-channel sRGB. PNG round-trip so
  // both are pixel-aligned (no raw stride surprises).
  const [seedRgb, gemRgb] = await Promise.all([
    sharp(seedreamBuf).resize(W, H, { fit: 'fill' }).removeAlpha().toColourspace('srgb').png().toBuffer(),
    sharp(geminiBuf).resize(W, H, { fit: 'fill' }).removeAlpha().toColourspace('srgb').png().toBuffer(),
  ]);

  // Build feathered alpha mask: 255 above (cutY - feather/2), linear fade
  // 255→0 across feather rows, 0 below. The mask is 1-channel (alpha only).
  const fStart = Math.max(0, cutY - Math.floor(feather / 2));
  const fEnd = Math.min(H, cutY + Math.ceil(feather / 2));
  const mask = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    let v: number;
    if (y < fStart) v = 255;
    else if (y >= fEnd) v = 0;
    else v = Math.round(255 * (1 - (y - fStart) / Math.max(1, fEnd - fStart)));
    if (v > 0) mask.fill(v, y * W, (y + 1) * W);
  }
  const maskPng = await sharp(mask, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();

  // Attach mask as alpha to Gemini's RGB → RGBA. Composite over Seedream.
  const gemRgba = await sharp(gemRgb).joinChannel(maskPng).png().toBuffer();
  const stitched = await sharp(seedRgb)
    .composite([{ input: gemRgba, blend: 'over' }])
    .png()
    .toBuffer();
  return stitched;
}

// ────────────────────────────────────────────────────────────────────────
// Twin / diptych detector (M01/M02 Seedream pass-1, 2026-05-25)
// ────────────────────────────────────────────────────────────────────────
//
// Seedream's multi-ref behaviour with 5+ refs sometimes produces a "twin"
// diptych — two models side-by-side instead of one centred model. The
// rev-32 ByteDance audit defenses (per-ref labels + silent anchor +
// GLOBAL_RULES) reduce but don't eliminate the failure mode (~20% rate).
//
// Cheap structural detector: sample the centre column at mid-frame height.
//   - Single centred model: centre column at mid-frame = pant fabric
//     (denim wash → strong blue channel, mid-luminance).
//   - Twin diptych: centre column at mid-frame = STUDIO BACKGROUND between
//     the two model bodies (light grey/white, no blue dominance).
//
// The signal is robust because the model body always occupies the centre
// horizontally when single, and never occupies the centre when in a side-
// by-side twin layout. Threshold tuned on the 4096×4096 Kate Boyfriend
// outputs.

export interface TwinDetectResult {
  isTwin: boolean;
  /** Average luminance of the sampled centre band (0-255). */
  luminance: number;
  /** Blue-over-red channel dominance (denim → high positive; bg → near 0). */
  blueDominance: number;
}

/**
 * Detect whether a M01/M02 Seedream pass-1 output is a twin diptych.
 * Returns isTwin=true when the centre column at mid-frame height reads as
 * studio background (light + no blue dominance).
 */
export async function detectTwinDiptych(buf: Buffer): Promise<TwinDetectResult> {
  // Downsample to a small fixed grid — robust to slight aspect changes,
  // fast enough to run on every Seedream output.
  const W = 256;
  const H = 256;
  const { data } = await sharp(buf)
    .resize(W, H, { fit: 'fill' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Centre column band: x ∈ [47%, 53%] (~6% wide).
  // Mid-frame vertical band: y ∈ [40%, 60%] (where the pant region sits for
  // single, or the gap between models for twin).
  const xStart = Math.round(W * 0.47);
  const xEnd = Math.round(W * 0.53);
  const yStart = Math.round(H * 0.40);
  const yEnd = Math.round(H * 0.60);

  let totalR = 0, totalG = 0, totalB = 0, n = 0;
  for (let y = yStart; y < yEnd; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const off = (y * W + x) * 3;
      totalR += data[off];
      totalG += data[off + 1];
      totalB += data[off + 2];
      n++;
    }
  }
  const avgR = totalR / n;
  const avgG = totalG / n;
  const avgB = totalB / n;
  const luminance = (avgR + avgG + avgB) / 3;
  const blueDominance = avgB - avgR;

  // Twin signature: centre band is studio background.
  //   - Light luminance (mid-grey backdrop ~ 200-230 on srgb)
  //   - No blue dominance (denim has B-R > 20 typically; bg < 10)
  // Single centred model has either dark denim (low luminance) or strong
  // blue dominance (mid-light denim wash).
  const isTwin = luminance > 200 && blueDominance < 10;
  return { isTwin, luminance, blueDominance };
}

/**
 * Pre-blur the pant region of a Seedream image before sending to Gemini.
 * Purpose: Gemini regenerates everything it sees — when it sees crisp
 * back-pocket stitching, it sometimes hallucinates similar stitching onto
 * the tee body (LEARNING #105 — "pocket bleed"). By heavily blurring the
 * pant region in Gemini's INPUT, Gemini gets silhouette/color context but
 * no high-frequency details to copy upward.
 *
 * The output of Gemini's call then goes through `positionalCompositeTop`
 * which throws Gemini's blurred-region output away and restores Seedream's
 * original crisp pant pixels.
 *
 * Returns a PNG buffer same dimensions as input.
 */
export async function blurBelowCut(
  buf: Buffer,
  cutFraction: number,
  blurRadius = 80,
): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('blurBelowCut: buffer has no width/height');
  }
  const W = meta.width;
  const H = meta.height;
  const cutY = Math.round(H * cutFraction);
  const topCrop = await sharp(buf)
    .extract({ left: 0, top: 0, width: W, height: cutY })
    .png()
    .toBuffer();
  const blurredBottom = await sharp(buf)
    .extract({ left: 0, top: cutY, width: W, height: H - cutY })
    .blur(blurRadius)
    .png()
    .toBuffer();
  return await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .composite([
      { input: topCrop, top: 0, left: 0 },
      { input: blurredBottom, top: cutY, left: 0 },
    ])
    .png()
    .toBuffer();
}
