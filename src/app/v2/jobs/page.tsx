'use client';

/**
 * /v2/jobs — chronological feed with Active / Completed / Live tabs.
 *
 * Slice 1C wires:
 *   - Tab strip with counts
 *   - Tile-click modal (lifted state so the same modal serves every tile
 *     across every visible row)
 *   - Refetch on modal close IF a winner was toggled during the session,
 *     so tab counts + star badges stay accurate.
 *
 * 2026-05-27 (Phase 1 Slice 1C of dashboard redesign).
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import ChronologicalFeed from '@/components/v2/ChronologicalFeed';
import ShotTileModal, { type ShotModalContext } from '@/components/v2/ShotTileModal';
import type { ShotTileClickInfo } from '@/components/v2/JobRow';
import type { V2Tab } from '@/lib/v2/job-status';

interface FeedCounts {
  active: number; completed: number; live: number; archived: number; total: number;
}

const TABS: Array<{ key: V2Tab; label: string }> = [
  { key: 'active',    label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'live',      label: 'Live' },
];

type DateRange = 'all' | '7d' | '30d' | '90d';
const DATE_RANGES: Array<{ key: DateRange; label: string }> = [
  { key: '7d',  label: 'Last 7d' },
  { key: '30d', label: 'Last 30d' },
  { key: '90d', label: 'Last 90d' },
  { key: 'all', label: 'All time' },
];

export default function V2JobsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [tab, setTab] = useState<V2Tab>('active');
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [counts, setCounts] = useState<FeedCounts>({ active: 0, completed: 0, live: 0, archived: 0, total: 0 });
  const [modalCtx, setModalCtx] = useState<ShotModalContext | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const dirtyRef = useRef(false); // set true if any action during this modal session mutated server state

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/auth/signin');
  }, [status, router]);

  const onShotTileClick = useCallback((info: ShotTileClickInfo) => {
    const { job, shot } = info;
    setModalCtx({
      shotId: shot.shotId,
      shotType: shot.shotType,
      imageUrl: shot.imageUrl,
      version: shot.version,
      totalVersions: shot.totalVersions,
      isWinner: shot.isWinner,
      jobId: job.jobId,
      designNumber: job.focusDesignNumber,
      designName: job.focusDesignName,
      modelName: job.modelName,
      status: shot.status,
    });
    dirtyRef.current = false;
  }, []);

  const onCloseModal = useCallback(() => {
    setModalCtx(null);
    if (dirtyRef.current) {
      dirtyRef.current = false;
      setRefreshKey(k => k + 1);
    }
  }, []);

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

  return (
    <Shell user={user}>
      <div className="max-w-5xl mx-auto">
        {/* Sticky header: page title + tabs + date range filter. Same
            pattern as the wizard so the tabs are always reachable while
            the feed scrolls. */}
        <div className="sticky top-0 z-20 bg-neutral-50 -mx-6 px-6 pt-2 pb-3 border-b border-neutral-200">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <h1 className="text-xl font-semibold text-neutral-900">Jobs</h1>
              <p className="text-[12px] text-neutral-500 mt-0.5">
                Click a row to open the job. Click a shot tile to preview.
              </p>
            </div>
            <div className="flex items-center gap-1">
              {DATE_RANGES.map(r => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setDateRange(r.key)}
                  className={`text-[11px] rounded-full px-2.5 py-1 transition-colors ${
                    dateRange === r.key
                      ? 'bg-neutral-900 text-white'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab strip */}
          <div className="flex items-center gap-1 border-b border-neutral-200">
            {TABS.map(t => {
              const active = tab === t.key;
              const count = counts[t.key];
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`px-3 pb-2 -mb-px border-b-2 transition-colors text-[13px] ${
                    active
                      ? 'border-neutral-900 text-neutral-900 font-medium'
                      : 'border-transparent text-neutral-500 hover:text-neutral-900'
                  }`}
                >
                  {t.label}
                  <span className={`ml-1.5 text-[11px] ${active ? 'text-neutral-500' : 'text-neutral-400'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-4">
          <ChronologicalFeed
            tab={tab}
            dateRange={dateRange}
            onShotTileClick={onShotTileClick}
            onCountsChange={setCounts}
            refreshKey={refreshKey}
          />
        </div>

        <ShotTileModal
          context={modalCtx}
          onClose={onCloseModal}
          onWinnerToggled={(isWinner) => {
            dirtyRef.current = true;
            setModalCtx(prev => prev ? { ...prev, isWinner } : prev);
          }}
        />
      </div>
    </Shell>
  );
}
