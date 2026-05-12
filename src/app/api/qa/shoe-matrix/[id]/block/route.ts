/**
 * PATCH /api/qa/shoe-matrix/{cellId}/block
 * Body: { blocked: boolean, reason?: string }
 *
 * Cell id format: `${shoeId}_${modelId}`. Marks (model, shoe) combo as
 * blocked or unblocked. Job-creation wizard reads this to warn before
 * pairing a blocked combo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { setBlocked } from '@/lib/qa/shoe-matrix';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sep = id.lastIndexOf('_');
    if (sep < 1) {
      return NextResponse.json({ error: `bad cell id ${id} — expected shoeId_modelId` }, { status: 400 });
    }
    const shoeId = id.substring(0, sep);
    const modelId = id.substring(sep + 1);

    const body = await req.json() as { blocked?: boolean; reason?: string };
    if (typeof body.blocked !== 'boolean') {
      return NextResponse.json({ error: 'blocked (boolean) required' }, { status: 400 });
    }
    await setBlocked(shoeId, modelId, body.blocked, body.reason);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ShoeMatrix block]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
