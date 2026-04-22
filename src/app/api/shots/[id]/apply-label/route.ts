/**
 * POST /api/shots/[id]/apply-label
 *
 * Manual per-shot label remap.
 *
 * Body (one of):
 *   {
 *     // Preferred (v3 — direct label corners, three-tier render config):
 *     labelCorners: { tl: [nx, ny], tr, br, bl }   // normalized 0..1
 *   }
 *   {
 *     // Deprecated (v2 — pocket→label homography), kept for back-compat:
 *     pocketCorners: { tl, tr, br, bl }            // normalized 0..1
 *   }
 *   {
 *     // Legacy (v1 — direct label corners using focusItem.labelConfig):
 *     corners:       { tl, tr, br, bl }            // normalized 0..1
 *   }
 *
 * Flow (v3, preferred):
 *   1. Load shot + job + focus wardrobe item
 *   2. Parse designNumber → styleCode/colorwayCode
 *   3. Resolve three-tier LabelRenderConfig (template + style + colorway)
 *   4. Download current shot image
 *   5. Convert caller's labelCorners → pixel space
 *   6. applyHybridLabel(image, pixelCorners, renderConfigToHybridConfig(renderConfig))
 *   7. Upload new version, push old into previousVersions
 *
 * No homography. No wardrobe anchor lookup. What the user drags is exactly
 * where the label gets warped. One source of truth.
 *
 * The auto pipeline (label-auto.ts) is hard-disabled — every M02/M04 ships
 * blank and the user clicks "Map label manually" on the shot detail to land
 * the label via the v3 flow above.
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import {
  shotsCol,
  getJob,
  getWardrobeItem,
  resolveLabelRenderConfig,
} from '@/lib/firestore';
import {
  uploadGeneratedImage,
  downloadGarmentImage,
} from '@/lib/gcs';
import {
  applyHybridLabel,
  applyWovenLabel,
  type LabelCorners,
  type LabelHybridConfig,
  type PocketLabelCorners,
} from '@/lib/label-hybrid';
import {
  renderConfigToHybridConfig,
  projectLabelCornersViaHomography,
} from '@/lib/label-render';
import { styleAndColorwayOf } from '@/lib/design-number';
import type { Point2D } from '@/types';

interface NormalizedCorner {
  0: number;
  1: number;
}
interface NormalizedCorners {
  tl: NormalizedCorner;
  tr: NormalizedCorner;
  br: NormalizedCorner;
  bl: NormalizedCorner;
}

/** Optional secondary midpoints, one per edge. If absent on the wire, the
 *  composite falls through to the classic 4-point path (byte-identical to
 *  the pre-midpoint pipeline). If present, the backend forwards them to the
 *  Python shader which switches to an 8-point sub-quadrant warp. */
interface OptionalMidpoints {
  tm?: NormalizedCorner;
  rm?: NormalizedCorner;
  bm?: NormalizedCorner;
  lm?: NormalizedCorner;
}

function parseCorners(raw: unknown, fieldName: string): NormalizedCorners {
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
      x < 0 ||
      x > 1 ||
      y < 0 ||
      y > 1
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

function parseOptionalMidpoints(
  raw: unknown,
  fieldName: string,
): OptionalMidpoints {
  if (!raw || typeof raw !== 'object') return {};
  const c = raw as Record<string, unknown>;
  const out: OptionalMidpoints = {};
  const maybe = (name: 'tm' | 'rm' | 'bm' | 'lm') => {
    const v = c[name];
    if (v === undefined || v === null) return;
    if (!Array.isArray(v) || v.length !== 2) {
      throw new Error(`${fieldName}.${name} must be [x, y] or absent`);
    }
    const [x, y] = v;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      x > 1 ||
      y < 0 ||
      y > 1
    ) {
      throw new Error(
        `${fieldName}.${name} must be finite numbers in [0, 1] (got ${x}, ${y})`,
      );
    }
    out[name] = [x, y] as unknown as NormalizedCorner;
  };
  maybe('tm');
  maybe('rm');
  maybe('bm');
  maybe('lm');
  return out;
}

