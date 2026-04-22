/**
 * POST /api/shots/[id]/apply-pocket-label
 *
 * Composite the woven Originals pocket label onto an M02/M04/M05 shot.
 *
 * Body:
 *   {
 *     pocketLabelCorners: { tl: [nx, ny], tr, br, bl }  // normalized 0..1
 *     wovenLabelFile?: string  // filename in public/, defaults to 'originals-label-gold-woven.png'
 *   }
 *
 * Flow:
 *   1. Load shot + validate shot type
 *   2. Download current shot image
 *   3. Convert normalized corners → pixel space
 *   4. applyWovenLabel(image, pixelCorners, wovenLabelFile)
 *   5. Upload new version, push old into previousVersions
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { shotsCol, getJob } from '@/lib/firestore';
import { uploadGeneratedImage, downloadGarmentImage } from '@/lib/gcs';
import {
  applyWovenLabel,
  type PocketLabelCorners,
} from '@/lib/label-hybrid';

interface NormalizedCorner {
  0: number;
  1: number;
}

function parseCorners(raw: unknown, fieldName: string) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${fieldName} missing or not an object`);
  }
  const c = raw as Record<string, unknown>;
  const check = (name: string): NormalizedCorner => {
    const v = c[name];
    if (!Array.isArray(v) || v.length !== 2) {
      throw new Error(`${fieldName}.${name} must be [x, y]`);
    }
    const [x, y] = v;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 || x > 1 || y < 0 || y > 1
    ) {
      throw new Error(
        `${fieldName}.${name} must be finite numbers in [0, 1] (got ${x}, ${y})`,
      );
    }
    return [x, y] as unknown as NormalizedCorner;
  };
  return {
    tl: check('tl'),
    tr: check('tr'),
    br: check('br'),
    bl: check('bl'),
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let shotId: string | undefined;
  try {
    const { id } = await params;
    shotId = id;

    const body = await req.json();
    if (!body?.pocketLabelCorners) {
      return NextResponse.json(
        { error: 'body must contain pocketLabelCorners: { tl, tr, br, bl }' },
        { status: 400 },
      );
    }

    // ── 1. Load shot
    const shotDoc = await shotsCol.doc(id).get();
    if (!shotDoc.exists) {
      return NextResponse.json({ error: 'Shot not found' }, { status: 404 });
    }
    const shot = shotDoc.data()!;
    const shotType = shot.shotType || shot.type;
    if (!['M02', 'M04', 'M05'].includes(shotType)) {
      return NextResponse.json(
        { error: `Pocket label only supported for M02/M04/M05, not ${shotType}` },
        { status: 400 },
      );
    }
    if (!shot.imageUrl) {
      return NextResponse.json({ error: 'Shot has no imageUrl' }, { status: 400 });
    }

    // ── 2. Download current shot image
    const sourceBuffer = await downloadGarmentImage(shot.imageUrl);
    const meta = await sharp(sourceBuffer).metadata();
    const imgW = meta.width || 0;
    const imgH = meta.height || 0;
    if (!imgW || !imgH) {
      return NextResponse.json(
        { error: 'could not read source image dimensions' },
        { status: 500 },
      );
    }

    // ── 3. Parse corners → pixel space
    const normalizedCorners = parseCorners(body.pocketLabelCorners, 'pocketLabelCorners');
    const toPx = (p: NormalizedCorner): [number, number] => [
      Math.round(p[0] * imgW),
      Math.round(p[1] * imgH),
    ];
    const pixelCorners: PocketLabelCorners = {
      tl: toPx(normalizedCorners.tl),
      tr: toPx(normalizedCorners.tr),
      br: toPx(normalizedCorners.br),
      bl: toPx(normalizedCorners.bl),
    };

    // Woven label file (defaults to the gold Originals label)
    const wovenLabelFile = body.wovenLabelFile || 'originals-label-gold-woven.png';

    console.log(
      `[ApplyPocketLabel] shot=${id} type=${shotType} size=${imgW}x${imgH} ` +
        `label=${wovenLabelFile} corners=${JSON.stringify(pixelCorners)}`,
    );

    // ── 4. Composite
    const composited = await applyWovenLabel(sourceBuffer, pixelCorners, wovenLabelFile);

    // ── 5. Upload with new version number
    const job = (await getJob(shot.jobId)) as any;
    const prevVersion = shot.version || 1;
    const newVersion = prevVersion + 1;
    const jobName = job?.jobName || job?.jobId || shot.jobId;
    const filename = `${job?.modelId || 'model'}_${shotType}_v${newVersion}.png`;
    const newUrl = await uploadGeneratedImage(jobName, filename, composited);

    // Push old version into previousVersions
    const previousVersions = Array.isArray(shot.previousVersions)
      ? [...shot.previousVersions]
      : [];
    previousVersions.push({
      imageUrl: shot.imageUrl,
      version: prevVersion,
      createdAt: shot.updatedAt || new Date(),
    });

    await shotsCol.doc(id).update({
      imageUrl: newUrl,
      version: newVersion,
      previousVersions,
      status: 'done',
      updatedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      shotId: id,
      imageUrl: newUrl,
      version: newVersion,
      dimensions: { width: imgW, height: imgH },
      pixelCorners,
      wovenLabelFile,
    });
  } catch (err) {
    console.error(`[ApplyPocketLabel] shot=${shotId} failed:`, err);
    return NextResponse.json(
      { error: 'apply-pocket-label failed', details: String(err) },
      { status: 500 },
    );
  }
}
