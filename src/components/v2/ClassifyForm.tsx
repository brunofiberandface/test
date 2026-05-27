'use client';

/**
 * <ClassifyForm/> — pick Drop vs NOOS classification for a wardrobe
 * item. When Drop is chosen, the form collects year + quarter + drop
 * number. When NOOS is chosen, no further input is needed (the sidebar
 * bucket derives from item.category).
 *
 * Drops are created IMPLICITLY — the moment a wardrobe item is saved
 * with a drop coordinate, that drop exists in the sidebar tree. No
 * separate drop catalog. Bruno approved (b) in the Slice 2C scoping.
 *
 * 2026-05-27 (Phase 2 Slice 2C-classify of dashboard redesign).
 */
import { useState, useEffect } from 'react';
import {
  QUARTER_LABELS,
  type V2Quarter,
} from '@/lib/v2/wardrobe-classification';

export interface ClassifyFormValue {
  classification: 'drop' | 'noos';
  drop?: { year: number; quarter: V2Quarter; dropNumber: number };
}

export interface ClassifyFormProps {
  initial: ClassifyFormValue;
  category?: string;          // item.category, for the NOOS info line
  busy?: boolean;
  errorMessage?: string | null;
  onSubmit: (value: ClassifyFormValue) => void | Promise<void>;
}

const CURRENT_YEAR = new Date().getFullYear();

export default function ClassifyForm({
  initial, category, busy, errorMessage, onSubmit,
}: ClassifyFormProps) {
  const [kind, setKind] = useState<'drop' | 'noos'>(initial.classification);
  const [year, setYear] = useState<number>(initial.drop?.year ?? CURRENT_YEAR);
  const [quarter, setQuarter] = useState<V2Quarter>(initial.drop?.quarter ?? 1);
  const [dropNumber, setDropNumber] = useState<number>(initial.drop?.dropNumber ?? 1);

  // Sync when the parent reloads the item (e.g. after save).
  useEffect(() => {
    setKind(initial.classification);
    if (initial.drop) {
      setYear(initial.drop.year);
      setQuarter(initial.drop.quarter);
      setDropNumber(initial.drop.dropNumber);
    }
  }, [initial.classification, initial.drop?.year, initial.drop?.quarter, initial.drop?.dropNumber]);

  const handleSave = () => {
    if (kind === 'drop') {
      onSubmit({
        classification: 'drop',
        drop: { year, quarter, dropNumber },
      });
    } else {
      onSubmit({ classification: 'noos' });
    }
  };

  const yearOptions = [CURRENT_YEAR, CURRENT_YEAR + 1, CURRENT_YEAR - 1].sort((a, b) => b - a);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setKind('drop')}
          className={`text-left p-3 rounded-md border-2 transition-colors ${
            kind === 'drop'
              ? 'border-[#378ADD] bg-[#E6F1FB]'
              : 'border-neutral-200 hover:border-neutral-300'
          }`}
        >
          <div className="text-[13px] font-medium text-neutral-900 mb-0.5">Drop</div>
          <div className="text-[11px] text-neutral-500 leading-snug">Time-bound. Sells out. Focus only.</div>
        </button>
        <button
          type="button"
          onClick={() => setKind('noos')}
          className={`text-left p-3 rounded-md border-2 transition-colors ${
            kind === 'noos'
              ? 'border-[#0F6E56] bg-[#E1F5EE]'
              : 'border-neutral-200 hover:border-neutral-300'
          }`}
        >
          <div className="text-[13px] font-medium text-neutral-900 mb-0.5">NOOS</div>
          <div className="text-[11px] text-neutral-500 leading-snug">Always-on. Can be focus or styling.</div>
        </button>
      </div>

      {kind === 'drop' && (
        <div className="border border-neutral-200 rounded-md p-3 bg-white">
          <div className="text-[11px] text-neutral-500 mb-2">Drop coordinates</div>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-neutral-400">Year</span>
              <select
                value={year}
                onChange={e => setYear(Number(e.target.value))}
                className="border border-neutral-300 rounded-md px-2 py-1.5 text-[13px] bg-white"
              >
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-neutral-400">Quarter</span>
              <select
                value={quarter}
                onChange={e => setQuarter(Number(e.target.value) as V2Quarter)}
                className="border border-neutral-300 rounded-md px-2 py-1.5 text-[13px] bg-white"
              >
                {([1, 2, 3, 4] as V2Quarter[]).map(q => (
                  <option key={q} value={q}>{QUARTER_LABELS[q]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-neutral-400">Drop #</span>
              <input
                type="number"
                min={1}
                max={99}
                value={dropNumber}
                onChange={e => setDropNumber(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                className="border border-neutral-300 rounded-md px-2 py-1.5 text-[13px] bg-white"
              />
            </label>
          </div>
          <div className="mt-2 text-[11px] text-neutral-500">
            Saving will create <span className="font-medium text-neutral-700">{year} · Q{quarter} · Drop {dropNumber}</span>
            {' '}in the sidebar (if it doesn&apos;t exist yet) and place this item in it.
          </div>
        </div>
      )}

      {kind === 'noos' && (
        <div className="border border-neutral-200 rounded-md p-3 bg-white">
          <div className="text-[11px] text-neutral-500 leading-snug">
            This item will appear under <span className="font-medium text-neutral-700">NOOS · {category ? category[0].toUpperCase() + category.slice(1) + (category.endsWith('s') ? '' : 's') : 'its category'}</span>{' '}
            in the sidebar. NOOS items can be used as the focus garment OR as styling on any job.
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {errorMessage}
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={busy}
        className="bg-neutral-900 text-white rounded-md py-2 text-[13px] font-medium hover:bg-neutral-800 transition-colors disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save classification'}
      </button>
    </div>
  );
}
