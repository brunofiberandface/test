/**
 * POST /api/admin/backfill-top-descriptions
 *
 * One-off endpoint: runs Claude Opus top description analysis for all
 * wardrobe items in the 'top' category that don't yet have a cached
 * topDescription. Processes sequentially to avoid rate-limit pressure.
 */
import { NextResponse } from 'next/server';
import { wardrobeCol } from '@/lib/firestore';
import { runTopDescriptionForWardrobe } from '@/lib/pipeline/top-description';

export async function POST() {
  const snap = await wardrobeCol.get();
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

  // Only process tops that don't have a cached description
  const candidates = items.filter(i => {
    const cat = (i.category || '').toLowerCase();
    const isTop = cat === 'top' || cat === 'shirt' || cat === 'tee';
    const hasCached = !!i.topDescription;
    const hasImage = !!(i.flatFrontUrl || i.fitModels?.front);
    return isTop && !hasCached && hasImage;
  });

  console.log(`[BackfillTopDesc] Found ${candidates.length} tops needing description (${items.filter(i => ['top','shirt','tee'].includes((i.category||'').toLowerCase())).length} total tops)`);

  const results: Array<{ id: string; name: string; status: string; description?: string }> = [];

  for (const item of candidates) {
    try {
      const desc = await runTopDescriptionForWardrobe(item.id);
      results.push({ id: item.id, name: item.name, status: 'ok', description: desc });
    } catch (err: any) {
      console.error(`[BackfillTopDesc] Failed for ${item.name}:`, err.message);
      results.push({ id: item.id, name: item.name, status: 'error' });
    }
  }

  return NextResponse.json({
    processed: results.length,
    ok: results.filter(r => r.status === 'ok').length,
    failed: results.filter(r => r.status === 'error').length,
    results,
  });
}
