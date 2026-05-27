'use client';

/**
 * <CollectionsSidebar/> — Year → Quarter → Drop tree + NOOS sub-buckets.
 *
 * NOOS sub-buckets are now derived from the actual `category` values
 * present in the data (Bottoms / Tops / Shoes / …) rather than a fixed
 * enum. The parent passes them in via `noosCategoryBuckets`.
 *
 * Reusable. Used in /v2/wardrobe (this slice) and will be reused in
 * /v2/jobs/new step 1 (Slice 2D) for the focus-collection picker.
 *
 * 2026-05-27 (Phase 2 Slice 2B + hotfix of dashboard redesign).
 */
import { useMemo, useState } from 'react';
import { QUARTER_LABELS } from '@/lib/v2/wardrobe-classification';

export type SidebarSelection =
  | { kind: 'all' }
  | { kind: 'drop'; year: number; quarter: number; dropNumber: number }
  | { kind: 'noos' }                                     // All NOOS
  | { kind: 'noosCategory'; category: string };          // NOOS · {category}

export interface CategoryBucket {
  key: string;
  label: string;
  count: number;
}

export interface CollectionsSidebarProps {
  selection: SidebarSelection;
  onSelect: (s: SidebarSelection) => void;
  drops: Array<{ year: number; quarter: number; dropNumber: number; count: number }>;
  noosCategoryBuckets: CategoryBucket[];
  noosTotal: number;
  total: number;
  showEmptyCurrentYear?: boolean;
}

function isSelectedDrop(
  sel: SidebarSelection,
  d: { year: number; quarter: number; dropNumber: number },
): boolean {
  return sel.kind === 'drop'
    && sel.year === d.year
    && sel.quarter === d.quarter
    && sel.dropNumber === d.dropNumber;
}

export default function CollectionsSidebar({
  selection, onSelect, drops, noosCategoryBuckets, noosTotal, total, showEmptyCurrentYear,
}: CollectionsSidebarProps) {
  const yearsMap = useMemo(() => {
    const m = new Map<number, typeof drops>();
    for (const d of drops) {
      const arr = m.get(d.year) || [];
      arr.push(d);
      m.set(d.year, arr);
    }
    return m;
  }, [drops]);

  const currentYear = new Date().getFullYear();
  const yearList = useMemo(() => {
    const set = new Set(Array.from(yearsMap.keys()));
    if (showEmptyCurrentYear) set.add(currentYear);
    return Array.from(set).sort((a, b) => b - a);
  }, [yearsMap, showEmptyCurrentYear, currentYear]);

  const [expanded, setExpanded] = useState<Record<number, boolean>>(() => ({
    [currentYear]: true,
  }));

  const toggleYear = (year: number) =>
    setExpanded(e => ({ ...e, [year]: !e[year] }));

  return (
    <aside className="w-[168px] shrink-0 bg-white border-r border-neutral-200 py-3.5 px-3 text-[12px]">
      <button
        type="button"
        onClick={() => onSelect({ kind: 'all' })}
        className={`w-full flex items-center justify-between px-1.5 py-1 rounded mb-3 ${
          selection.kind === 'all'
            ? 'bg-neutral-100 text-neutral-900 font-medium'
            : 'text-neutral-700 hover:bg-neutral-50'
        }`}
      >
        <span>All items</span>
        <span className="text-[11px] text-neutral-400">{total}</span>
      </button>

      <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">Collections</div>
      {yearList.length === 0 ? (
        <div className="text-[11px] text-neutral-400 italic px-1.5 py-1 mb-3">
          No drops yet.
        </div>
      ) : (
        <div className="flex flex-col gap-px mb-3">
          {yearList.map(year => {
            const yearDrops = yearsMap.get(year) || [];
            const isExpanded = expanded[year] === true;
            const yearTotal = yearDrops.reduce((a, b) => a + b.count, 0);
            return (
              <div key={year}>
                <button
                  type="button"
                  onClick={() => toggleYear(year)}
                  className="w-full flex items-center gap-1 px-1.5 py-1 text-neutral-700 hover:text-neutral-900 font-medium"
                >
                  <span className="w-3 text-[10px]">{isExpanded ? '▾' : '▸'}</span>
                  <span>{year}</span>
                  <span className="ml-auto text-[11px] text-neutral-400">{yearTotal || '—'}</span>
                </button>
                {isExpanded && (
                  <div className="pl-4 flex flex-col gap-px">
                    {([1, 2, 3, 4] as const).map(q => {
                      const quarterDrops = yearDrops.filter(d => d.quarter === q);
                      const qTotal = quarterDrops.reduce((a, b) => a + b.count, 0);
                      if (quarterDrops.length === 0) {
                        return (
                          <div key={q} className="flex items-center justify-between px-1.5 py-0.5 text-[11px] text-neutral-400">
                            <span>{QUARTER_LABELS[q]}</span>
                            <span>—</span>
                          </div>
                        );
                      }
                      return (
                        <div key={q}>
                          <div className="flex items-center justify-between px-1.5 py-0.5 text-[11px] text-neutral-600">
                            <span>{QUARTER_LABELS[q]}</span>
                            <span className="text-neutral-400">{qTotal}</span>
                          </div>
                          <div className="pl-4 flex flex-col gap-px">
                            {quarterDrops.map(d => {
                              const active = isSelectedDrop(selection, d);
                              return (
                                <button
                                  key={d.dropNumber}
                                  type="button"
                                  onClick={() => onSelect({ kind: 'drop', year: d.year, quarter: d.quarter, dropNumber: d.dropNumber })}
                                  className={`w-full flex items-center justify-between px-1.5 py-0.5 rounded text-[11px] ${
                                    active
                                      ? 'bg-[#EEEDFE] text-[#26215C] font-medium'
                                      : 'text-neutral-600 hover:text-neutral-900'
                                  }`}
                                >
                                  <span>Drop {d.dropNumber}</span>
                                  <span className={active ? 'text-[#534AB7]' : 'text-neutral-400'}>{d.count}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="h-px bg-neutral-200 my-3" />

      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] uppercase tracking-wider text-neutral-400">NOOS</div>
        <span className="text-[9px] font-medium bg-[#E1F5EE] text-[#04342C] px-1.5 py-px rounded-sm">always-on</span>
      </div>
      <div className="flex flex-col gap-px">
        <button
          type="button"
          onClick={() => onSelect({ kind: 'noos' })}
          className={`w-full flex items-center justify-between px-1.5 py-1 rounded ${
            selection.kind === 'noos'
              ? 'bg-neutral-100 text-neutral-900 font-medium'
              : 'text-neutral-700 hover:text-neutral-900'
          }`}
        >
          <span>All NOOS</span>
          <span className="text-[11px] text-neutral-400">{noosTotal}</span>
        </button>
        {noosCategoryBuckets.map(b => {
          const active = selection.kind === 'noosCategory' && selection.category === b.key;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => onSelect({ kind: 'noosCategory', category: b.key })}
              className={`w-full flex items-center justify-between pl-5 pr-1.5 py-0.5 rounded text-[11px] ${
                active
                  ? 'bg-neutral-100 text-neutral-900 font-medium'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <span>{b.label}</span>
              <span className="text-neutral-400">{b.count}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
