/**
 * /api/label-assets
 * GET  → list all labelAssets templates (leather + pocket).
 * POST → upload a new label template. Three-tier transparency handling:
 *        1. PNG already has usable alpha    → save as-is.
 *        2. PNG has no alpha but background is uniform & body has no near-white →
 *           flatten + white-to-transparent, save converted.
 *        3. Otherwise                        → reject 400 with explanation.
 *
 * Body for POST (JSON):
 *   { type: 'leather' | 'pocket', displayName: string, imageBase64: string }
 *
 * Storage path: gs://gstar-ai-studio-assets/label-assets/{type}/{id}.png
 * Firestore doc: labelAssets/{id}
 *   { id, type, displayName, imageUrl, createdAt }
 */
import { NextRequest, NextResponse } from 'next/server';
import { labelAssetsCol } from '@/lib/firestore';
import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';
import { padLabelForSeedance } from '@/lib/label-padding';

const BUCKET = 'gstar-ai-studio-assets';

let _storage: Storage | null = null;
function gcs(): Storage {
  if (!_storage) _storage = new Storage({ projectId: process.env.GCP_PROJECT_ID });
  return _storage;
}

interface LabelAssetDoc {
  id: string;
  type: 'leather' | 'pocket';
  displayName: string;
  imageUrl: string;
  createdAt?: any;
}

