/**
 * POST /api/admin/backfill-silhouettes
 *
 * One-off endpoint: runs silhouette analysis (Claude Opus 4.6) for all
 * wardrobe items that don't yet have cached silhouettes.
 * Processes sequentially to avoid rate-limit pressure on Anthropic API.
 *
 * Returns summary of processed / skipped / failed items.
 */
import { NextResponse } from 'next/server';
import { wardrobeCol } from '@/lib/firestore';
import { runSilhouetteForWardrobe } from '@/lib/pipeline/silhouette';

export async function POST() {
  const snap = await wardrobeCol.get();
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

  // Only process bottom/pants/jeans that have fit models but no cached silhouette
  const candidates = items.filter(i => {
    const cat = (i.category || '').toLowerCase();
    const isBottoms = cat === 'bottom' || cat === 'pants' || cat === 'jeans';
    const hasFitModels = i.fitModels?.front || (Array.isArray(i.fitModelUrls) && i.fitModelUrls.length >= 6);
    const hasCached = i.silhouetteFront && i.silhouetteBack;
    return isBottoms && hasFitModels && !hasCached;
  });

  console.log(`[Backfill] ${candidates.length} items to process (${items.length} total, ${items.length - candidates.length} skipped)`);

  const results: Array<{ id: string; name: string; status: 'ok' | 'error'; error?: string; elapsedMs: number }> = [];

  for (const item of candidates) {
    const start = Date.now();
    try {
      await runSilhouetteForWardrobe(item.id);
      results.push({ id: item.id, name: item.name, status: 'ok', elapsedMs: Date.now() - start });
    } catch (err: any) {
      console.error(`[Backfill] Failed for ${item.name} (${item.id}):`, err.message);
      results.push({ id: item.id, name: item.name, status: 'error', error: err.message, elapsedMs: Date.now() - start });
    }
  }

  const ok = results.filter(r => r.status === 'ok').length;
  const failed = results.filter(r => r.status === 'error').length;

  return NextResponse.json({
    total: items.length,
    candidates: candidates.length,
    processed: ok,
    failed,
    results,
  });
}
