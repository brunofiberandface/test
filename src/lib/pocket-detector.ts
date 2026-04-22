/**
 * Pocket Detector — uses Claude Sonnet 4.6 to locate the 4 corners of the
 * *right back pocket* (wearer-right, camera-left) in an M02 / M04 generated
 * image. These corners feed the homography that projects the wardrobe's
 * saved label corners into the generated frame.
 *
 * Why the pocket (not the label)?
 *  - The pocket is ~10× bigger than the label → far easier to detect.
 *  - The pocket is always visible on M02/M04 by construction; the label
 *    may be cropped, ambiguous or hallucinated.
 *  - A homography from pocket→pocket generalises to every pose, so we can
 *    re-use the style-level corners saved once in the label-setup UI.
 *
 * Prompt constraints:
 *  - Ask for pixel coordinates, absolute (not normalised).
 *  - Order: TL, TR, BR, BL (clockwise from top-left).
 *  - Return strict JSON — we parse + validate + clamp.
 */

import sharp from 'sharp';
import { analyzeWithClaude } from './anthropic';
import type { Point2D } from '@/types';

export type PocketQuad = [Point2D, Point2D, Point2D, Point2D];

const POCKET_PROMPT = `You are a geometry-detection helper. In the attached image of a person wearing denim trousers from the back, locate the RIGHT BACK POCKET (the pocket on the wearer's right side, which appears on the LEFT side of the image from the viewer's perspective).

The right back pocket is where the G-Star leather label lives. Return the FOUR corners of that pocket's outer stitched edge — the rectangular pocket mouth plus pocket body — in strict clockwise order starting from the top-left corner.

Respond with ONLY a JSON object, no markdown, no commentary:

{"tl":{"x":123,"y":456},"tr":{"x":234,"y":456},"br":{"x":234,"y":678},"bl":{"x":123,"y":678}}

Rules:
- Coordinates are absolute pixel values in the image (origin at top-left).
- All four points must lie inside image bounds.
- Order strictly: TL, TR, BR, BL — clockwise from top-left of the pocket.
- If the pocket is not visible, respond with {"error":"no pocket visible"}.
- Never wrap the JSON in markdown fences.`;

function isPoint(p: unknown): p is Point2D {
  return (
    !!p &&
    typeof (p as Point2D).x === 'number' &&
    typeof (p as Point2D).y === 'number' &&
    Number.isFinite((p as Point2D).x) &&
    Number.isFinite((p as Point2D).y)
  );
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

/**
 * Run pocket detection against a generated-image buffer.
 * Returns a TL/TR/BR/BL quad in pixel space, or null on failure.
 */
export async function detectPocketCorners(
  imageBuffer: Buffer,
): Promise<PocketQuad | null> {
  try {
    const meta = await sharp(imageBuffer).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    if (!w || !h) {
      console.warn('[PocketDetector] could not read image metadata');
      return null;
    }

    const raw = await analyzeWithClaude({
      prompt: POCKET_PROMPT,
      images: [{ buffer: imageBuffer, mimeType: 'image/png' }],
      model: 'claude-sonnet-4-6',
      temperature: 0.1,
    });

    const cleaned = stripFences(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.warn(
        `[PocketDetector] non-JSON response: ${cleaned.slice(0, 200)}`,
      );
      return null;
    }

    const obj = parsed as Record<string, unknown>;
    if (typeof obj.error === 'string') {
      console.warn(`[PocketDetector] model reported: ${obj.error}`);
      return null;
    }
    if (!isPoint(obj.tl) || !isPoint(obj.tr) || !isPoint(obj.br) || !isPoint(obj.bl)) {
      console.warn(
        `[PocketDetector] missing/invalid corners: ${JSON.stringify(parsed).slice(0, 200)}`,
      );
      return null;
    }

    const clamp = (p: Point2D): Point2D => ({
      x: Math.max(0, Math.min(w - 1, Math.round(p.x))),
      y: Math.max(0, Math.min(h - 1, Math.round(p.y))),
    });
    const quad: PocketQuad = [
      clamp(obj.tl as Point2D),
      clamp(obj.tr as Point2D),
      clamp(obj.br as Point2D),
      clamp(obj.bl as Point2D),
    ];

    // Reject degenerate quads (zero/tiny area)
    const pocketW = Math.max(
      Math.abs(quad[1].x - quad[0].x),
      Math.abs(quad[2].x - quad[3].x),
    );
    const pocketH = Math.max(
      Math.abs(quad[3].y - quad[0].y),
      Math.abs(quad[2].y - quad[1].y),
    );
    if (pocketW < 20 || pocketH < 20) {
      console.warn(
        `[PocketDetector] degenerate quad: ${pocketW}x${pocketH}`,
      );
      return null;
    }

    console.log(
      `[PocketDetector] ${w}x${h} → TL(${quad[0].x},${quad[0].y}) TR(${quad[1].x},${quad[1].y}) BR(${quad[2].x},${quad[2].y}) BL(${quad[3].x},${quad[3].y})`,
    );
    return quad;
  } catch (err) {
    console.error('[PocketDetector] failed:', err);
    return null;
  }
}
