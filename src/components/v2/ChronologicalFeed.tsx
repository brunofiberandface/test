'use client';

/**
 * <ChronologicalFeed/> — the body of /v2/jobs.
 *
 * Fetches /api/v2/feed once on mount, buckets jobs by time, renders a stack
 * of <JobRow/> grouped under time-bucket headers.
 *
 * No pagination yet — limit defaults to 100. Once we have feedback on how
 * users browse, we add infinite scroll or load-more.
 *
 * 2026-05-27 (Phase 1 Slice 1B of dashboard redesign).
 */
import { useEffect, useState } from 'react';
import JobRow from './JobRow';
import { bucketJobsByTime, type FeedJob, type TimeBucket } from './feed-types';

export default function ChronologicalFeed() {
  const [jobs, setJobs] = useState<FeedJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/v2/feed?limit=100');
        if (!r.ok) throw new Error(`feed responded ${r.status}`);
        const j = await r.json();
        if (!cancelled) setJobs(j.jobs || []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-md p-3">
        Failed to load feed: {error}
      </div>
    );
  }

  if (jobs === null) {
    return (
      <div className="text-sm text-neutral-400 py-8 text-center">
        Loading jobs…
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="text-sm text-neutral-500 py-12 text-center border border-dashed border-neutral-200 rounded-lg">
        No jobs yet.
      </div>
    );
  }

  const buckets: TimeBucket[] = bucketJobsByTime(jobs);
  return (
    <div className="flex flex-col gap-6">
      {buckets.map(bucket => (
        <section key={bucket.key}>
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-[11px] uppercase tracking-wider text-neutral-500 font-medium">
              {bucket.label}
              {bucket.dateLabel ? <span className="text-neutral-400"> · {bucket.dateLabel}</span> : null}
            </h2>
            <span className="text-[11px] text-neutral-400">{bucket.jobs.length} {bucket.jobs.length === 1 ? 'job' : 'jobs'}</span>
          </div>
          <div className="flex flex-col gap-2">
            {bucket.jobs.map(job => (
              <JobRow key={job.id} job={job} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