function normalizedToPoint2DQuad(
  n: NormalizedCorners,
  w: number,
  h: number,
): [Point2D, Point2D, Point2D, Point2D] {
  const toP = (p: NormalizedCorner): Point2D => ({
    x: Math.round(p[0] * w),
    y: Math.round(p[1] * h),
  });
  return [toP(n.tl), toP(n.tr), toP(n.br), toP(n.bl)];
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
    const hasLabelPath = !!body?.labelCorners;
    const hasPocketPath = !!body?.pocketCorners;
    const hasLegacyPath = !!body?.corners;
    if (!hasLabelPath && !hasPocketPath && !hasLegacyPath) {
      return NextResponse.json(
        {
          error:
            'body must contain labelCorners (preferred), pocketCorners (v2 back-compat), or corners (v1 legacy)',
        },
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
    if (shotType !== 'M02' && shotType !== 'M04') {
      return NextResponse.json(
        { error: `Label apply only supported for M02 and M04, not ${shotType}` },
        { status: 400 },
      );
    }
    if (!shot.imageUrl) {
      return NextResponse.json(
        { error: 'Shot has no imageUrl' },
        { status: 400 },
      );
    }

    // ── 2. Load job + focus wardrobe
    const job = (await getJob(shot.jobId)) as any;
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    const focusSlot = Object.entries(job.wardrobe || {}).find(
      ([, v]: [string, any]) => v?.isFocus,
    ) as [string, any] | undefined;
    if (!focusSlot) {
      return NextResponse.json(
        { error: 'No focus wardrobe item on job' },
        { status: 400 },
      );
    }
    const focusItem = (await getWardrobeItem(focusSlot[1].itemId)) as any;
    if (!focusItem) {
      return NextResponse.json(
        { error: 'Focus wardrobe item not found' },
        { status: 404 },
      );
    }

    // ── 3. Download current shot image
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

    // ── 4. Build the LabelHybridConfig + pixel label corners.
    //      Three paths, diverging only in how we determine the label corners
    //      in output-image pixel space.
    let hybridConfig: LabelHybridConfig;
    let pixelCorners: LabelCorners;
    let pathUsed:
      | 'v3-direct-label'
      | 'v3-direct-label-8pt'
      | 'v2-pocket-homography'
      | 'v1-direct-label';

    if (hasLabelPath) {
      // ── v3 path: direct label corners, three-tier render config ──

      const codes = styleAndColorwayOf(focusItem.designNumber);
      if (!codes) {
        return NextResponse.json(
          {
            error: `Focus garment designNumber "${focusItem.designNumber}" cannot be parsed to styleCode/colorwayCode — fix the wardrobe record`,
          },
          { status: 400 },
        );
      }
      const renderConfig = await resolveLabelRenderConfig(
        codes.styleCode,
        codes.colorwayCode,
      );
      if (!renderConfig) {
        return NextResponse.json(
          {
            error: `No three-tier label config for ${codes.styleCode}/${codes.colorwayCode}. Run label-setup on the wardrobe item first.`,
          },
          { status: 400 },
        );
      }

      const normalizedLabel = parseCorners(body.labelCorners, 'labelCorners');
      const normalizedMids = parseOptionalMidpoints(
        body.labelCorners,
        'labelCorners',
      );
      const toPx = (p: NormalizedCorner): [number, number] => [
        Math.round(p[0] * imgW),
        Math.round(p[1] * imgH),
      ];
      pixelCorners = {
        tl: toPx(normalizedLabel.tl),
        tr: toPx(normalizedLabel.tr),
        br: toPx(normalizedLabel.br),
        bl: toPx(normalizedLabel.bl),
      };
      const hasAnyMid = !!(
        normalizedMids.tm ||
        normalizedMids.rm ||
        normalizedMids.bm ||
        normalizedMids.lm
      );
      if (hasAnyMid) {
        if (normalizedMids.tm) pixelCorners.tm = toPx(normalizedMids.tm);
        if (normalizedMids.rm) pixelCorners.rm = toPx(normalizedMids.rm);
        if (normalizedMids.bm) pixelCorners.bm = toPx(normalizedMids.bm);
        if (normalizedMids.lm) pixelCorners.lm = toPx(normalizedMids.lm);
      }
      hybridConfig = renderConfigToHybridConfig(renderConfig);
      pathUsed = hasAnyMid ? 'v3-direct-label-8pt' : 'v3-direct-label';

      console.log(
        `[ApplyLabel ${pathUsed}] shot=${id} type=${shotType} size=${imgW}x${imgH} ` +
          `style=${codes.styleCode}/${codes.colorwayCode} ` +
          `label=${JSON.stringify(pixelCorners)}`,
      );
    } else if (hasPocketPath) {
      // ── v2 path: homography from wardrobe-pocket → output-pocket, warp label ──

      // Resolve 3-tier render config from the wardrobe item's designNumber
      const codes = styleAndColorwayOf(focusItem.designNumber);
      if (!codes) {
        return NextResponse.json(
          {
            error: `Focus garment designNumber "${focusItem.designNumber}" cannot be parsed to styleCode/colorwayCode — fix the wardrobe record or use legacy 'corners' body`,
          },
          { status: 400 },
        );
      }
      const renderConfig = await resolveLabelRenderConfig(
        codes.styleCode,
        codes.colorwayCode,
      );
      if (!renderConfig) {
        return NextResponse.json(
          {
            error: `No three-tier label config for ${codes.styleCode}/${codes.colorwayCode}. Run label-setup on the wardrobe item first.`,
          },
          { status: 400 },
        );
      }

      // Parse caller's pocketCorners (normalized 0..1 on the output image)
      const normalizedPocket = parseCorners(body.pocketCorners, 'pocketCorners');
      const outputPocketPx = normalizedToPoint2DQuad(
        normalizedPocket,
        imgW,
        imgH,
      );

      // Compute homography: wardrobe anchor-pocket → output-pocket, warp label through it
      const projected = projectLabelCornersViaHomography(
        renderConfig.labelCorners,
        renderConfig.pocketCorners,
        outputPocketPx,
      );
      if (!projected) {
        return NextResponse.json(
          {
            error:
              'Homography failed (degenerate pocket quad?). Re-drag the 4 pocket corners so they form a clearly non-colinear quadrilateral.',
          },
          { status: 400 },
        );
      }
      pixelCorners = projected;
      hybridConfig = renderConfigToHybridConfig(renderConfig);
      pathUsed = 'v2-pocket-homography';

      console.log(
        `[ApplyLabel v2] shot=${id} type=${shotType} size=${imgW}x${imgH} ` +
          `style=${codes.styleCode}/${codes.colorwayCode} ` +
          `pocketDst=${JSON.stringify(outputPocketPx)} ` +
          `label=${JSON.stringify(pixelCorners)}`,
      );
    } else {
      // ── v1 legacy path: caller gives label corners directly ──
      const legacyCfg: LabelHybridConfig | undefined = focusItem?.labelConfig;
      if (!legacyCfg?.enabled) {
        return NextResponse.json(
          {
            error:
              'Legacy labelConfig path requested but focus garment has no labelConfig.enabled. Use pocketCorners (v2) instead.',
          },
          { status: 400 },
        );
      }
      hybridConfig = legacyCfg;
      const normalizedLabel = parseCorners(body.corners, 'corners');
      const toPx = (p: NormalizedCorner): [number, number] => [
        Math.round(p[0] * imgW),
        Math.round(p[1] * imgH),
      ];
      pixelCorners = {
        tl: toPx(normalizedLabel.tl),
        tr: toPx(normalizedLabel.tr),
        br: toPx(normalizedLabel.br),
        bl: toPx(normalizedLabel.bl),
      };
      pathUsed = 'v1-direct-label';
      console.log(
        `[ApplyLabel v1] shot=${id} type=${shotType} size=${imgW}x${imgH} ` +
          `label=${JSON.stringify(pixelCorners)}`,
      );
    }

    // ── 5. Run the leather label composite
    let composited = await applyHybridLabel(
      sourceBuffer,
      pixelCorners,
      hybridConfig,
    );

    // ── 5b. Optional: pocket label (woven Originals patch) in same pass
    if (body?.pocketLabelCorners) {
      const pocketNorm = parseCorners(body.pocketLabelCorners, 'pocketLabelCorners');
      const toPxPocket = (p: NormalizedCorner): [number, number] => [
        Math.round(p[0] * imgW),
        Math.round(p[1] * imgH),
      ];
      const pocketPixels: PocketLabelCorners = {
        tl: toPxPocket(pocketNorm.tl),
        tr: toPxPocket(pocketNorm.tr),
        br: toPxPocket(pocketNorm.br),
        bl: toPxPocket(pocketNorm.bl),
      };
      const wovenFile = body.wovenLabelFile || 'originals-label-gold-woven.png';
      console.log(`[ApplyLabel] also applying pocket label: ${wovenFile} corners=${JSON.stringify(pocketPixels)}`);
      composited = await applyWovenLabel(composited, pocketPixels, wovenFile);
    }

    // ── 6. Upload with new version number
    const prevVersion = shot.version || 1;
    const newVersion = prevVersion + 1;
    const jobName = job.jobName || job.jobId || shot.jobId;
    const filename = `${job.modelId}_${shotType}_v${newVersion}.png`;
    const newUrl = await uploadGeneratedImage(jobName, filename, composited);

    // ── 7. Push old version into previousVersions
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
      path: pathUsed,
    });
  } catch (err) {
    console.error(`[ApplyLabel] shot=${shotId} failed:`, err);
    return NextResponse.json(
      { error: 'apply-label failed', details: String(err) },
      { status: 500 },
    );
  }
}
