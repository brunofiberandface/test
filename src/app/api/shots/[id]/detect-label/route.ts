/**
 * GET /api/shots/[id]/detect-label
 *
 * Auto-detects the leather-label bounding quad in an M02/M04 shot using
 * Gemini vision. Used by the LabelCornerPicker to seed its starting handle
 * positions directly over the brown label — no manual dragging across the
 * whole image just to get started.
 *
 * Flow:
 *   1. Fetch shot + image URL
 *   2. Download + downscale to 1200×1200 for faster Gemini turnaround
 *   3. Ask Claude Sonnet 4.6 for the 4 corners as JSON
 *   4. Parse, auto-detect pixel vs normalized coords, return normalized 0..1
 *   5. Fall back to a reasonable hardcoded quad if Gemini fails
 *
 * Response:
 *   {
 *     ok: true,
 *     corners: { tl: [nx, ny], tr, br, bl },   // normalized 0..1
 *     source: 'gemini' | 'fallback',
 *     aspect: number,
 *   }
 *
 * Caching is the picker's responsibility (it stores the corners in its own
 * state and only refetches on open). We could add server-side caching later
 * if detection latency becomes a bottleneck.
 */

import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { shotsCol } from '@/lib/firestore';
import { analyzeWithClaude } from '@/lib/anthropic';

const DETECTION_SIZE = 1200;
const CLAUDE_TIMEOUT_MS = 45_000; // Sonnet 4.6 needs more headroom than Flash Lite

interface NormCorner {
  0: number;
  1: number;
}
interface NormCorners {
  tl: NormCorner;
  tr: NormCorner;
  br: NormCorner;
  bl: NormCorner;
}

// Sensible fallback: a small quad roughly where waistband leather labels sit
// on a back-view full-body shot. Used when Gemini fails or returns garbage.
const FALLBACK_CORNERS: NormCorners = {
  tl: [0.34, 0.52],
  tr: [0.46, 0.52],
  br: [0.46, 0.58],
  bl: [0.34, 0.58],
};

const DETECTION_PROMPT = `You are analyzing an image of a person wearing G-Star RAW denim or apparel.

Your job: find the leather brand label on the garment (typically brown/tan leather, rectangular, roughly the size of a credit card or smaller, often near the waistband for jeans or the neck/back for tops). Return its 4 corner points as JSON.

Return ONLY this exact JSON — no markdown, no explanation:

{"found": true, "tl": [x, y], "tr": [x, y], "br": [x, y], "bl": [x, y]}

Coordinates MUST be normalized to the range 0–1000 for BOTH x and y, where:
- [0, 0] = top-left of the image
- [1000, 1000] = bottom-right of the image
- Example: the exact center of the image is [500, 500]

Corner order is strict:
- tl = top-left corner of the leather label
- tr = top-right corner
- br = bottom-right corner
- bl = bottom-left corner

If no leather label is visible, return: {"found": false}`;

/**
 * Convert Gemini's response corners into normalized 0..1 coords.
 * Auto-detects whether Gemini returned 0..1000 normalized or pixel coords.
 */
function toNormCorners(
  parsed: { tl: [number, number]; tr: [number, number]; br: [number, number]; bl: [number, number] },
): NormCorners | null {
  const all = [...parsed.tl, ...parsed.tr, ...parsed.br, ...parsed.bl];
  if (all.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const max = Math.max(...all);
  // Gemini sometimes returns pixel coords from the detection image.
  // If max > 1000, it's pixel space (we sent 1200×1200), divide by that.
  // Otherwise it's 0..1000 normalized; divide by 1000.
  const divisor = max > 1000 ? DETECTION_SIZE : 1000;
  const norm = (pt: [number, number]): [number, number] => [
    Math.max(0, Math.min(1, pt[0] / divisor)),
    Math.max(0, Math.min(1, pt[1] / divisor)),
  ];
  return {
    tl: norm(parsed.tl),
    tr: norm(parsed.tr),
    br: norm(parsed.br),
    bl: norm(parsed.bl),
  };
}

/**
 * Sanity-check detected corners: non-degenerate quad, reasonable size
 * (between 0.5% and 40% of the image in either dimension).
 */
function validateCorners(c: NormCorners): boolean {
  const xs = [c.tl[0], c.tr[0], c.br[0], c.bl[0]];
  const ys = [c.tl[1], c.tr[1], c.br[1], c.bl[1]];
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  if (w < 0.005 || h < 0.005) return false; // too small
  if (w > 0.5 || h > 0.5) return false; // unreasonably large
  // rough ordering sanity — tl should be roughly upper-left, br lower-right
  if (c.tl[0] > c.br[0] + 0.02) return false;
  if (c.tl[1] > c.br[1] + 0.02) return false;
  return true;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const shotDoc = await shotsCol.doc(id).get();
    if (!shotDoc.exists) {
      return NextResponse.json({ error: 'shot not found' }, { status: 404 });
    }
    const shot = shotDoc.data() as { imageUrl?: string; type?: string };
    if (!shot.imageUrl) {
      return NextResponse.json({ error: 'shot has no imageUrl' }, { status: 400 });
    }

    // Download the shot image
    const res = await fetch(shot.imageUrl);
    if (!res.ok) {
      return NextResponse.json(
        { error: `download failed: ${res.status}` },
        { status: 502 },
      );
    }
    const imgBuf = Buffer.from(await res.arrayBuffer());

    // Downscale for faster detection — keep aspect via fit:inside
    const detectBuf = await sharp(imgBuf)
      .resize(DETECTION_SIZE, DETECTION_SIZE, { fit: 'inside' })
      .png()
      .toBuffer();

    let cornersNorm: NormCorners | null = null;
    let source: 'gemini' | 'fallback' = 'fallback';

    try {
      const textPromise = analyzeWithClaude({
        prompt: DETECTION_PROMPT,
        images: [{ buffer: detectBuf, mimeType: 'image/png' }],
        model: 'claude-sonnet-4-6',
        temperature: 0.1,
      });
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('claude timeout')), CLAUDE_TIMEOUT_MS),
      );
      const rawText = await Promise.race([textPromise, timeout]);

      // Strip fences / extract first JSON object
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('no JSON in response');
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed?.found === false) throw new Error('label not found');
      if (!parsed.tl || !parsed.tr || !parsed.br || !parsed.bl) {
        throw new Error('missing corner keys');
      }
      const candidate = toNormCorners(parsed);
      if (!candidate) throw new Error('invalid corner values');
      if (!validateCorners(candidate)) {
        throw new Error('corners failed sanity check');
      }
      cornersNorm = candidate;
      source = 'gemini';
    } catch (err) {
      console.log(
        `[DetectLabel] shot=${id} Gemini failed — falling back:`,
        err instanceof Error ? err.message : err,
      );
    }

    const corners = cornersNorm ?? FALLBACK_CORNERS;
    const meta = await sharp(imgBuf).metadata();
    const aspect = meta.width && meta.height ? meta.width / meta.height : 1;

    return NextResponse.json({
      ok: true,
      corners,
      source,
      aspect,
      imageSize: { width: meta.width, height: meta.height },
    });
  } catch (err) {
    console.error('[DetectLabel] failed:', err);
    return NextResponse.json(
      { error: 'detect-label failed', details: String(err) },
      { status: 500 },
    );
  }
}
