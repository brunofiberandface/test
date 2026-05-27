'use client';

/**
 * <ChronologicalFeed/> — the body of /v2/jobs.
 *
 * Fetches /api/v2/feed once on mount, buckets jobs by time, renders the
 * stack of <JobRow/> grouped under time bucket headers. Filters by the
 * `tab` prop so the parent page controls which slice (active / completed /
 * live) is currently shown.
 *
 * The parent also passes `onShotTileClick` so clicking a shot tile bubbles
 * up to open the ShotTileModal in place instead of navigating to the job
 * detail page.
 *
 * 2026-05-27 (Phase 1 Slice 1C of dashboard redesign).
 */
import { useEffect, useMemo, useState } from 'react';
import JobRow, { type ShotTileClickInfo } from './JobRow';
import { bucketJobsByTime, type FeedJob, type TimeBucket } from './feed-types';
import { deriveV2Status, tabForStatus, type V2Tab } from '@/lib/v2/job-status';

export interface FeedHandle {
  refetch: () => Promise<void>;
}

export default function ChronologicalFeed({
  tab,
  onShotTileClick,
  onCountsChange,
  refreshKey = 0,
}: {
  tab: V2Tab;
  onShotTileClick?: (info: ShotTileClickInfo) => void;
  onCountsChange?: (counts: { active: number; completed: number; live: number; archived: number; total: number }) => void;
  refreshKey?: number;
}) {
  const [jobs, setJobs] = useState<FeedJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        // Default 30 for fast first paint. Bumping later via a "Load more"
        // button is a Phase 2 ergonomics win.
        const r = await fetch(`/api/v2/feed?limit=30&_=${refreshKey}`);
        if (!r.ok) throw new Error(`feed responded ${r.status}`);
        const j = await r.json();
        if (!cancelled) setJobs(j.jobs || []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const jobTabs = useMemo(() => {
    if (!jobs) return null;
    const map = new Map<string, V2Tab>();
    for (const j of jobs) {
      const s = deriveV2Status({
        rawStatus: j.status,
        archived: j.archived,
        winnerCount: j.winnerCount,
        totalShotTypes: j.totalShotTypes,
      });
      map.set(j.id, tabForStatus(s));
    }
    return map;
  }, [jobs]);

  // Notify parent of counts (for tab badges).
  useEffect(() => {
    if (!jobs || !jobTabs || !onCountsChange) return;
    const counts = { active: 0, completed: 0, live: 0, archived: 0, total: jobs.length };
    for (const j of jobs) {
      const t = jobTabs.get(j.id) || 'active';
      counts[t]++;
    }
    onCountsChange(counts);
  }, [jobs, jobTabs, onCountsChange]);

  if (error) {
    return (
      <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-md p-3">
        Failed to load feed: {error}
      </div>
    );
  }
  if (jobs === null) {
    return <div className="text-sm text-neutral-400 py-8 text-center">Loading jobs…</div>;
  }

  const filtered = jobs.filter(j => (jobTabs?.get(j.id) || 'active') === tab);

  if (filtered.length === 0) {
    const label = tab === 'live' ? 'No live jobs yet.' : tab === 'completed' ? 'No completed jobs yet.' : 'No active jobs.';
    return (
      <div className="text-sm text-neutral-500 py-12 text-center border border-dashed border-neutral-200 rounded-lg">
        {label}
      </div>
    );
  }

  const buckets: TimeBucket[] = bucketJobsByTime(filtered);
  return (
    <div className="flex flex-col gap-6">
      {buckets.map(bucket => (
        <section key={bucket.key}>
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-[11px] uppercase tracking-wider text-neutral-500 font-medium">
              {bucket.label}
              {bucket.dateLabel ? <span className="text-neutral-400"> · {bucket.dateLabel}</span> : null}
            </h2>
            <span className="text-[11px] text-neutral-400">
              {bucket.jobs.length} {bucket.jobs.length === 1 ? 'job' : 'jobs'}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {bucket.jobs.map(job => (
              <JobRow key={job.id} job={job} onShotTileClick={onShotTileClick} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
