'use client';

/**
 * Step 3 — pick styling items for the two slots that AREN'T the focus.
 *
 * Pool: NOOS only (drops cannot be used as styling — Bruno's rule).
 * Gender: matches the focus item's gender so the outfit reads as one
 * person's look.
 *
 * One section per unfilled slot, each with a grid of NOOS items in
 * that slot's categories. User picks exactly one per slot.
 *
 * 2026-05-27 (Phase 2 Slice 2D of dashboard redesign).
 */
import { useEffect, useState } from 'react';
import PickerCard from './PickerCard';
import {
  ALL_SLOTS, SLOT_CATEGORIES, categoryToSlot, slotLabel,
  type SlotKey, type WardrobeItemRef,
} from './wizard-types';

export interface StylingPickerStepProps {
  focus: WardrobeItemRef;
  value: Partial<Record<SlotKey, WardrobeItemRef>>;
  onChange: (value: Partial<Record<SlotKey, WardrobeItemRef>>) => void;
}

export default function StylingPickerStep({ focus, value, onChange }: StylingPickerStepProps) {
  const focusSlot = categoryToSlot(focus.category);
  const unfilledSlots = ALL_SLOTS.filter(s => s !== focusSlot);
  const focusGender = (focus.gender || '').toLowerCase() || undefined;

  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-5">
      <div className="text-[15px] font-medium text-neutral-900 mb-1">Add styling items</div>
      <div className="text-[12px] text-neutral-500 mb-4">
        NOOS only · drops cannot be used as styling. Pick one item per slot.
        {focusGender && <> Showing <span className="font-medium text-neutral-700">{focusGender}</span> items to match the focus garment.</>}
      </div>

      <div className="flex flex-col gap-5">
        {unfilledSlots.map(slot => (
          <StylingSlotSection
            key={slot}
            slot={slot}
            focusGender={focusGender}
            value={value[slot]}
            onChange={item => onChange({ ...value, [slot]: item })}
          />
        ))}
      </div>
    </div>
  );
}

function StylingSlotSection({
  slot, focusGender, value, onChange,
}: {
  slot: SlotKey;
  focusGender?: string;
  value: WardrobeItemRef | undefined;
  onChange: (item: WardrobeItemRef) => void;
}) {
  const [items, setItems] = useState<WardrobeItemRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    // /api/v2/wardrobe supports ONE category at a time. We hit the
    // endpoint once per allowed category and merge client-side.
    const cats = SLOT_CATEGORIES[slot];
    Promise.all(cats.map(cat => {
      const p = new URLSearchParams();
      p.set('classification', 'noos');
      p.set('category', cat);
      if (focusGender) p.set('gender', focusGender);
      return fetch(`/api/v2/wardrobe?${p}`).then(r => r.json());
    }))
    .then(results => {
      if (cancelled) return;
      const merged: WardrobeItemRef[] = [];
      const seen = new Set<string>();
      for (const r of results) {
        for (const it of (r.items || []) as WardrobeItemRef[]) {
          if (!seen.has(it.wardrobeId)) {
            seen.add(it.wardrobeId);
            merged.push(it);
          }
        }
      }
      merged.sort((a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0));
      setItems(merged);
    })
    .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [slot, focusGender]);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[12px] font-medium text-neutral-700">
          {slotLabel(slot)}
          {value && <span className="ml-1.5 text-neutral-500 font-normal">· {value.name}</span>}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-neutral-400">
          {items ? `${items.length} options` : ''}
        </div>
      </div>

      {error && (
        <div className="text-[12px] text-red-600 border border-red-200 bg-red-50 rounded-md p-2">
          Failed to load: {error}
        </div>
      )}
      {!items && !error && (
        <div className="text-[12px] text-neutral-400 py-6 text-center">Loading…</div>
      )}
      {items && items.length === 0 && !error && (
        <div className="text-[12px] text-neutral-500 py-6 text-center border border-dashed border-neutral-200 rounded-md">
          No {slotLabel(slot).toLowerCase()} available in NOOS{focusGender ? ` for ${focusGender}` : ''}.
        </div>
      )}
      {items && items.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {items.map(it => (
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
