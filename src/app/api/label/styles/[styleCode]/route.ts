/**
 * GET  /api/label/styles/[styleCode]              → { style }
 * PUT  /api/label/styles/[styleCode]  { style }    → { ok: true }
 *
 * Tier 2 of the three-tier hybrid-label schema.
 * Holds the labelCorners + pocketCorners + anchorPhoto once per styleCode,
 * shared across all colorways of that style.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getLabelStyle, upsertLabelStyle } from '@/lib/firestore';
import type { Point2D, LabelStyle } from '@/types';

function isQuad(q: unknown): q is [Point2D, Point2D, Point2D, Point2D] {
  if (!Array.isArray(q) || q.length !== 4) return false;
  for (const p of q) {
    if (
      !p ||
      typeof (p as Point2D).x !== 'number' ||
      typeof (p as Point2D).y !== 'number'
    )
      return false;
  }
  return true;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ styleCode: string }> },
) {
  try {
    const { styleCode } = await params;
    const style = await getLabelStyle(styleCode);
    if (!style) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ style });
  } catch (err: unknown) {
    console.error('[LabelStyle GET]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ styleCode: string }> },
) {
  try {
    const { styleCode } = await params;
    const body = await req.json();
    const s = body?.style;
    if (
      !s ||
      typeof s.templateId !== 'string' ||
      !s.anchorPhoto ||
      typeof s.anchorPhoto.url !== 'string' ||
      typeof s.anchorPhoto.width !== 'number' ||
      typeof s.anchorPhoto.height !== 'number' ||
      typeof s.updatedBy !== 'string' ||
      !isQuad(s.labelCorners) ||
      !isQuad(s.pocketCorners)
    ) {
      return NextResponse.json(
        {
          error:
            'body.style must have { templateId, anchorPhoto{wardrobeItemId,photoKey,url,width,height}, labelCorners[4], pocketCorners[4], updatedBy }',
        },
        { status: 400 },
      );
    }
    const toSave: Omit<LabelStyle, 'updatedAt'> = {
      styleCode,
      templateId: s.templateId,
      anchorPhoto: s.anchorPhoto,
      labelCorners: s.labelCorners,
      pocketCorners: s.pocketCorners,
      updatedBy: s.updatedBy,
    };
    await upsertLabelStyle(toSave);
    return NextResponse.json({ ok: true, styleCode });
  } catch (err: unknown) {
    console.error('[LabelStyle PUT]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// Convenience alias — the POC sends POST; real client uses PUT
export const POST = PUT;
