/**
 * GET /api/v2/wardrobe
 *
 * Returns wardrobe items + sidebar counts.
 *
 * Sidebar structure:
 *   - drops    : Year → Quarter → Drop tree (derived from item.drop)
 *   - noos     : NOOS sub-buckets derived from item.category (Bottoms /
 *                Tops / Shoes / … — populated from the actual category
 *                values present in NOOS items, not from a fixed enum)
 *   - genders  : { male, female, … } counts so the page can render filter
 *                chips with live counts
 *
 * Each item carries four named thumbnail URLs in a fixed order so the
 * UI doesn't have to do its own picking:
 *   flatFrontUrl    : product flat-front image
 *   fitFrontUrl     : model fit, straight front
 *   fitBackUrl      : model fit, straight back
 *   fitBack45RightUrl : model fit, 45° rotated right from back
 *
 * Query params:
 *   classification=drop|noos
 *   dropKey=2026-Q3-4
 *   category=top|bottom|shoes|…
 *   gender=male|female
 *
 * Counts are computed off the full wardrobe (NOT filtered) so the
 * sidebar numbers stay stable as the user filters the grid.
 *
 * 2026-05-27 (Phase 2 Slice 2B hotfix of dashboard redesign).
 */
import { NextRequest, NextResponse } from 'next/server';
import { wardrobeCol } from '@/lib/firestore';
import {
  coerceClassification,
  dropKey as fmtDropKey,
} from '@/lib/v2/wardrobe-classification';

export interface WardrobeListItem {
  wardrobeId: string;
  name: string;
  designNumber?: string;
  category?: string;
  gender?: string;
  flatFrontUrl?: string;
  fitFrontUrl?: string;
  fitBackUrl?: string;
  fitBack45RightUrl?: string;
  classification: 'drop' | 'noos';
  drop?: { year: number; quarter: number; dropNumber: number };
  noosBucket?: string;
}

interface DropCount {
  year: number;
  quarter: number;
  dropNumber: number;
  count: number;
}

interface CategoryBucket {
  key: string;    // canonical category id from item.category, lowercased
  label: string;  // user-facing
  count: number;
}

interface SidebarCounts {
  drops: DropCount[];
  noosCategoryBuckets: CategoryBucket[];
  noosTotal: number;
  dropTotal: number;
  total: number;
  genderCounts: Record<string, number>;
}

const CATEGORY_LABELS: Record<string, string> = {
  top:     'Tops',
  bottom:  'Bottoms',
  shoes:   'Shoes',
  shoe:    'Shoes',     // tolerate either singular / plural in data
  shirt:   'Shirts',
  jacket:  'Jackets',
  pants:   'Pants',
};

function labelForCategory(cat: string): string {
  return CATEGORY_LABELS[cat.toLowerCase()] || (cat.charAt(0).toUpperCase() + cat.slice(1));
}

function pickThumbUrls(item: any): {
  flatFrontUrl?: string;
  fitFrontUrl?: string;
  fitBackUrl?: string;
  fitBack45RightUrl?: string;
} {
  const fm = item.fitModels || {};
  return {
    // Flat front from product photos; fall back to thumbnailUrl.
    flatFrontUrl: item.flatFrontUrl || item.thumbnailUrl,
    fitFrontUrl: fm.front,
    fitBackUrl: fm.back,
    // Bruno explicitly asked for the 45° right back angle; fall back to
    // the 45° right front if back-right isn't shot.
    fitBack45RightUrl: fm.back45Right || fm.front45Right,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fClassification = searchParams.get('classification') as 'drop' | 'noos' | null;
    const fDropKey = searchParams.get('dropKey');
    const fCategory = searchParams.get('category');
    const fGender = searchParams.get('gender');

    const snap = await wardrobeCol.get();
    const allItems = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

    // Sidebar counts off the FULL set.
    const dropMap = new Map<string, DropCount>();
    const noosCategoryMap = new Map<string, number>();
    const genderCounts: Record<string, number> = {};
    let noosTotal = 0;
    let dropTotal = 0;

    for (const it of allItems) {
      const c = coerceClassification(it);
      if (c.classification === 'drop' && c.drop) {
        dropTotal++;
        const k = fmtDropKey(c.drop);
        const existing = dropMap.get(k);
        if (existing) existing.count++;
        else dropMap.set(k, { ...c.drop, count: 1 });
      } else if (c.classification === 'noos') {
        noosTotal++;
        const cat = (it.category || 'uncategorized').toLowerCase();
        noosCategoryMap.set(cat, (noosCategoryMap.get(cat) || 0) + 1);
      }
      const g = (it.gender || 'unspecified').toLowerCase();
      genderCounts[g] = (genderCounts[g] || 0) + 1;
    }

    const counts: SidebarCounts = {
      drops: Array.from(dropMap.values()).sort(
        (a, b) => b.year - a.year || b.quarter - a.quarter || b.dropNumber - a.dropNumber,
      ),
      noosCategoryBuckets: Array.from(noosCategoryMap.entries())
        .map(([key, count]): CategoryBucket => ({ key, label: labelForCategory(key), count }))
        // Most-populated first; tie-break alphabetical.
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      noosTotal,
      dropTotal,
      total: allItems.length,
      genderCounts,
    };

    // Filter the items per the query.
    const filtered: WardrobeListItem[] = [];
    for (const it of allItems) {
      const c = coerceClassification(it);
      if (fClassification && c.classification !== fClassification) continue;
      if (fDropKey && (c.classification !== 'drop' || !c.drop || fmtDropKey(c.drop) !== fDropKey)) continue;
      if (fCategory) {
        const a = (it.category || '').toLowerCase();
        const b = fCategory.toLowerCase();
        if (a !== b) continue;
      }
      if (fGender) {
        const a = (it.gender || '').toLowerCase();
        const b = fGender.toLowerCase();
        if (a !== b) continue;
      }

      const thumbs = pickThumbUrls(it);
      filtered.push({
        wardrobeId: it.id,
        name: it.name || '—',
        designNumber: it.designNumber,
        category: it.category,
        gender: it.gender,
        ...thumbs,
        classification: c.classification,
        drop: c.drop,
        noosBucket: c.noosBucket,
      });
    }

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
