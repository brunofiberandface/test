/**
 * Post-generation foot resize safety net (v2 — blurred-bg compositing).
 *
 * Gemini often generates oversized feet on full-body shots.
 * This extracts the bottom 12% of the image, scales it horizontally
 * (85% for closed shoes, 70% for open/heeled shoes), composites it
 * onto a heavily-blurred copy of the original bottom strip (preserving
 * the real background gradient instead of flat-filling), and blurs the seam.
 *
 * Cost: zero (Sharp runs locally). Speed: ~1-1.5s per 4K image.
 * Only applied to M03/M04 full-body shots.
 */
import sharp from 'sharp';

export interface FootResizeOptions {
  /** Whether the shoes are open-heel/sandals (more aggressive shrink) */
  openShoes?: boolean;
}

/**
 * Apply foot resize post-processing to a generated full-body image.
 * Returns the corrected buffer, or the original if resize is skipped.
 */
export async function footResize(
  imageData: Buffer,
  options: FootResizeOptions = {},
): Promise<Buffer> {
  const { openShoes = false } = options;

  try {
    const meta = await sharp(imageData).metadata();
    const W = meta.width || 1800;
    const H = meta.height || 2400;

    // ── 1. Sample actual background color from bottom corners ──
    const cornerSize = 10;
    const bottomLeft = await sharp(imageData)
      .extract({ left: 0, top: H - cornerSize, width: cornerSize, height: cornerSize })
      .raw()
      .toBuffer();
    const bottomRight = await sharp(imageData)
      .extract({ left: W - cornerSize, top: H - cornerSize, width: cornerSize, height: cornerSize })
      .raw()
      .toBuffer();

    let rSum = 0, gSum = 0, bSum = 0, pxCount = 0;
    for (let i = 0; i < bottomLeft.length; i += 3) {
      rSum += bottomLeft[i]; gSum += bottomLeft[i + 1]; bSum += bottomLeft[i + 2]; pxCount++;
    }
    for (let i = 0; i < bottomRight.length; i += 3) {
      rSum += bottomRight[i]; gSum += bottomRight[i + 1]; bSum += bottomRight[i + 2]; pxCount++;
    }
    const bgR = Math.round(rSum / pxCount);
    const bgG = Math.round(gSum / pxCount);
    const bgB = Math.round(bSum / pxCount);

    // ── 2. Check if there's clear floor space below the shoes ──
    // Only check the bottom 5% (the actual floor area). If shoes extend
    // all the way to the frame edge with no floor, we can't safely resize.
    const floorCheckH = Math.round(H * 0.05);
    const floorStrip = await sharp(imageData)
      .extract({
        left: Math.round(W * 0.15),
        top: H - floorCheckH,
        width: Math.round(W * 0.7),
        height: floorCheckH,
      })
      .raw()
      .toBuffer();

    let nonBgPixels = 0;
    const tolerance = 35;
    for (let i = 0; i < floorStrip.length; i += 3) {
      const dr = Math.abs(floorStrip[i] - bgR);
      const dg = Math.abs(floorStrip[i + 1] - bgG);
      const db = Math.abs(floorStrip[i + 2] - bgB);
      if (dr > tolerance || dg > tolerance || db > tolerance) nonBgPixels++;
    }
    const floorPixelCount = floorStrip.length / 3;
    const nonBgRatio = nonBgPixels / floorPixelCount;

    if (nonBgRatio > 0.25) {
      console.log(
        `[FootResize] SKIP — no clear floor space (${Math.round(nonBgRatio * 100)}% non-bg in bottom 5%). Shoes touch frame edge.`,
      );
      return imageData;
    }

    // ── 3. Extract, shrink, composite onto blurred original ──
    const footFraction = 0.12;
    const footH = Math.round(H * footFraction);
    const footTop = H - footH;
    const scaleFactor = openShoes ? 0.70 : 0.85;
    const newFootW = Math.round(W * scaleFactor);
    const offsetX = Math.round((W - newFootW) / 2);

    // Extract the foot strip and squeeze horizontally
    const footStrip = await sharp(imageData)
      .extract({ left: 0, top: footTop, width: W, height: footH })
      .resize(newFootW, footH, { fit: 'fill' })
      .toBuffer();

    // Instead of flat canvas, blur the ORIGINAL bottom strip heavily.
    // This preserves the real background gradient/shadows and eliminates
    // the visible side-patches that plagued v1's flat-color canvas.
    const blurredBg = await sharp(imageData)
      .extract({ left: 0, top: footTop, width: W, height: footH })
      .blur(40)
      .toBuffer();

    // Place shrunken foot strip centered on the blurred background
    const footComposite = await sharp(blurredBg)
      .composite([{ input: footStrip, left: offsetX, top: 0 }])
      .jpeg({ quality: 98 })
      .toBuffer();

    // Replace the bottom strip in the original image
    const resized = await sharp(imageData)
      .composite([{ input: footComposite, left: 0, top: footTop }])
      .jpeg({ quality: 95 })
      .toBuffer();

    // ── 4. Gaussian blur the seam line ──
    // Scale blur band with image height (6px was for ~2K, ~17px for 5.5K)
    const blurBandH = Math.max(8, Math.round(H * 0.003));
    const blurBandTop = Math.max(0, footTop - Math.round(blurBandH / 2));
    const seamBand = await sharp(resized)
      .extract({ left: 0, top: blurBandTop, width: W, height: blurBandH })
      .blur(5)
      .toBuffer();

    const result = await sharp(resized)
      .composite([{ input: seamBand, left: 0, top: blurBandTop }])
      .jpeg({ quality: 95 })
      .toBuffer();

    console.log(
      `[FootResize] Applied — ${scaleFactor * 100}% width, bottom ${footFraction * 100}%, ` +
      `bg=rgb(${bgR},${bgG},${bgB}), openShoes=${openShoes}, seamBlur=${blurBandH}px at y=${footTop}`,
    );

    return result;
  } catch (err) {
    console.error(`[FootResize] Failed, returning original:`, err);
    return imageData;
  }
}
