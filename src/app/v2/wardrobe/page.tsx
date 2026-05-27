'use client';

/**
 * /v2/wardrobe — wardrobe browser with collections sidebar.
 *
 * Sidebar shows Year → Quarter → Drop tree + NOOS sub-buckets with live
 * counts. Click any sidebar entry to filter the grid. The Legacy banner
 * sits above the grid until every item is reclassified out of the
 * migration bucket.
 *
 * No mutation yet — Slice 2C adds the upload form, Slice 2D adds the
 * reclassify-from-Legacy flow. Slice 2B is pure browse.
 *
 * 2026-05-27 (Phase 2 Slice 2B of dashboard redesign).
 */
import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Shell from '@/components/Shell';
import CollectionsSidebar, { type SidebarSelection } from '@/components/v2/CollectionsSidebar';
import WardrobeCard, { type WardrobeCardData } from '@/components/v2/WardrobeCard';
import LegacyMigrationBanner from '@/components/v2/LegacyMigrationBanner';
import { dropKey as fmtDropKey, formatDrop, NOOS_BUCKET_LABELS, type V2NoosBucket } from '@/lib/v2/wardrobe-classification';

interface SidebarCounts {
  drops: Array<{ year: number; quarter: number; dropNumber: number; count: number }>;
  noosByBucket: Record<V2NoosBucket, number>;
  noosTotal: number;
  dropTotal: number;
  total: number;
}

interface WardrobeResponse {
  counts: SidebarCounts;
  items: WardrobeCardData[];
}

function buildQuery(selection: SidebarSelection): string {
  const p = new URLSearchParams();
  if (selection.kind === 'drop') {
    p.set('dropKey', fmtDropKey({ year: selection.year, quarter: selection.quarter as 1 | 2 | 3 | 4, dropNumber: selection.dropNumber }));
  } else if (selection.kind === 'noos') {
    p.set('noosBucket', selection.bucket);
  } else if (selection.kind === 'noosAll') {
    p.set('classification', 'noos');
  }
  return p.toString();
}

function selectionLabel(selection: SidebarSelection, counts: SidebarCounts | null): { title: string; sub?: string } {
  if (!counts) return { title: 'All items' };
  switch (selection.kind) {
    case 'all':
      return { title: 'All items', sub: `${counts.total} total · ${counts.dropTotal} in drops · ${counts.noosTotal} NOOS` };
    case 'noosAll':
      return { title: 'All NOOS', sub: `${counts.noosTotal} items always-on` };
    case 'noos':
      return { title: `NOOS · ${NOOS_BUCKET_LABELS[selection.bucket]}`, sub: `${counts.noosByBucket[selection.bucket] || 0} items` };
    case 'drop': {
      const d = { year: selection.year, quarter: selection.quarter as 1 | 2 | 3 | 4, dropNumber: selection.dropNumber };
      const count = counts.drops.find(x => x.year === d.year && x.quarter === d.quarter && x.dropNumber === d.dropNumber)?.count ?? 0;
      return { title: formatDrop(d), sub: `${count} items` };
    }
  }
}

export default function V2WardrobePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [selection, setSelection] = useState<SidebarSelection>({ kind: 'all' });
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
        const q = buildQuery(selection);
        const r = await fetch(`/api/v2/wardrobe${q ? `?${q}` : ''}`);
        if (!r.ok) throw new Error(`responded ${r.status}`);
        const j = await r.json();
        if (!cancelled) setResp(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [selection]);

  const label = useMemo(() => selectionLabel(selection, resp?.counts ?? null), [selection, resp]);

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

  const legacyCount = resp?.counts?.noosByBucket.legacy ?? 0;

  return (
    <Shell user={user}>
      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden flex min-h-[640px]">
        <CollectionsSidebar
          selection={selection}
          onSelect={setSelection}
          drops={resp?.counts?.drops ?? []}
          noosByBucket={resp?.counts?.noosByBucket ?? { denim: 0, tops: 0, outerwear: 0, legacy: 0 }}
          noosTotal={resp?.counts?.noosTotal ?? 0}
          showEmptyCurrentYear
        />

        <div className="flex-1 min-w-0 p-4">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-[14px] font-medium text-neutral-900">{label.title}</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">{label.sub || ''}</div>
            </div>
            <Link
              href="/wardrobe"
              className="text-[11px] uppercase tracking-wider text-neutral-400 hover:text-neutral-900"
              title="Slice 2C will replace this with a v2 upload form"
            >
              + Upload (Classic)
            </Link>
          </div>

          <LegacyMigrationBanner
            legacyCount={legacyCount}
            onReview={() => setSelection({ kind: 'noos', bucket: 'legacy' })}
          />

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
              No items match this filter yet.
            </div>
          )}

          {resp && resp.items.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
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
