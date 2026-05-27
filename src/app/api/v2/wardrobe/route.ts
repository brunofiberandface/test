/**
 * GET /api/v2/wardrobe
 *
 * Returns wardrobe items with their classification coerced (unclassified
 * items default to NOOS · Legacy) + sidebar counts (per drop + per NOOS
 * sub-bucket) so the v2 wardrobe page can render the tree and the grid
 * from a single round-trip.
 *
 * Query params:
 *   classification = 'drop' | 'noos'   — filter by top-level
 *   dropKey        = '2026-Q3-4'       — filter to one drop (year-Qq-N)
 *   noosBucket     = 'denim' | 'tops' | 'outerwear' | 'legacy'
 *   category       = 'top' | 'bottom' | 'shoe' | ...
 *
 * The full counts (across the whole wardrobe) are ALWAYS returned so the
 * sidebar can show totals regardless of the active filter.
 *
 * 2026-05-27 (Phase 2 Slice 2B of dashboard redesign).
 */
import { NextRequest, NextResponse } from 'next/server';
import { wardrobeCol } from '@/lib/firestore';
import {
  coerceClassification,
  dropKey as fmtDropKey,
  type V2NoosBucket,
} from '@/lib/v2/wardrobe-classification';

interface WardrobeListItem {
  wardrobeId: string;
  name: string;
  designNumber?: string;
  category?: string;
  gender?: string;
  thumbnailUrl?: string;
  fitModelThumbs: string[]; // up to 4 short urls for the 2x2 grid
  classification: 'drop' | 'noos';
  drop?: { year: number; quarter: number; dropNumber: number };
  noosBucket?: V2NoosBucket;
}

interface DropCount {
  year: number;
  quarter: number;
  dropNumber: number;
  count: number;
}

interface SidebarCounts {
  drops: DropCount[];
  noosByBucket: Record<V2NoosBucket, number>;
  noosTotal: number;
  dropTotal: number;
  total: number;
}

function pickFitThumbs(item: any): string[] {
  // Fit-model angle thumbnails for the 2x2 mosaic. Falls back to flats
  // when fit angles are missing so legacy items still show something.
  const fm = item.fitModels || {};
  const ordered = [
    fm.front, fm.back, fm.leftSide || fm.left, fm.rightSide || fm.right,
    fm.frontDetail, fm.backDetail,
  ].filter((u): u is string => typeof u === 'string' && u.length > 0);
  if (ordered.length >= 4) return ordered.slice(0, 4);
  const flats = [item.flatFrontUrl, item.flatBackUrl, item.thumbnailUrl].filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
  return [...ordered, ...flats].slice(0, 4);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fClassification = searchParams.get('classification') as 'drop' | 'noos' | null;
    const fDropKey = searchParams.get('dropKey');
    const fNoos = searchParams.get('noosBucket') as V2NoosBucket | null;
    const fCategory = searchParams.get('category');

    const snap = await wardrobeCol.get();
    const allItems = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

    // Build sidebar counts off the FULL set first (filter-independent).
    const counts: SidebarCounts = {
      drops: [],
      noosByBucket: { denim: 0, tops: 0, outerwear: 0, legacy: 0 },
      noosTotal: 0,
      dropTotal: 0,
      total: allItems.length,
    };
    const dropMap = new Map<string, DropCount>();
    for (const it of allItems) {
      const c = coerceClassification(it);
      if (c.classification === 'drop' && c.drop) {
        counts.dropTotal++;
        const k = fmtDropKey(c.drop);
        const existing = dropMap.get(k);
        if (existing) existing.count++;
        else dropMap.set(k, { ...c.drop, count: 1 });
      } else if (c.classification === 'noos' && c.noosBucket) {
        counts.noosTotal++;
        counts.noosByBucket[c.noosBucket]++;
      }
    }
    counts.drops = Array.from(dropMap.values()).sort(
      (a, b) =>
        b.year - a.year ||                       // newest year first
        b.quarter - a.quarter ||                 // newest quarter first
        b.dropNumber - a.dropNumber,             // newest drop first
    );

    // Now filter the items themselves per the query.
    const filtered: WardrobeListItem[] = [];
    for (const it of allItems) {
      const c = coerceClassification(it);
      if (fClassification && c.classification !== fClassification) continue;
      if (fNoos && (c.classification !== 'noos' || c.noosBucket !== fNoos)) continue;
      if (fDropKey && (c.classification !== 'drop' || !c.drop || fmtDropKey(c.drop) !== fDropKey)) continue;
      if (fCategory && (it.category || '').toLowerCase() !== fCategory.toLowerCase()) continue;

      filtered.push({
        wardrobeId: it.id,
        name: it.name || '—',
        designNumber: it.designNumber,
        category: it.category,
        gender: it.gender,
        thumbnailUrl: it.thumbnailUrl || it.flatFrontUrl,
        fitModelThumbs: pickFitThumbs(it),
        classification: c.classification,
        drop: c.drop,
        noosBucket: c.noosBucket,
      });
    }

    // Stable order: by createdAt asc when present, else by id.
    filtered.sort((a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0));

    return NextResponse.json({ counts, items: filtered });
  } catch (error) {
    console.error('[v2 wardrobe] failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
