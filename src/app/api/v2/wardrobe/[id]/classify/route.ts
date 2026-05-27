/**
 * POST /api/v2/wardrobe/[id]/classify
 *
 * Sets (or changes) the classification on a wardrobe item.
 *
 * Body (one of):
 *   { classification: 'drop', drop: { year, quarter, dropNumber } }
 *   { classification: 'noos' }
 *
 * Drop ↔ NOOS migration IS allowed at the API layer (the Phase 2 spec
 * disallows it as a *concept* — separate SKUs — but during the
 * reclassify period the user may need to correct a mis-tagged Legacy
 * item). The UI gates the flow per Bruno's rules; the API stays simple.
 *
 * On success, writes:
 *   - classification
 *   - drop OR clears drop (if switching to NOOS)
 *   - classifiedAt (ISO timestamp)
 *   - classifiedBy (user email if available, else 'unknown')
 *   - noosBucket cleared when switching to drop (kept harmless otherwise)
 *
 * Returns: { ok: true, classification, drop?, classifiedAt }
 *
 * 2026-05-27 (Phase 2 Slice 2C-classify of dashboard redesign).
 */
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from '@google-cloud/firestore';
import { getServerSession } from 'next-auth';
import { wardrobeCol } from '@/lib/firestore';
import { validateClassification } from '@/lib/v2/wardrobe-classification';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    // Build a normalised payload before validation so spurious extra
    // fields don't trip the validator.
    const input: any = { classification: body.classification };
    if (input.classification === 'drop') {
      input.drop = body.drop;
    } else if (input.classification === 'noos') {
      // noosBucket not collected from the form — sidebar derives from
      // category. Don't accept it from the client either.
    }

    try {
      validateClassification(input);
    } catch (vErr) {
      return NextResponse.json(
        { error: vErr instanceof Error ? vErr.message : String(vErr) },
        { status: 400 },
      );
    }

    const snap = await wardrobeCol.doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Wardrobe item not found' }, { status: 404 });
    }

    // Who's making the change.
    let actor = 'unknown';
    try {
      const session = await getServerSession();
      actor = session?.user?.email || 'unknown';
    } catch { /* non-blocking; auth pattern varies across routes */ }

    const now = new Date().toISOString();
    const update: Record<string, any> = {
      classification: input.classification,
      classifiedAt: now,
      classifiedBy: actor,
      updatedAt: new Date(),
    };
    if (input.classification === 'drop') {
      update.drop = input.drop;
      // Clear noosBucket so a coerce-defaulter doesn't think this is
      // ambiguous later.
      update.noosBucket = FieldValue.delete();
    } else {
      // classification === 'noos'
      update.drop = FieldValue.delete();
      // Keep noosBucket alone — Phase 2A migration set it to 'legacy';
      // we leave it as-is in case any back-compat reader still uses it.
    }

    await wardrobeCol.doc(id).update(update);

    return NextResponse.json({
      ok: true,
      classification: input.classification,
      drop: input.classification === 'drop' ? input.drop : undefined,
      classifiedAt: now,
      classifiedBy: actor,
    });
  } catch (error) {
    console.error('[v2 wardrobe classify] failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
