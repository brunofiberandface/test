'use client';

import { useEffect, useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Shell from '@/components/Shell';

interface Job {
  id: string;
  jobId?: string;
  jobName?: string;
  status: string;
  focusName?: string;
  focusDesignNumber?: string;
  focusDesignName?: string;
  focusCategory?: string;
  focusFitModelFrontUrl?: string;
  modelName?: string;
  modelId?: string;
  jobNumber?: number;
  createdAt: string;
  updatedAt?: string;
  creatorEmail?: string;
  archived?: boolean;
  queuePosition?: number;
  approvedCount?: number;
  preApprovedCount?: number;
  doneCount?: number;
  totalShots?: number;
  approvedShots?: Array<{ shotId: string; shotType: string; imageUrl?: string; wasApproved?: boolean }>;
}

interface QueueState {
  activeJobId: string | null;
  activeJobName: string | null;
  activeStartedAt: string | null;
  queue: Array<{ jobId: string; jobName: string; queuedAt: string }>;
}

const STATUS_LABEL: Record<string, string> = {
  uploading: 'Uploading',
  generating: 'Generating',
  queued: 'Queued',
  review: 'In Review',
  complete: 'Complete',
  completed: 'Complete',
  done: 'Complete',
  failed: 'Failed',
};

const STATUS_STYLES: Record<string, string> = {
  uploading: 'bg-neutral-100 text-neutral-600',
  generating: 'bg-amber-50 text-amber-700',
  queued: 'bg-orange-50 text-orange-700',
  review: 'bg-blue-50 text-blue-700',
  complete: 'bg-green-50 text-green-700',
  completed: 'bg-green-50 text-green-700',
  done: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-700',
};

function formatDate(isoString: string | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short' });
  } catch {
    return '—';
  }
}

