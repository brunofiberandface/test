'use client';

/**
 * /v2/wardrobe — wardrobe browser with collections sidebar.
 *
 * Sidebar shows Year → Quarter → Drop tree + NOOS sub-buckets derived
 * from item.category (Bottoms / Tops / Shoes / …). Gender chips above
 * the grid (All / Men / Women) refine the view further. Both are
 * server-side filters so counts and grid stay in sync.
 *
 * 2026-05-27 (Phase 2 Slice 2B + hotfix of dashboard redesign).
 */
import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import CollectionsSidebar, {
  type SidebarSelection,
  type CategoryBucket,
} from '@/components/v2/CollectionsSidebar';
import WardrobeCard, { type WardrobeCardData } from '@/components/v2/WardrobeCard';
import { dropKey as fmtDropKey, formatDrop } from '@/lib/v2/wardrobe-classification';

interface SidebarCounts {
  drops: Array<{ year: number; quarter: number; dropNumber: number; count: number }>;
  noosCategoryBuckets: CategoryBucket[];
  noosTotal: number;
  dropTotal: number;
  total: number;
  genderCounts: Record<string, number>;
}

interface WardrobeResponse {
  counts: SidebarCounts;
  items: WardrobeCardData[];
}

type GenderFilter = 'all' | 'male' | 'female';

function buildQuery(selection: SidebarSelection, gender: GenderFilter): string {
  const p = new URLSearchParams();
  if (selection.kind === 'drop') {
    p.set('dropKey', fmtDropKey({ year: selection.year, quarter: selection.quarter as 1 | 2 | 3 | 4, dropNumber: selection.dropNumber }));
  } else if (selection.kind === 'noos') {
    p.set('classification', 'noos');
  } else if (selection.kind === 'noosCategory') {
    p.set('classification', 'noos');
    p.set('category', selection.category);
  }
  if (gender !== 'all') p.set('gender', gender);
  return p.toString();
}

function selectionLabel(
  selection: SidebarSelection,
  counts: SidebarCounts | null,
  gender: GenderFilter,
): { title: string; sub?: string } {
  if (!counts) return { title: 'All items' };
  const genderSuffix =
    gender === 'all' ? '' : ` · ${gender === 'male' ? 'Men' : 'Women'}`;
  switch (selection.kind) {
    case 'all':
      return {
        title: 'All items' + genderSuffix,
        sub: `${counts.total} total · ${counts.dropTotal} in drops · ${counts.noosTotal} NOOS`,
      };
    case 'noos':
      return { title: 'All NOOS' + genderSuffix, sub: `${counts.noosTotal} items always-on` };
    case 'noosCategory': {
      const b = counts.noosCategoryBuckets.find(x => x.key === selection.category);
      return {
        title: `NOOS · ${b?.label || selection.category}` + genderSuffix,
        sub: b ? `${b.count} items` : undefined,
      };
    }
    case 'drop': {
      const d = { year: selection.year, quarter: selection.quarter as 1 | 2 | 3 | 4, dropNumber: selection.dropNumber };
      const count = counts.drops.find(x => x.year === d.year && x.quarter === d.quarter && x.dropNumber === d.dropNumber)?.count ?? 0;
      return { title: formatDrop(d) + genderSuffix, sub: `${count} items` };
    }
  }
}

const GENDER_CHIPS: Array<{ key: GenderFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'male', label: 'Men' },
  { key: 'female', label: 'Women' },
];

export default function V2WardrobePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [selection, setSelection] = useState<SidebarSelection>({ kind: 'all' });
  const [gender, setGender] = useState<GenderFilter>('all');
  const [resp, setResp] = useState<WardrobeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/auth/signin');
  }, [status, router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const q = buildQuery(selection, gender);
        const r = await fetch(`/api/v2/wardrobe${q ? `?${q}` : ''}`);
        if (!r.ok) throw new Error(`responded ${r.status}`);
        const j = await r.json();
        if (!cancelled) setResp(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [selection, gender]);

  const label = useMemo(
    () => selectionLabel(selection, resp?.counts ?? null, gender),
    [selection, resp, gender],
  );

  if (status === 'loading' || !session?.user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500">
        Loading…
      </div>
    );
  }
  const user = {
    email: session.user.email || '',
    name: session.user.name || '',
    role: (session.user as { role?: 'admin' | 'creator' }).role || 'creator',
  };

  const genderTotal = resp?.counts?.genderCounts ?? {};

  return (
    <Shell user={user}>
      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden flex min-h-[640px]">
        <CollectionsSidebar
          selection={selection}
          onSelect={setSelection}
          drops={resp?.counts?.drops ?? []}
          noosCategoryBuckets={resp?.counts?.noosCategoryBuckets ?? []}
          noosTotal={resp?.counts?.noosTotal ?? 0}
          total={resp?.counts?.total ?? 0}
          showEmptyCurrentYear
        />

        <div className="flex-1 min-w-0 p-4">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-[14px] font-medium text-neutral-900">{label.title}</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">{label.sub || ''}</div>
            </div>
            <div className="flex items-center gap-1">
              {GENDER_CHIPS.map(g => {
                const active = gender === g.key;
                const n = g.key === 'all'
                  ? (resp?.counts?.total ?? 0)
                  : (genderTotal[g.key] || 0);
                return (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => setGender(g.key)}
                    className={`text-[11px] rounded-full px-2.5 py-1 transition-colors ${
                      active
                        ? 'bg-neutral-900 text-white'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
                  >
                    {g.label} <span className={active ? 'text-neutral-300' : 'text-neutral-400'}>{n}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-md p-3">
              Failed to load wardrobe: {error}
            </div>
          )}

          {!resp && !error && (
            <div className="text-sm text-neutral-400 py-12 text-center">Loading wardrobe…</div>
          )}

          {resp && !error && resp.items.length === 0 && (
            <div className="text-sm text-neutral-500 py-12 text-center border border-dashed border-neutral-200 rounded-md">
              No items match this filter.
            </div>
          )}

          {resp && resp.items.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {resp.items.map(it => (
                <WardrobeCard key={it.wardrobeId} item={it} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
