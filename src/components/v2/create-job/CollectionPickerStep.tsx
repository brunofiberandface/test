'use client';

/**
 * Step 1 — pick the collection the focus garment belongs to.
 *
 * Drop tile → expand to year/quarter/dropNumber dropdowns. The available
 * drops are pulled from the wardrobe (only drops with at least one item
 * are shown; "currentYear + nothing" feels confusing so we surface a
 * helper line if there are zero drops at all).
 *
 * NOOS tile → no further input.
 *
 * 2026-05-27 (Phase 2 Slice 2D of dashboard redesign).
 */
import { useEffect, useMemo, useState } from 'react';
import { QUARTER_LABELS, type V2Quarter } from '@/lib/v2/wardrobe-classification';
import type { CollectionPick } from './wizard-types';

interface DropOption {
  year: number;
  quarter: number;
  dropNumber: number;
  count: number;
}

interface WardrobeCountsResponse {
  counts: {
    drops: DropOption[];
    noosTotal: number;
  };
}

export interface CollectionPickerStepProps {
  value: CollectionPick | null;
  onChange: (value: CollectionPick) => void;
}

export default function CollectionPickerStep({ value, onChange }: CollectionPickerStepProps) {
  const [drops, setDrops] = useState<DropOption[] | null>(null);
  const [noosTotal, setNoosTotal] = useState<number>(0);
  const [kind, setKind] = useState<'drop' | 'noos'>(value?.kind || 'drop');
  const [year, setYear] = useState<number>(value?.kind === 'drop' ? value.year : new Date().getFullYear());
  const [quarter, setQuarter] = useState<V2Quarter>(value?.kind === 'drop' ? value.quarter : 1);
  const [dropNumber, setDropNumber] = useState<number>(value?.kind === 'drop' ? value.dropNumber : 1);

  useEffect(() => {
    fetch('/api/v2/wardrobe')
      .then(r => r.json())
      .then((j: WardrobeCountsResponse) => {
        setDrops(j.counts?.drops || []);
        setNoosTotal(j.counts?.noosTotal || 0);
      })
      .catch(() => { /* tolerate; show empty state */ });
  }, []);

  // When user changes any drop coord, propagate.
  useEffect(() => {
    if (kind === 'drop') {
      onChange({ kind: 'drop', year, quarter, dropNumber });
    } else {
      onChange({ kind: 'noos' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, year, quarter, dropNumber]);

  // Build cascading option lists from the available drops.
  const years = useMemo(() => {
    const set = new Set<number>(drops?.map(d => d.year) ?? []);
    set.add(new Date().getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [drops]);
  const quarters = useMemo(() => {
    const qs = new Set<V2Quarter>();
    for (const d of drops ?? []) if (d.year === year) qs.add(d.quarter as V2Quarter);
    if (qs.size === 0) for (const q of [1, 2, 3, 4] as V2Quarter[]) qs.add(q);
    return Array.from(qs).sort((a, b) => a - b);
  }, [drops, year]);
  const dropNumbers = useMemo(() => {
    const ns = new Set<number>();
    for (const d of drops ?? []) if (d.year === year && d.quarter === quarter) ns.add(d.dropNumber);
    if (ns.size === 0) ns.add(1);
    return Array.from(ns).sort((a, b) => a - b);
  }, [drops, year, quarter]);

  const selectedDropCount = drops?.find(
    d => d.year === year && d.quarter === quarter && d.dropNumber === dropNumber,
  )?.count ?? 0;

  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-5">
      <div className="text-[15px] font-medium text-neutral-900 mb-1">Where does this design live?</div>
      <div className="text-[12px] text-neutral-500 mb-4">
        Pick a Drop (time-bound, sells out) or NOOS (always-on). Styling items must come from NOOS regardless.
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <button
          type="button"
          onClick={() => setKind('drop')}
          className={`text-left p-4 rounded-md border-2 transition-colors ${
            kind === 'drop'
              ? 'border-[#378ADD] bg-[#E6F1FB]'
              : 'border-neutral-200 hover:border-neutral-300'
          }`}
        >
          <div className="text-[14px] font-medium text-neutral-900 mb-1">From a Drop</div>
          <div className="text-[11px] text-neutral-500 leading-snug">
            Time-bound merch. Sells out. Focus item must be from this drop.
          </div>
        </button>
        <button
          type="button"
          onClick={() => setKind('noos')}
          className={`text-left p-4 rounded-md border-2 transition-colors ${
            kind === 'noos'
              ? 'border-[#0F6E56] bg-[#E1F5EE]'
              : 'border-neutral-200 hover:border-neutral-300'
          }`}
        >
          <div className="text-[14px] font-medium text-neutral-900 mb-1">From NOOS</div>
          <div className="text-[11px] text-neutral-500 leading-snug">
            Always-on. {noosTotal} items available.
          </div>
        </button>
      </div>

      {kind === 'drop' && (
        <div className="border border-neutral-200 rounded-md p-3 bg-neutral-50">
          <div className="text-[11px] text-neutral-500 mb-2">Pick the drop</div>
          {drops && drops.length === 0 ? (
            <div className="text-[12px] text-neutral-600 bg-[#FAEEDA] border border-[#F0C36C] rounded-md px-3 py-2">
              No drops exist yet. Classify a wardrobe item with drop coordinates first
              (visit any item in <span className="font-medium">/v2/wardrobe</span>), then return here.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-400">Year</span>
                  <select value={year} onChange={e => setYear(Number(e.target.value))} className="border border-neutral-300 rounded-md px-2 py-1.5 text-[13px] bg-white">
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-400">Quarter</span>
                  <select value={quarter} onChange={e => setQuarter(Number(e.target.value) as V2Quarter)} className="border border-neutral-300 rounded-md px-2 py-1.5 text-[13px] bg-white">
                    {quarters.map(q => <option key={q} value={q}>{QUARTER_LABELS[q]}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-400">Drop #</span>
                  <select value={dropNumber} onChange={e => setDropNumber(Number(e.target.value))} className="border border-neutral-300 rounded-md px-2 py-1.5 text-[13px] bg-white">
                    {dropNumbers.map(n => <option key={n} value={n}>Drop {n}</option>)}
                  </select>
                </label>
              </div>
              <div className="mt-2 text-[11px] text-neutral-500">
                Selected drop has <span className="font-medium text-neutral-700">{selectedDropCount}</span> {selectedDropCount === 1 ? 'item' : 'items'} available as focus.
              </div>
            </>
          )}
        </div>
      )}

      {kind === 'noos' && (
        <div className="border border-neutral-200 rounded-md p-3 bg-neutral-50 text-[12px] text-neutral-600">
          Focus item can be any of the {noosTotal} NOOS items. NOOS focus items can use any other NOOS as styling.
        </div>
      )}
    </div>
  );
}