function formatDateTime(isoString: string | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '—';
    // Format: "17 May 00:00"
    return d.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

/**
 * Lightweight in-dashboard preview of a job — fetches the job's shots and
 * focus front 0° image, renders them in a centered modal so the user can
 * peek without leaving the dashboard. Bruno 2026-05-07: opening every job
 * in a new tab to glance at output is friction.
 */
function JobPreviewPopup({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<{ job: any; shots: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/jobs/${jobId}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(e => { if (!cancelled) { setErr(String(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [jobId]);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Stable ordering for the shot grid
  const SHOT_ORDER = ['M01', 'M02', 'M03', 'M04', 'M05', 'M06'];
  const sortedShots = (data?.shots || []).slice().sort((a, b) => {
    const ai = SHOT_ORDER.indexOf(a.shotType || a.type);
    const bi = SHOT_ORDER.indexOf(b.shotType || b.type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="bg-white max-w-5xl w-full max-h-[90vh] overflow-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-6 py-4 flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-neutral-900 truncate">
              {data?.job?.jobName || data?.job?.designNumber || jobId}
            </h2>
            {data?.job?.focusDesignNumber && (
              <p className="text-xs text-neutral-500 truncate">
                {data.job.focusDesignNumber} {data.job.focusDesignName ? `— ${data.job.focusDesignName}` : ''}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            <button
              onClick={() => router.push(`/jobs/${jobId}/results`)}
              className="text-xs px-3 py-1.5 bg-neutral-900 text-white hover:bg-neutral-700 transition-colors"
            >
              Open job page
            </button>
            <button
              onClick={onClose}
              className="text-neutral-400 hover:text-neutral-700 p-1"
              title="Close (Esc)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
            </div>
          )}
          {err && <p className="text-sm text-red-600">{err}</p>}
          {!loading && !err && data && (
            <div className="flex gap-6">
              {/* Original (focus front 0°) */}
              {data.job.focusFitModelFrontUrl && (
                <div className="flex-shrink-0">
                  <div className="w-48 h-64 bg-neutral-100 border border-neutral-200 overflow-hidden">
                    <img src={data.job.focusFitModelFrontUrl} alt="Original" className="w-full h-full object-contain" />
                  </div>
                  <p className="text-xs text-neutral-500 mt-2 text-center uppercase tracking-wider">Original</p>
                </div>
              )}
              {/* Shots grid */}
              <div className="flex-1 min-w-0">
                {sortedShots.length === 0 ? (
                  <p className="text-sm text-neutral-400">No shots yet.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {sortedShots.map((s: any) => {
                      const url = s.greyMasterUrl || s.imageUrl;
                      const status = s.status || 'pending';
                      return (
                        <div key={s.id || s.shotId} className="border border-neutral-200">
                          <div className="aspect-[3/4] bg-neutral-100 relative">
                            {url ? (
                              <img src={url} alt={s.shotType} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-neutral-400 capitalize">
                                {status}
                              </div>
                            )}
                          </div>
                          <p className="text-[10px] px-2 py-1 text-neutral-600 uppercase tracking-wider">
                            {s.shotType || s.type}
                            {s.variant && s.variant !== 'A' ? `-${s.variant}` : ''}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const sessionAny = session as any;
  const user = session?.user
    ? { email: session.user.email || '', name: session.user.name || '', role: (sessionAny?.role as 'admin' | 'creator') || 'admin' }
    : undefined;
  const isAdmin = user?.role === 'admin';

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [queueState, setQueueState] = useState<QueueState | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [archivedCount, setArchivedCount] = useState<number>(0);
  // Pagination state — first page loads 50 newest; "Load more" appends the
  // next 50 using cursor-based pagination (Firestore startAfter on createdAt).
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  // True once we've fetched the whole collection (triggered when a search
  // filter goes active). Prevents redundant full-loads on subsequent filter
  // changes within the same dashboard session.
  const [allJobsLoaded, setAllJobsLoaded] = useState<boolean>(false);
  // DB-wide stats — fetched from /api/jobs/counts so the header + chip
  // numbers reflect the entire collection, not just the loaded page.
  const [dbCounts, setDbCounts] = useState<{ total: number; generating: number; review: number; completed: number; archived: number } | null>(null);

  // Inline edit state
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Action state
  const [cloning, setCloning] = useState<string | null>(null);
  // Inline job preview popup — show shots without leaving the dashboard.
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  // Thumbnail lightbox — when user clicks the small original-fit-model
  // thumbnail in the table, enlarge it to 3× in a centered modal.
  const [enlargedThumbUrl, setEnlargedThumbUrl] = useState<string | null>(null);
  // User filter (Bruno 2026-05-07): 'all' | <email>
  const [creatorFilter, setCreatorFilter] = useState<string>('all');
  // Additional filters (Bruno 2026-05-12): name (first-2-words substring),
  // design number (substring), focus slot ('all' | 'top' | 'bottom' | 'shoe').
  // All four filters combine (AND) with status + creator above.
  const [nameFilter, setNameFilter] = useState<string>('');
  const [designFilter, setDesignFilter] = useState<string>('');
  const [focusFilter, setFocusFilter] = useState<string>('all');
  const [archiveConfirm, setArchiveConfirm] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const initializedRef = useRef(false);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Map of modelId → reference image URL — used to render the small model
  // thumbnail in the MODEL column (next to the name) on each job row. Fetched
  // once on mount; the model roster doesn't change often enough to warrant a
  // refresh interval. Falls back gracefully (no thumbnail) when the model has
  // no `referenceImageUrl` (legacy models that only had `cardImageUrl`).
  const [modelThumbs, setModelThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/');
      return;
    }
    if (authStatus === 'authenticated') {
      fetchJobs(filter === 'archived');
      fetchQueue();
      fetchCounts();
      // Fire-and-forget — empty map is safe (cells just render as text).
      fetch('/api/models')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (!data?.models) return;
          const map: Record<string, string> = {};
          for (const m of data.models as Array<{ modelId?: string; id?: string; referenceImageUrl?: string; cardImageUrl?: string }>) {
            const id = (m.modelId || m.id || '').trim();
            const url = m.referenceImageUrl || m.cardImageUrl;
            if (id && url) map[id] = url;
          }
          setModelThumbs(map);
        })
        .catch(() => { /* non-blocking */ });
      const queueInterval = setInterval(fetchQueue, 10000);
      initializedRef.current = true;
      return () => clearInterval(queueInterval);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  // Auto-refresh when there are active jobs
  useEffect(() => {
    const hasActiveJobs = jobs.some(j => {
      const s = j.status?.toLowerCase();
      return s === 'generating' || s === 'queued';
    });
    if (hasActiveJobs && authStatus === 'authenticated') {
      if (!refreshRef.current) {
        refreshRef.current = setInterval(() => fetchJobs(filter === 'archived', true), 15000);
      }
    } else {
      if (refreshRef.current) { clearInterval(refreshRef.current); refreshRef.current = null; }
    }
    return () => { if (refreshRef.current) { clearInterval(refreshRef.current); refreshRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, authStatus]);

  // Refetch when switching to/from archived
  const prevFilterRef = useRef(filter);
  useEffect(() => {
    const wasArchived = prevFilterRef.current === 'archived';
    const isArchived = filter === 'archived';
    prevFilterRef.current = filter;
    if (wasArchived !== isArchived && initializedRef.current) fetchJobs(isArchived);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Clear selection on filter change
  useEffect(() => { setSelected(new Set()); setBatchDeleteConfirm(false); }, [filter]);

  // Auto-load the entire jobs collection when ANY search filter goes
  // active. Search should match against the full DB, not the currently-
  // paginated slice. Idempotent — allJobsLoaded guards against re-fetch
  // on subsequent keystrokes within the same session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const searchActive = !!(nameFilter.trim() || designFilter.trim() || creatorFilter !== 'all');
    if (searchActive && !allJobsLoaded && authStatus === 'authenticated') {
      fetchAllJobs(filter === 'archived');
    }
  }, [nameFilter, designFilter, creatorFilter, authStatus]);

  async function fetchQueue() {
    try {
      const res = await fetch('/api/queue');
      if (res.ok) setQueueState(await res.json());
    } catch { /* non-blocking */ }
  }

  /** Pull DB-wide counts (total + per-status + archived). Refreshed on
   *  initial load + after batch mutations (delete/archive). Survives
   *  pagination since the numbers come from Firestore aggregate count(),
   *  not the loaded jobs slice. */
  async function fetchCounts() {
    try {
      const res = await fetch('/api/jobs/counts');
      if (res.ok) setDbCounts(await res.json());
    } catch { /* non-blocking */ }
  }

  /** Fetch the entire jobs collection (capped at 5000 server-side) in one
   *  call. Triggered when the user activates a search filter — search must
   *  match against the full DB, not the currently-paginated slice. Idempotent
   *  via the allJobsLoaded flag; subsequent search edits in the same session
   *  filter client-side over the already-loaded full set. */
  async function fetchAllJobs(inclArchived = false) {
    if (allJobsLoaded) return;
    setLoadingMore(true);  // shares the same spinner as "Load more"
    try {
      const params = new URLSearchParams();
      if (inclArchived) params.set('includeArchived', 'true');
      params.set('fetchAll', 'true');
      const res = await fetch(`/api/jobs?${params.toString()}`, {
        headers: { 'x-user-email': session?.user?.email || '' },
      });
      if (!res.ok) throw new Error('Failed to fetch all jobs');
      const data = await res.json();
      setJobs(data.jobs || []);
      setHasMore(false);   // we have everything
      setNextCursor(null);
      setAllJobsLoaded(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function fetchJobs(inclArchived = false, isBackground = false) {
    // Only show the spinner on the INITIAL load. Background polls
    // (every 15s while there are active jobs, or the filter-switch
    // refetch) keep the existing table on screen so img tags don't
    // unmount + re-fetch with every poll. Without this, the dashboard
    // flickers and every thumbnail re-downloads on each poll.
    if (!isBackground) setLoading(true);
    try {
      const url = inclArchived ? '/api/jobs?includeArchived=true' : '/api/jobs';
      const res = await fetch(url, { headers: { 'x-user-email': session?.user?.email || '' } });
      if (!res.ok) throw new Error('Failed to load jobs');
      const data = await res.json();
      setJobs(data.jobs || []);
      // Capture pagination state from the API. The first-page response now
      // carries hasMore + nextCursor; "Load more" button uses these.
      setHasMore(Boolean(data.hasMore));
      setNextCursor(data.nextCursor ?? null);
      if (inclArchived) setArchivedCount((data.jobs || []).filter((j: Job) => j.archived === true).length);
      if (!inclArchived) {
        const arRes = await fetch('/api/jobs?includeArchived=true');
        if (arRes.ok) {
          const arData = await arRes.json();
          setArchivedCount((arData.jobs || []).filter((j: Job) => j.archived === true).length);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /** Append the next 50 older jobs using cursor pagination. The cursor is
   *  the createdAt-ms of the last job currently in the list; the API uses
   *  Firestore startAfter() to fetch the page that follows it. Maintains
   *  archived-filter parity with fetchJobs. */
  async function loadMoreJobs(inclArchived = false) {
    if (!hasMore || loadingMore || nextCursor == null) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (inclArchived) params.set('includeArchived', 'true');
      params.set('cursor', String(nextCursor));
      const res = await fetch(`/api/jobs?${params.toString()}`, {
        headers: { 'x-user-email': session?.user?.email || '' },
      });
      if (!res.ok) throw new Error('Failed to load more jobs');
      const data = await res.json();
      const newJobs: Job[] = data.jobs || [];
      // Append, dedupe by id in case of concurrent writes / overlap.
      setJobs(prev => {
        const seen = new Set(prev.map(j => j.jobId || j.id));
        return [...prev, ...newJobs.filter(j => !seen.has(j.jobId || j.id))];
      });
      setHasMore(Boolean(data.hasMore));
      setNextCursor(data.nextCursor ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function saveJobName(jobId: string, newName: string) {
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobName: newName }),
      });
      if (res.ok) setJobs(prev => prev.map(j => (j.jobId || j.id) === jobId ? { ...j, jobName: newName } : j));
    } catch { /* non-blocking */ }
    setEditingJobId(null);
  }

  async function cloneJob(e: React.MouseEvent, jobId: string) {
    e.preventDefault(); e.stopPropagation();
    setCloning(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}/clone`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        await fetchJobs(filter === 'archived');
        router.push(`/jobs/${data.jobId}/results`);
      }
    } catch { /* */ } finally { setCloning(null); }
  }

  async function handleArchive(e: React.MouseEvent, jobId: string, archived: boolean) {
    e.preventDefault(); e.stopPropagation();
    try {
      await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
      setArchiveConfirm(null);
      await fetchJobs(filter === 'archived');
    } catch { /* */ }
  }

  async function handleDeleteSingle(e: React.MouseEvent, jobId: string) {
    e.preventDefault(); e.stopPropagation();
    setDeleting(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleteConfirm(null);
        setSelected(prev => { const n = new Set(prev); n.delete(jobId); return n; });
        await fetchJobs(filter === 'archived');
      }
    } catch { /* */ } finally { setDeleting(false); }
  }

  async function handleBatchDelete() {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/jobs/batch-delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: Array.from(selected) }),
      });
      if (res.ok) { setSelected(new Set()); setBatchDeleteConfirm(false); await fetchJobs(filter === 'archived'); }
    } catch { /* */ } finally { setDeleting(false); }
  }

  function toggleSelect(jobId: string) {
    setSelected(prev => { const n = new Set(prev); if (n.has(jobId)) n.delete(jobId); else n.add(jobId); return n; });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(j => j.jobId || j.id)));
  }

  const FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'generating', label: 'Generating' },
    { value: 'review', label: 'In Review' },
    { value: 'complete', label: 'Complete' },
    { value: 'failed', label: 'Failed' },
    { value: 'archived', label: 'Archived' },
  ];

  const statusFiltered = filter === 'archived'
    ? jobs.filter(j => j.archived === true)
    : filter === 'all'
      ? jobs
      : jobs.filter(j => {
          const s = j.status?.toLowerCase();
          if (filter === 'complete') return s === 'complete' || s === 'completed' || s === 'done';
          if (filter === 'generating') return s === 'generating' || s === 'queued' || s === 'uploading';
          return s === filter;
        });

  // Apply user filter on top of status filter
  const creatorFiltered = creatorFilter === 'all'
    ? statusFiltered
    : statusFiltered.filter(j => (j.creatorEmail || '') === creatorFilter);

  // Name filter — matches the search query against only the FIRST TWO WORDS
  // of each job's jobName (case-insensitive substring). So "kate" / "kate
  // boyfriend" finds "Kate Boyfriend Jeans 53"; "53" / "jeans" do NOT
  // (they're past the second word). Empty filter passes everything.
  const nameQuery = nameFilter.trim().toLowerCase();
  const nameFiltered = !nameQuery
    ? creatorFiltered
    : creatorFiltered.filter(j => {
        const firstTwo = (j.jobName || '').split(/\s+/).slice(0, 2).join(' ').toLowerCase();
        return firstTwo.includes(nameQuery);
      });

  // Design-number filter — case-insensitive substring match against focusDesignNumber.
  const designQuery = designFilter.trim().toLowerCase();
  const designFiltered = !designQuery
    ? nameFiltered
    : nameFiltered.filter(j => (j.focusDesignNumber || '').toLowerCase().includes(designQuery));

  // Focus-slot filter — matches the wardrobe slot flagged as focus. Job
  // surfaces this as `focusCategory` ('top' | 'bottom' | 'shoes').
  const filtered = focusFilter === 'all'
    ? designFiltered
    : designFiltered.filter(j => {
        const cat = (j.focusCategory || '').toLowerCase();
        if (focusFilter === 'shoe') return cat === 'shoe' || cat === 'shoes';
        return cat === focusFilter;
      });

  // List of distinct creator emails across all jobs (for the filter dropdown).
  // Sorted, deduplicated, empty strings dropped.
  const creators = Array.from(
    new Set(jobs.map(j => j.creatorEmail).filter((e): e is string => !!e))
  ).sort();

  const countFor = (filterVal: string) => {
    if (filterVal === 'archived') return archivedCount;
    return jobs.filter(j => {
      const s = j.status?.toLowerCase();
      if (filterVal === 'complete') return s === 'complete' || s === 'completed';
      if (filterVal === 'generating') return s === 'generating' || s === 'queued' || s === 'uploading';
      return s === filterVal;
    }).length;
  };

  const activeJobs = jobs.filter(j => !j.archived);
  // Stats prefer DB-wide counts (from /api/jobs/counts) when available so
  // the numbers reflect the full database, not the currently-paginated slice.
  // Falls back to local counts during initial load (counts request in flight).
  const stats = dbCounts ?? {
    total: activeJobs.length,
    generating: activeJobs.filter(j => j.status === 'generating' || j.status === 'uploading' || j.status === 'queued').length,
    review: activeJobs.filter(j => j.status === 'review').length,
    completed: activeJobs.filter(j => j.status === 'complete' || j.status === 'completed').length,
  };

  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  return (
    <Shell user={user}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Dashboard</h1>
          <p className="text-sm text-neutral-500 mt-1">{stats.total} active jobs</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Bulk hard-delete bar — admin only, ONLY on the Archived tab.
              Active rows use individual "Delete" (which archives, not hard-
              deletes); a bulk archive isn't surfaced yet. If we need one, add
              a separate "Archive selected" button mirroring this. */}
          {isAdmin && filter === 'archived' && selected.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-600">{selected.size} selected</span>
              {!batchDeleteConfirm ? (
                <button onClick={() => setBatchDeleteConfirm(true)}
                  className="text-xs border border-red-300 px-3 py-1.5 text-red-600 hover:bg-red-50 transition-colors font-medium">
                  Delete selected (permanent)
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-red-600 font-medium">Delete {selected.size} job{selected.size > 1 ? 's' : ''} permanently?</span>
                  <button onClick={handleBatchDelete} disabled={deleting}
                    className="text-xs px-3 py-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 font-medium">
                    {deleting ? 'Deleting...' : 'Confirm'}
                  </button>
                  <button onClick={() => setBatchDeleteConfirm(false)}
                    className="text-xs px-2 py-1 border border-neutral-300 text-neutral-600 hover:bg-neutral-50">Cancel</button>
                </div>
              )}
              <button onClick={() => { setSelected(new Set()); setBatchDeleteConfirm(false); }}
                className="text-xs text-neutral-400 hover:text-neutral-600 ml-1">Clear</button>
            </div>
          )}
          <Link href="/jobs/new"
            className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors">
            New Job
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'TOTAL JOBS', value: stats.total },
          { label: 'GENERATING', value: stats.generating },
          { label: 'IN REVIEW', value: stats.review },
          { label: 'COMPLETED', value: stats.completed },
        ].map(stat => (
          <div key={stat.label} className="border border-neutral-200 bg-white p-5">
            <p className="text-xs text-neutral-500 uppercase tracking-wider">{stat.label}</p>
            <p className="text-2xl font-bold text-neutral-900 mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Generation Queue */}
      {(queueState?.activeJobId || (queueState?.queue && queueState.queue.length > 0)) && (
        <div className="border border-neutral-200 bg-white mb-8">
          <div className="px-5 py-3 border-b border-neutral-200">
            <h2 className="text-sm font-medium text-neutral-900">Generation Queue</h2>
          </div>
          {queueState?.activeJobId && (
            <div className="px-5 py-3 flex items-center gap-3 border-b border-neutral-100 bg-amber-50/50">
              <div className="w-3 h-3 border-2 border-amber-300 border-t-amber-700 rounded-full animate-spin flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <Link href={`/jobs/${queueState.activeJobId}/results`} className="text-sm font-medium text-neutral-900 hover:underline">
                  {queueState.activeJobName || queueState.activeJobId}
                </Link>
                <span className="text-xs text-amber-700 ml-2">Generating now</span>
              </div>
              {queueState.activeStartedAt && (
                <span className="text-xs text-neutral-400 flex-shrink-0">
                  started {new Date(queueState.activeStartedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          )}
          {queueState?.queue && queueState.queue.length > 0 && queueState.queue.map((entry, idx) => (
            <div key={entry.jobId} className="px-5 py-3 flex items-center gap-3 border-b border-neutral-50">
              <span className="text-xs font-mono text-neutral-400 w-6 text-right flex-shrink-0">#{idx + 1}</span>
              <Link href={`/jobs/${entry.jobId}/results`} className="text-sm text-neutral-700 hover:underline flex-1 min-w-0 truncate">
                {entry.jobName || entry.jobId}
              </Link>
              <span className="text-xs text-neutral-400 flex-shrink-0">waiting</span>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs + user filter */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button key={f.value} onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f.value ? 'bg-neutral-900 text-white' : 'border border-neutral-300 text-neutral-500 hover:bg-neutral-50'
              }`}>
              {f.label}
              {f.value !== 'all' && <span className="ml-1.5 opacity-60">{countFor(f.value)}</span>}
            </button>
          ))}
        </div>
        {creators.length > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-neutral-500 uppercase tracking-wider">Created by</span>
            <select
              value={creatorFilter}
              onChange={(e) => setCreatorFilter(e.target.value)}
              className="px-2 py-1.5 text-xs border border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400 focus:outline-none focus:border-neutral-900"
            >
              <option value="all">All users ({creators.length})</option>
              {creators.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Secondary filters (Bruno 2026-05-12): name, design number, focus slot.
          Combine (AND) with status + creator filters above. */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <input
          type="text"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          placeholder="Filter by job name (first 2 words)"
          className="px-3 py-1.5 text-xs border border-neutral-300 bg-white text-neutral-700 placeholder-neutral-400 hover:border-neutral-400 focus:outline-none focus:border-neutral-900 w-64"
        />
        <input
          type="text"
          value={designFilter}
          onChange={(e) => setDesignFilter(e.target.value)}
          placeholder="Filter by design number"
          className="px-3 py-1.5 text-xs border border-neutral-300 bg-white text-neutral-700 placeholder-neutral-400 hover:border-neutral-400 focus:outline-none focus:border-neutral-900 w-56"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500 uppercase tracking-wider">Focus</span>
          <select
            value={focusFilter}
            onChange={(e) => setFocusFilter(e.target.value)}
            className="px-2 py-1.5 text-xs border border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400 focus:outline-none focus:border-neutral-900"
          >
            <option value="all">All</option>
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
            <option value="shoe">Shoes</option>
          </select>
        </div>
        {(nameFilter || designFilter || focusFilter !== 'all') && (
          <button
            onClick={() => { setNameFilter(''); setDesignFilter(''); setFocusFilter('all'); }}
            className="px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-900 underline"
            title="Clear name, design, and focus filters"
          >
            Clear filters
          </button>
        )}
        <span className="text-xs text-neutral-400 ml-auto">{filtered.length} of {statusFiltered.length} jobs match</span>
      </div>

      {/* Jobs table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="px-5 py-12 text-center text-sm text-red-500">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-neutral-400 text-sm mb-3">
            {filter === 'all' ? 'No jobs yet.' : filter === 'archived' ? 'No archived jobs.' : `No ${filter} jobs.`}
          </p>
          {filter === 'all' && <Link href="/jobs/new" className="text-sm text-neutral-900 underline">Create your first job</Link>}
        </div>
      ) : (
        <div className="border border-neutral-200 bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50">
                {isAdmin && (
                  <th className="w-10 px-3 py-2.5">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                      className="w-3.5 h-3.5 accent-neutral-900 cursor-pointer" />
                  </th>
                )}
                <th className="text-left px-3 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Original</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Job Name</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Design</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Category</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Model</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Created by</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Created</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Last rerun</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(job => {
                const jobId = job.jobId || job.id;
                const statusKey = job.status?.toLowerCase() || 'generating';
                const isArchived = job.archived === true;
                const isSelected = selected.has(jobId);
                return (
                  <tr key={jobId}
                    className={`border-b border-neutral-50 transition-colors ${
                      isSelected ? 'bg-blue-50/50' : isArchived ? 'bg-neutral-50 opacity-70' : 'hover:bg-neutral-50'
                    }`}>
                    {isAdmin && (
                      <td className="w-10 px-3 py-3">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(jobId)}
                          className="w-3.5 h-3.5 accent-neutral-900 cursor-pointer" />
                      </td>
                    )}
                    <td className="px-3 py-3 align-top">
                      {job.focusFitModelFrontUrl ? (
                        <button
                          type="button"
                          onClick={e => { e.preventDefault(); e.stopPropagation(); setEnlargedThumbUrl(job.focusFitModelFrontUrl!); }}
                          className="w-14 h-20 bg-neutral-100 border border-neutral-200 overflow-hidden hover:border-neutral-400 transition-colors cursor-zoom-in block"
                          title="Click to enlarge"
                        >
                          <img src={job.focusFitModelFrontUrl} alt="Original" className="w-full h-full object-contain" loading="lazy" decoding="async" />
                        </button>
                      ) : (
                        <div className="w-14 h-20 bg-neutral-50 border border-neutral-100" />
                      )}
                    </td>
                    <td className="px-5 py-3 align-top">
                      {editingJobId === jobId ? (
                        <input type="text" value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => saveJobName(jobId, editValue)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveJobName(jobId, editValue);
                            if (e.key === 'Escape') setEditingJobId(null);
                          }}
                          autoFocus
                          className="text-sm font-medium text-neutral-900 border border-neutral-300 px-2 py-1 w-full outline-none focus:border-neutral-500" />
                      ) : (
                        <div>
                          <div className="flex items-center gap-2 group">
                            <Link href={`/jobs/${jobId}/results`} className="text-sm font-medium text-neutral-900 hover:underline">
                              {job.jobName || <span className="text-neutral-400 font-normal italic">Untitled</span>}
                            </Link>
                            <button onClick={e => { e.preventDefault(); e.stopPropagation(); setEditingJobId(jobId); setEditValue(job.jobName || ''); }}
                              className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-600 transition-opacity" title="Edit job name">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                              </svg>
                            </button>
                          </div>
                          {/* Approved + pre-approved deliverable thumbnails —
                              listed under the job name so the reviewer can see
                              the approved set grow as they work through the
                              job. Pre-approved (was approved before a rerun,
                              not yet re-approved) gets an amber border to flag
                              "needs re-confirmation". */}
                          {job.approvedShots && job.approvedShots.length > 0 && (
                            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                              {job.approvedShots.map(s => (
                                s.imageUrl ? (
                                  <button
                                    key={s.shotId}
                                    type="button"
                                    onClick={e => { e.preventDefault(); e.stopPropagation(); setEnlargedThumbUrl(s.imageUrl!); }}
                                    className={`w-8 h-10 bg-neutral-100 overflow-hidden transition-colors block border-2 ${s.wasApproved ? 'border-amber-500 hover:border-amber-600' : 'border-neutral-200 hover:border-neutral-400'}`}
                                    title={s.wasApproved ? `${s.shotType} — PRE-APPROVED (re-approve in the job results)` : `${s.shotType} — approved · click to enlarge`}
                                  >
                                    <img src={s.imageUrl} alt={s.shotType} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                                  </button>
                                ) : null
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {job.focusDesignNumber ? (
                        <div>
                          <p className="text-sm text-neutral-900 font-medium">{job.focusDesignNumber}</p>
                          <p className="text-xs text-neutral-400">{job.focusDesignName || ''}</p>
                        </div>
                      ) : (
                        <span className="text-sm text-neutral-500">{job.focusName || '—'}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-sm text-neutral-600 capitalize">{job.focusCategory || '—'}</td>
                    <td className="px-5 py-3 text-sm text-neutral-600">
                      {(() => {
                        const thumb = job.modelId ? modelThumbs[job.modelId] : undefined;
                        const name = job.modelName || job.modelId || '—';
                        if (!thumb) {
                          return <span>{name}</span>;
                        }
                        return (
                          <div className="flex items-center gap-2">
                            <img
                              src={thumb}
                              alt={name}
                              className="w-8 h-12 object-cover bg-neutral-100 border border-neutral-200 flex-shrink-0"
                              loading="lazy"
                              decoding="async"
                            />
                            <span className="truncate">{name}</span>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-5 py-3 text-sm text-neutral-600 truncate max-w-[180px]" title={job.creatorEmail || ''}>{job.creatorEmail || '—'}</td>
                    <td className="px-5 py-3 text-sm whitespace-nowrap">
                      <div className="text-neutral-400 whitespace-nowrap">{formatDateTime(job.createdAt)}</div>
                      {job.jobNumber != null && (
                        <div className="text-neutral-700 font-medium whitespace-nowrap">#{job.jobNumber}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-sm whitespace-nowrap">
                      <div className="text-neutral-400 whitespace-nowrap">{formatDateTime(job.updatedAt)}</div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex text-xs px-2 py-0.5 font-medium ${STATUS_STYLES[statusKey] || STATUS_STYLES.generating}`}>
                        {statusKey === 'queued' && job.queuePosition
                          ? `Queued #${job.queuePosition}`
                          : statusKey === 'review' && job.totalShots
                            ? `In Review ${job.approvedCount ?? 0}/${job.totalShots}${job.preApprovedCount ? ` · ${job.preApprovedCount} pre-approved` : ''}`
                            : statusKey === 'generating' && job.totalShots
                              ? `Generating ${job.doneCount ?? 0}/${job.totalShots}`
                              : STATUS_LABEL[statusKey] || job.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Eye / Preview — opens an in-dashboard popup with the
                            job's shots so the user can scan results without
                            navigating off the dashboard. Bruno 2026-05-07. */}
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPreviewJobId(jobId); }}
                          className="text-neutral-400 hover:text-neutral-900 p-1 transition-colors"
                          title="Preview job"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                        {/* Clone — everyone, on non-archived rows */}
                        {!isArchived && (
                          <button onClick={e => cloneJob(e, jobId)} disabled={cloning === jobId}
                            className="text-xs border border-neutral-300 px-3 py-1 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 transition-colors">
                            {cloning === jobId ? '...' : 'Clone'}
                          </button>
                        )}

                        {/* TIERED DELETE (Bruno 2026-05-12):
                            • Active row: anyone (admin + user) clicks Delete → archives (soft, recoverable).
                            • Archived row: admin clicks Delete → hard-deletes (permanent).
                            • Users have NO action on archived rows.
                            The Delete label is reused on both states but the consequence
                            differs by state — confirmation copy distinguishes them.
                        */}

                        {/* ACTIVE: Delete = move to archive (everyone) */}
                        {!isArchived && archiveConfirm !== jobId && (
                          <button onClick={() => setArchiveConfirm(jobId)}
                            className="text-xs border border-red-200 px-3 py-1 text-red-400 hover:text-red-600 hover:border-red-400 transition-colors">
                            Delete
                          </button>
                        )}
                        {!isArchived && archiveConfirm === jobId && (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-neutral-600">Move to archive?</span>
                            <button onClick={e => handleArchive(e, jobId, true)}
                              className="text-xs px-2 py-0.5 bg-neutral-900 text-white hover:bg-neutral-700">Yes</button>
                            <button onClick={() => setArchiveConfirm(null)}
                              className="text-xs px-2 py-0.5 border border-neutral-300 text-neutral-600 hover:bg-neutral-50">✕</button>
                          </div>
                        )}

                        {/* ARCHIVED, admin only: Unarchive */}
                        {isAdmin && isArchived && (
                          <button onClick={e => handleArchive(e, jobId, false)}
                            className="text-xs border border-neutral-300 px-3 py-1 text-neutral-500 hover:bg-neutral-50 transition-colors">
                            Unarchive
                          </button>
                        )}

                        {/* ARCHIVED, admin only: Delete = permanent hard delete */}
                        {isAdmin && isArchived && deleteConfirm !== jobId && (
                          <button onClick={() => { setDeleteConfirm(jobId); setArchiveConfirm(null); }}
                            className="text-xs border border-red-200 px-3 py-1 text-red-400 hover:text-red-600 hover:border-red-400 transition-colors">
                            Delete
                          </button>
                        )}
                        {isAdmin && isArchived && deleteConfirm === jobId && (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-red-600">Permanent!</span>
                            <button onClick={e => handleDeleteSingle(e, jobId)} disabled={deleting}
                              className="text-xs px-2 py-0.5 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                              {deleting ? '...' : 'Delete'}
                            </button>
                            <button onClick={() => setDeleteConfirm(null)}
                              className="text-xs px-2 py-0.5 border border-neutral-300 text-neutral-600 hover:bg-neutral-50">✕</button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Pagination — "Load more" appends the next 50 older jobs via
              cursor-based pagination. Hidden when no more rows or while
              the initial load is in flight. Matches the archived-filter
              state so loadMore keeps the same scope as the current view. */}
          {hasMore && !loading && (
            <div className="flex justify-center py-6 border-t border-neutral-200">
              <button
                onClick={() => loadMoreJobs(filter === 'archived')}
                disabled={loadingMore}
                className="text-xs font-medium uppercase tracking-wider px-4 py-2 border border-neutral-300 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingMore
                  ? 'Loading…'
                  : `Load more (showing ${jobs.length})`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Inline job-preview popup */}
      {previewJobId && (
        <JobPreviewPopup jobId={previewJobId} onClose={() => setPreviewJobId(null)} />
      )}

      {/* Thumbnail lightbox — when a small thumbnail in the table is clicked,
          enlarge it ~3× in a centered modal. ESC or click-outside closes. */}
      {enlargedThumbUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setEnlargedThumbUrl(null)}
          onKeyDown={e => { if (e.key === 'Escape') setEnlargedThumbUrl(null); }}
          tabIndex={-1}
        >
          <div className="bg-white p-2" onClick={e => e.stopPropagation()}>
            <img
              src={enlargedThumbUrl}
              alt="Enlarged thumbnail"
              className="block max-h-[85vh] w-auto h-auto"
              style={{ maxWidth: 'min(85vw, 540px)' }}
            />
          </div>
          <button
            onClick={() => setEnlargedThumbUrl(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2"
            title="Close (Esc)"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </Shell>
  );
}
