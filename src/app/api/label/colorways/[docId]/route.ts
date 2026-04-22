/**
 * GET  /api/label/colorways/[docId]              → { colorway }
 * PUT  /api/label/colorways/[docId]  { colorway } → { ok: true }
 *
 * docId = `${styleCode}_${colorwayCode}` (e.g. "D22889_D933")
 * Tier 3 of the three-tier hybrid-label schema: color + grain + emboss only.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getLabelColorway,
  upsertLabelColorway,
} from '@/lib/firestore';
import type { LabelColorway, GrainVariant, ColorRGB } from '@/types';

const VALID_GRAIN: GrainVariant[] = ['pebbled', 'smooth', 'coarse'];

function parseDocId(docId: string): { styleCode: string; colorwayCode: string } | null {
  const m = docId.match(/^([^_]+)_(.+)$/);
  if (!m) return null;
  return { styleCode: m[1], colorwayCode: m[2] };
}

function isColor(c: unknown): c is ColorRGB {
  return (
    !!c &&
    typeof (c as ColorRGB).r === 'number' &&
    typeof (c as ColorRGB).g === 'number' &&
    typeof (c as ColorRGB).b === 'number' &&
    typeof (c as ColorRGB).hex === 'string'
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ docId: string }> },
) {
  try {
    const { docId } = await params;
    const parsed = parseDocId(docId);
    if (!parsed) {
      return NextResponse.json(
        { error: 'docId must be styleCode_colorwayCode' },
        { status: 400 },
      );
    }
    const colorway = await getLabelColorway(parsed.styleCode, parsed.colorwayCode);
    if (!colorway) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ colorway });
  } catch (err: unknown) {
    console.error('[LabelColorway GET]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> },
) {
  try {
    const { docId } = await params;
    const parsed = parseDocId(docId);
    if (!parsed) {
      return NextResponse.json(
        { error: 'docId must be styleCode_colorwayCode' },
        { status: 400 },
      );
    }
    const body = await req.json();
    const c = body?.colorway;
    if (
      !c ||
      !isColor(c.baseColor) ||
      typeof c.embossStrength !== 'number' ||
      !VALID_GRAIN.includes(c.grainVariant) ||
      typeof c.updatedBy !== 'string'
    ) {
      return NextResponse.json(
        {
          error:
            'body.colorway must have { baseColor{r,g,b,hex}, embossStrength, grainVariant, updatedBy, colorwayName?, stitchColor?, sampledFromPhoto? }',
        },
        { status: 400 },
      );
    }
    const toSave: Omit<LabelColorway, 'updatedAt'> = {
      styleCode: parsed.styleCode,
      colorwayCode: parsed.colorwayCode,
      colorwayName: c.colorwayName,
      baseColor: c.baseColor,
      stitchColor: isColor(c.stitchColor) ? c.stitchColor : undefined,
      embossStrength: c.embossStrength,
      grainVariant: c.grainVariant,
      sampledFromPhoto: c.sampledFromPhoto,
      updatedBy: c.updatedBy,
    };
    await upsertLabelColorway(toSave);
    return NextResponse.json({
      ok: true,
      styleCode: parsed.styleCode,
      colorwayCode: parsed.colorwayCode,
    });
  } catch (err: unknown) {
    console.error('[LabelColorway PUT]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const POST = PUT;
