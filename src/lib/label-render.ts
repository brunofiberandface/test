/**
 * Bridge between the 3-tier Firestore schema (LabelRenderConfig) and the
 * hybrid shader's flat config (LabelHybridConfig).
 *
 * This is the single place where LabelRenderConfig → LabelHybridConfig
 * conversion happens, so the generate route never has to know about
 * label-hybrid.ts internals.
 */

import type { LabelRenderConfig, Point2D } from '@/types';
import type { LabelCorners, LabelHybridConfig } from './label-hybrid';

function getInternalBase(): string {
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

/**
 * Resolve relative (/label-assets/...) URLs to absolute localhost URLs
 * so label-hybrid.ts can fetch() them. Absolute URLs pass through unchanged.
 */
export function resolveAssetUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${getInternalBase()}${url}`;
  return url;
}

/**
 * Convert a resolved 3-tier render config into the flat LabelHybridConfig
 * that applyHybridLabel expects.
 */
export function renderConfigToHybridConfig(
  render: LabelRenderConfig,
): LabelHybridConfig {
  return {
    enabled: true,
    templateId: render.templateId,
    templateUrl: resolveAssetUrl(render.artworkUrl),
    materialTileUrl: resolveAssetUrl(render.materialTileUrl),
    baseColor: render.baseColor.hex,
    stitchColor: render.stitchColor?.hex,
    embossStrength: render.embossStrength,
  };
}

/**
 * Project the style's label corners (picked in fit-photo coordinates) into
 * the generated image via a homography from the style's pocketCorners → the
 * pocket detected in the generated image.
 *
 * Both input quads are in TL/TR/BR/BL order.
 *
 * The homography H maps source → destination, then we apply it to each label
 * corner. This is a 4-point (no RANSAC) projective transform — direct linear
 * solution of the 8×8 system.
 *
 * @returns LabelCorners (dest image pixel space), or null if degenerate.
 */
export function projectLabelCornersViaHomography(
  labelCornersSrc: [Point2D, Point2D, Point2D, Point2D],
  pocketCornersSrc: [Point2D, Point2D, Point2D, Point2D],
  pocketCornersDst: [Point2D, Point2D, Point2D, Point2D],
): LabelCorners | null {
  const H = computeHomography(pocketCornersSrc, pocketCornersDst);
  if (!H) return null;

  const apply = (p: Point2D): [number, number] => {
    const w = H[6] * p.x + H[7] * p.y + H[8];
    if (!w || !Number.isFinite(w)) return [NaN, NaN];
    return [
      (H[0] * p.x + H[1] * p.y + H[2]) / w,
      (H[3] * p.x + H[4] * p.y + H[5]) / w,
    ];
  };

  const tl = apply(labelCornersSrc[0]);
  const tr = apply(labelCornersSrc[1]);
  const br = apply(labelCornersSrc[2]);
  const bl = apply(labelCornersSrc[3]);
  for (const [x, y] of [tl, tr, br, bl]) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  }
  return { tl, tr, br, bl };
}

/**
 * Solve the 8 unknowns of a 3x3 homography (last element fixed to 1) that
 * maps 4 source points to 4 destination points. Direct linear transform —
 * no RANSAC, no SVD, just an 8x8 Gauss elimination.
 */
function computeHomography(
  src: [Point2D, Point2D, Point2D, Point2D],
  dst: [Point2D, Point2D, Point2D, Point2D],
): number[] | null {
  // Build 8x9 augmented matrix
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy, dx]);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy, dy]);
  }
  // Gauss-Jordan
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    }
    if (Math.abs(A[piv][col]) < 1e-10) return null;
    if (piv !== col) {
      const tmp = A[col];
      A[col] = A[piv];
      A[piv] = tmp;
    }
    const pivVal = A[col][col];
    for (let c = col; c < 9; c++) A[col][c] /= pivVal;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const factor = A[r][col];
      if (factor === 0) continue;
      for (let c = col; c < 9; c++) A[r][c] -= factor * A[col][c];
    }
  }
  // Extract h11..h32; h33 = 1
  return [A[0][8], A[1][8], A[2][8], A[3][8], A[4][8], A[5][8], A[6][8], A[7][8], 1];
}
