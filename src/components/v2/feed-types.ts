/**
 * Shared types for the v2 chronological feed.
 *
 * Mirrors the shape returned by GET /api/v2/feed. Kept in a standalone file
 * so future v2 components (job detail, contact sheet) can import without
 * cycling through the component tree.
 *
 * 2026-05-27 (Phase 1 Slice 1B of dashboard redesign).
 */

export interface ShotSummary {
  shotType: string;
  shotId?: string;
  imageUrl?: string;
  version?: number;
  totalVersions?: number;
  status?: string;
  isWinner?: boolean;
}

export interface FeedJob {
  id: string;
  jobId: string;
  jobName?: string;
  jobNumber?: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  creatorEmail?: string;
  archived?: boolean;
  focusDesignNumber?: string;
  focusDesignName?: string;
  focusName?: string;
  focusCategory?: string;
  focusFitModelFrontUrl?: string;
  modelId?: string;
  modelName?: string;
  modelReferenceImageUrl?: string;
  shots: Record<string, ShotSummary>;
  winnerCount: number;
  totalShotTypes: number;
}

export interface TimeBucket {
  key: 'today' | 'yesterday' | 'thisWeek' | 'earlier';
  label: string;
  dateLabel?: string;
  jobs: FeedJob[];
}

/**
 * Group jobs by time bucket relative to "now". Buckets always returned in
 * the order Today → Yesterday → This week → Earlier. Empty buckets are
 * dropped so the feed doesn't show empty section headers.
 */
export function bucketJobsByTime(jobs: FeedJob[], now: Date = new Date()): TimeBucket[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  // "This week" = last 7 days (excluding today + yesterday which have their
  // own buckets). Keeps the feed scannable without piling everything into
  // "Earlier" the moment something is 3 days old.
  const startOfThisWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;

  const buckets: Record<TimeBucket['key'], FeedJob[]> = {
    today: [], yesterday: [], thisWeek: [], earlier: [],
  };
  for (const job of jobs) {
    const ts = job.updatedAt || job.createdAt;
    if (!ts) { buckets.earlier.push(job); continue; }
    const t = new Date(ts).getTime();
    if (t >= startOfToday) buckets.today.push(job);
    else if (t >= startOfYesterday) buckets.yesterday.push(job);
    else if (t >= startOfThisWeek) buckets.thisWeek.push(job);
    else buckets.earlier.push(job);
  }

  // Stable date label for Today / Yesterday.
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const order: TimeBucket[] = [
    { key: 'today', label: 'Today', dateLabel: fmt(new Date(startOfToday)), jobs: buckets.today },
    { key: 'yesterday', label: 'Yesterday', dateLabel: fmt(new Date(startOfYesterday)), jobs: buckets.yesterday },
    { key: 'thisWeek', label: 'This week', jobs: buckets.thisWeek },
    { key: 'earlier', label: 'Earlier', jobs: buckets.earlier },
  ];
  return order.filter(b => b.jobs.length > 0);
}

/**
 * Compact time label for individual rows. Today → HH:MM. Earlier → DD MMM.
 */
export function formatRowTime(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startOfToday) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
