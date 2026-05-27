'use client';

/**
 * Step 2 — pick the focus garment.
 *
 * Items shown are filtered by the collection picked in step 1: a Drop
 * collection narrows to that drop's items; NOOS shows every NOOS item.
 * Category tabs (Bottoms / Tops / Shoes) further narrow if the user
 * wants to scan one slot at a time.
 *
 * 2026-05-27 (Phase 2 Slice 2D of dashboard redesign).
 */
import { useEffect, useMemo, useState } from 'react';
import PickerCard from './PickerCard';
import { dropKey as fmtDropKey, formatDrop } from '@/lib/v2/wardrobe-classification';
import type { CollectionPick, WardrobeItemRef } from './wizard-types';

export interface FocusItemPickerStepProps {
  collection: CollectionPick;
  value: WardrobeItemRef | null;
  onChange: (value: WardrobeItemRef) => void;
}

interface FeedResp {
  items: WardrobeItemRef[];
}

export default function FocusItemPickerStep({ collection, value, onChange }: FocusItemPickerStepProps) {
  const [items, setItems] = useState<WardrobeItemRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    const params = new URLSearchParams();
    if (collection.kind === 'drop') {
      params.set('dropKey', fmtDropKey({ year: collection.year, quarter: collection.quarter, dropNumber: collection.dropNumber }));
    } else {
      params.set('classification', 'noos');
    }
    fetch(`/api/v2/wardrobe?${params}`)
      .then(r => r.json())
      .then((j: FeedResp) => { if (!cancelled) setItems(j.items || []); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [collection]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const it of items ?? []) if (it.category) set.add(it.category.toLowerCase());
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    if (catFilter === 'all') return items;
    return items.filter(it => (it.category || '').toLowerCase() === catFilter);
  }, [items, catFilter]);

  const collectionLabel =
    collection.kind === 'drop'
      ? formatDrop({ year: collection.year, quarter: collection.quarter, dropNumber: collection.dropNumber })
      : 'NOOS';

  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-5">
      <div className="text-[15px] font-medium text-neutral-900 mb-1">Pick the focus garment</div>
      <div className="text-[12px] text-neutral-500 mb-4">
        Showing items in <span className="font-medium text-neutral-700">{collectionLabel}</span>
        {value && <> · selected <span className="font-medium text-neutral-700">{value.name}</span></>}
      </div>

      {categories.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <button
            type="button"
            onClick={() => setCatFilter('all')}
            className={`text-[11px] rounded-full px-2.5 py-1 transition-colors ${
              catFilter === 'all'
                ? 'bg-neutral-900 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            All <span className={catFilter === 'all' ? 'text-neutral-300' : 'text-neutral-400'}>{items?.length || 0}</span>
          </button>
          {categories.map(c => {
            const active = catFilter === c;
            const n = items?.filter(it => (it.category || '').toLowerCase() === c).length || 0;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCatFilter(c)}
                className={`text-[11px] rounded-full px-2.5 py-1 capitalize transition-colors ${
                  active
                    ? 'bg-neutral-900 text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                {c} <span className={active ? 'text-neutral-300' : 'text-neutral-400'}>{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-md p-3">
          Failed to load: {error}
        </div>
      )}
      {!items && !error && (
        <div className="text-sm text-neutral-400 py-12 text-center">Loading…</div>
      )}
      {items && filtered.length === 0 && !error && (
        <div className="text-sm text-neutral-500 py-12 text-center border border-dashed border-neutral-200 rounded-md">
          No items match.
        </div>
      )}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
          {filtered.map(it => (
            <PickerCard
              key={it.wardrobeId}
              item={it}
              selected={value?.wardrobeId === it.wardrobeId}
              onClick={() => onChange(it)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