export async function GET(_req: NextRequest) {
  try {
    const snap = await labelAssetsCol.get();
    const items: LabelAssetDoc[] = [];
    snap.forEach(d => {
      const data = d.data() as Partial<LabelAssetDoc>;
      items.push({
        id: d.id,
        type: (data.type === 'pocket' ? 'pocket' : 'leather'),
        displayName: data.displayName || d.id,
        imageUrl: data.imageUrl || '',
        createdAt: data.createdAt,
      });
    });
    // Stable order: leather first, then pocket; alphabetical by displayName within group.
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'leather' ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
    return NextResponse.json({ items });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Three-tier transparency analysis & repair.
 *
 * Returns either:
 *   { ok: true, buffer: Buffer }   — PNG ready to save
 *   { ok: false, reason: string }  — caller should 400
 */
async function ensureTransparency(
  inputBuffer: Buffer,
): Promise<{ ok: true; buffer: Buffer; mode: 'as-is' | 'auto-converted' } | { ok: false; reason: string }> {
  const meta = await sharp(inputBuffer).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (!w || !h) return { ok: false, reason: 'Could not read image dimensions.' };

  // Tier 1 — has alpha channel. Accept regardless of whether the alpha is
  // actually being used. Two valid label formats both end up here:
  //   (a) shaped designs with transparent surrounds (e.g. leather patches)
  //   (b) full-rectangle labels with opaque alpha (e.g. woven patches like
  //       black-yellow / black-grey — the whole rectangle IS the label)
  // The older "must have non-opaque pixels" check rejected (b), which forced
  // hand-padding workarounds. The auto-pad step downstream brings either
  // format to ~16% canvas fill before save, so the distinction doesn't
  // matter for the final stored asset.
  if (meta.hasAlpha) {
    const out = await sharp(inputBuffer).png().toBuffer();
    return { ok: true, buffer: out, mode: 'as-is' };
  }

  // Tier 2 / 3 — no usable alpha. Decide based on corner uniformity + body content.
  // 1. Sample 4 corners (5×5 px patches). They should all be approximately the same color.
  // 2. Confirm that color is near-white (R,G,B > 235).
  // 3. Confirm the body doesn't have isolated near-white pixels not connected to edges
  //    (i.e. no "white text" on a colored label that would get eaten by the threshold).
  //
  // If all three pass → tier 2 (auto-convert). Else → tier 3 (reject).

  const flat = await sharp(inputBuffer).removeAlpha().raw().toBuffer();
  // raw is RGB row-major
  const cornerPatch = (x: number, y: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = 0; dy < 5; dy++) {
      for (let dx = 0; dx < 5; dx++) {
        const px = Math.min(w - 1, Math.max(0, x + dx));
        const py = Math.min(h - 1, Math.max(0, y + dy));
        const idx = (py * w + px) * 3;
        r += flat[idx]; g += flat[idx + 1]; b += flat[idx + 2]; n++;
      }
    }
    return [r / n, g / n, b / n] as [number, number, number];
  };
  const corners = [
    cornerPatch(0, 0),
    cornerPatch(w - 5, 0),
    cornerPatch(0, h - 5),
    cornerPatch(w - 5, h - 5),
  ];
  // Corners should all be near-white.
  const allNearWhite = corners.every(([r, g, b]) => r > 235 && g > 235 && b > 235);
  if (!allNearWhite) {
    return {
      ok: false,
      reason:
        'PNG has no transparency and the background is not uniformly white. ' +
        'Please prepare the file in Photoshop/Photopea with a transparent background and re-upload.',
    };
  }
  // Corners should be uniform with each other (max channel difference ≤ 8).
  const maxCornerDelta = (() => {
    let m = 0;
    for (let i = 0; i < corners.length; i++) {
      for (let j = i + 1; j < corners.length; j++) {
        for (let c = 0; c < 3; c++) {
          m = Math.max(m, Math.abs(corners[i][c] - corners[j][c]));
        }
      }
    }
    return m;
  })();
  if (maxCornerDelta > 8) {
    return {
      ok: false,
      reason:
        'Background is uneven across corners (lighting gradient or multi-color background). ' +
        'Please prepare the file with a clean transparent background and re-upload.',
    };
  }

  // Now scan the body for near-white pixels that are NOT connected to the corners
  // (i.e. white text, white logo elements). We do a coarse check: count near-white
  // pixels strictly inside a 20%-margin from the edges. If >0.5% of inner pixels are
  // near-white, flag as ambiguous.
  const xMin = Math.floor(w * 0.2);
  const xMax = Math.floor(w * 0.8);
  const yMin = Math.floor(h * 0.2);
  const yMax = Math.floor(h * 0.8);
  let innerWhite = 0;
  let innerTotal = 0;
  for (let y = yMin; y < yMax; y++) {
    for (let x = xMin; x < xMax; x++) {
      const idx = (y * w + x) * 3;
      if (flat[idx] > 235 && flat[idx + 1] > 235 && flat[idx + 2] > 235) innerWhite++;
      innerTotal++;
    }
  }
  const innerWhiteRatio = innerTotal > 0 ? innerWhite / innerTotal : 0;
  if (innerWhiteRatio > 0.005) {
    return {
      ok: false,
      reason:
        `Detected ${(innerWhiteRatio * 100).toFixed(1)}% near-white pixels in the body of the label. ` +
        'Auto-conversion would eat those pixels (white text or design elements). ' +
        'Please author transparency manually in Photoshop/Photopea and re-upload.',
    };
  }

  // Tier 2 — safe to auto-convert. Threshold: any pixel with R,G,B all > 235 → fully transparent.
  // Pixels in the soft edge band (210–235) get partial alpha proportional to closeness to white.
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, j = 0; i < flat.length; i += 3, j += 4) {
    const r = flat[i], g = flat[i + 1], b = flat[i + 2];
    rgba[j] = r;
    rgba[j + 1] = g;
    rgba[j + 2] = b;
    const minChan = Math.min(r, g, b);
    if (minChan > 235) rgba[j + 3] = 0;
    else if (minChan > 210) rgba[j + 3] = Math.round(((235 - minChan) / 25) * 255);
    else rgba[j + 3] = 255;
  }
  const out = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return { ok: true, buffer: out, mode: 'auto-converted' };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, displayName, imageBase64 } = body || {};
    if (type !== 'leather' && type !== 'pocket') {
      return NextResponse.json({ error: 'type must be "leather" or "pocket"' }, { status: 400 });
    }
    if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
      return NextResponse.json({ error: 'displayName is required' }, { status: 400 });
    }
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return NextResponse.json({ error: 'imageBase64 is required' }, { status: 400 });
    }

    const cleanB64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const inputBuffer = Buffer.from(cleanB64, 'base64');

    const verdict = await ensureTransparency(inputBuffer);
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.reason }, { status: 400 });
    }

    // Pad the label with surrounding transparency so Seedance reads it as a
    // small detail rather than a hero subject. See lib/label-padding.ts for
    // the rationale and tunable.
    const paddedBuffer = await padLabelForSeedance(verdict.buffer);

    // Generate ID. Slug from displayName + timestamp suffix to keep unique.
    const slug = displayName.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 40) || 'label';
    const id = `${slug}-${Date.now().toString(36)}`;

    // Upload to GCS.
    const gcsPath = `label-assets/${type}/${id}.png`;
    await gcs().bucket(BUCKET).file(gcsPath).save(paddedBuffer, {
      metadata: { contentType: 'image/png' },
    });
    const imageUrl = `https://storage.googleapis.com/${BUCKET}/${gcsPath}`;

    // Write Firestore doc.
    await labelAssetsCol.doc(id).set({
      id,
      type,
      displayName: displayName.trim(),
      imageUrl,
      createdAt: new Date(),
      transparencyMode: verdict.mode, // 'as-is' or 'auto-converted' for traceability
    });

    return NextResponse.json({
      ok: true,
      item: { id, type, displayName: displayName.trim(), imageUrl },
      transparencyMode: verdict.mode,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
