/**
 * POST /api/qa/shoe-matrix/render
 * Body: { shoeId: string, modelId: string }
 *
 * Renders one (model, shoe) cell synchronously. Takes ~40s — single Seedream
 * call. Caller should expect to wait, OR fire with a long timeout and poll
 * the cell doc for status.
 *
 * On success: returns the rendered cell record.
 * On failure: cell doc is marked status='failed' with errorMessage; route
 *             returns 500 with the error.
 */
import { NextRequest, NextResponse } from 'next/server';
import { renderMatrixCell } from '@/lib/qa/shoe-matrix';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { shoeId?: string; modelId?: string };
    const { shoeId, modelId } = body;
    if (!shoeId || !modelId) {
      return NextResponse.json({ error: 'shoeId and modelId required' }, { status: 400 });
    }
    const cell = await renderMatrixCell(shoeId, modelId);
    return NextResponse.json({ cell });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ShoeMatrix render]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
