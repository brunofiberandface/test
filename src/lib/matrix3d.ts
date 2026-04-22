/**
 * CSS matrix3d solver for 4-corner perspective warp.
 *
 * Given a source rectangle (width × height, top-left at 0,0) and four
 * destination corner points, returns the CSS `matrix3d(…)` string that, when
 * applied as a transform on an element of that natural size, warps it so
 * each source corner lands on the matching destination corner.
 *
 * This gives Photoshop-style free-transform of an image in the browser with
 * zero server round-trips. Used by the LabelCornerPicker to overlay a
 * pre-rendered leather label on the shot and let the user stretch/squeeze
 * it in place with live feedback.
 *
 *     const m = getMatrix3dTransform(
 *       labelNaturalWidth, labelNaturalHeight,
 *       { tl: [x1,y1], tr: [x2,y2], br: [x3,y3], bl: [x4,y4] },
 *     );
 *     element.style.transform = m;
 *     element.style.transformOrigin = '0 0';
 *
 * The math is a direct linear transform: build an 8-row linear system from
 * the 4 point correspondences, solve via Gauss-Jordan, embed the resulting
 * 3×3 homography into a 4×4 matrix, emit column-major (CSS convention).
 */

export type Corner = [number, number];
export interface Corners {
  tl: Corner;
  tr: Corner;
  br: Corner;
  bl: Corner;
}

/**
 * Compute a 3×3 homography mapping 4 source points to 4 destination points.
 * Returns null if the system is degenerate (colinear / near-zero pivot).
 *
 * Row ordering: each (src, dst) pair contributes two equations.
 * h33 is fixed at 1 — we solve for the other 8 unknowns directly.
 */
function computeHomography(
  src: [Corner, Corner, Corner, Corner],
  dst: [Corner, Corner, Corner, Corner],
): number[] | null {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i];
    const [dx, dy] = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy, dx]);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy, dy]);
  }
  // Gauss-Jordan elimination on the 8×9 augmented matrix
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
  // h11..h32 from the last column; h33 = 1
  return [
    A[0][8], A[1][8], A[2][8],
    A[3][8], A[4][8], A[5][8],
    A[6][8], A[7][8], 1,
  ];
}

/**
 * Build the CSS matrix3d() string that warps the natural-size rectangle
 * [0,0]–[width,height] onto the 4 destination corners.
 *
 * Destination corners are in the coordinate space that CSS sees after the
 * element's transformOrigin is set to 0 0 — usually the container's local
 * pixel coordinates.
 *
 * Returns null if the destination quad is degenerate.
 */
export function getMatrix3dTransform(
  width: number,
  height: number,
  dstCorners: Corners,
): string | null {
  if (width <= 0 || height <= 0) return null;

  const src: [Corner, Corner, Corner, Corner] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const dst: [Corner, Corner, Corner, Corner] = [
    dstCorners.tl,
    dstCorners.tr,
    dstCorners.br,
    dstCorners.bl,
  ];
  const H = computeHomography(src, dst);
  if (!H) return null;

  // 3×3 homography → 4×4 matrix: insert an identity row/column for z.
  //
  //   h11 h12 0 h13
  //   h21 h22 0 h23
  //    0   0  1  0
  //   h31 h32 0 h33
  //
  // CSS matrix3d() takes 16 values in COLUMN-major order.
  const [h11, h12, h13, h21, h22, h23, h31, h32, h33] = H;
  const m = [
    h11, h21, 0, h31,   // col 1
    h12, h22, 0, h32,   // col 2
    0,   0,   1, 0,     // col 3
    h13, h23, 0, h33,   // col 4
  ];
  return `matrix3d(${m.join(',')})`;
}
