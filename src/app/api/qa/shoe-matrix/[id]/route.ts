/**
 * GET /api/qa/shoe-matrix/:id
 * Returns the cell payload + joined shoe + model context (name, card URL,
 * flat URL) so the detail page can render headers without extra fetches.
 */
import { NextResponse } from 'next/server';
import { getCellById } from '@/lib/qa/shoe-matrix';
import { getWardrobeItem, getModel } from '@/lib/firestore';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  try {
    const cell = await getCellById(id);
    if (!cell) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const [shoe, model] = await Promise.all([
      getWardrobeItem(cell.shoeId).catch(() => null),
      getModel(cell.modelId).catch(() => null),
    ]);

    type ShoeShape = { name?: string; flatFrontUrl?: string };
    type ModelShape = { name?: string; modelId?: string; cardImageUrl?: string; referenceImageUrl?: string };

    return NextResponse.json({
      ...cell,
      shoeName: (shoe as ShoeShape | null)?.name,
      shoeFlatUrl: (shoe as ShoeShape | null)?.flatFrontUrl,
      modelName: (model as ModelShape | null)?.name || (model as ModelShape | null)?.modelId,
      modelCardUrl: (model as ModelShape | null)?.cardImageUrl || (model as ModelShape | null)?.referenceImageUrl,
    });
  } catch (err) {
    console.error(`[shoe-matrix/${id}] GET failed:`, err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
