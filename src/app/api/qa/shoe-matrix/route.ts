/**
 * GET /api/qa/shoe-matrix?shoeId=<id>
 * Returns all matrix cells for a given shoe (one row of the matrix). Cells
 * are keyed by `${shoeId}_${modelId}` and include status, blocked, imageUrl.
 *
 * Combos that haven't been rendered yet are absent from the result — the UI
 * fills them in as "not rendered" placeholders by cross-referencing /api/models.
 */
import { NextRequest, NextResponse } from 'next/server';
import { listCellsForShoe } from '@/lib/qa/shoe-matrix';

export async function GET(req: NextRequest) {
  try {
    const shoeId = req.nextUrl.searchParams.get('shoeId');
    if (!shoeId) {
      return NextResponse.json({ error: 'shoeId required' }, { status: 400 });
    }
    const cells = await listCellsForShoe(shoeId);
    return NextResponse.json({ cells });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ShoeMatrix list]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
