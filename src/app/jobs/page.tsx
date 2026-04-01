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
  designNumber: string;
  status: string;
  garmentCategory: string;
  modelIds: string[];
  createdAt: string;
  updatedAt?: string;
  creatorEmail?: string;
  archived?: boolean;
  queuePosition?: number;
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
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

export default function JobsPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionAny = session as any;
  const user = session?.user
    ? { email: session.user.email || '', name: session.user.name || '', role: (sessionAny?.role as 'admin' | 'creator') || 'creator' }
    : { email: '', name: '', role: 'creator' as const };
  const isAdmin = user.role === 'admin';

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [archivedCount, setArchivedCount] = useState<number>(0);
  const [cloning, setCloning] = useState<string | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<string | null>(null);

  // Selection state for batch operations
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null); // single delete
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Track whether we've initialized so we don't double-fetch on mount
  const initializedRef = useRef(false);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/');
      return;
    }
    if (authStatus === 'authenticated') {
      fetchJobs(filter === 'archived');
      initializedRef.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  // Auto-refresh job list every 15s when there are active/queued jobs
  useEffect(() => {
    const hasActiveJobs = jobs.some(j => {
      const s = j.status?.toLowerCase();
      return s === 'generating' || s === 'queued';
    });

    if (hasActiveJobs && authStatus === 'authenticated') {
      if (!refreshRef.current) {
        refreshRef.current = setInterval(() => {
          fetchJobs(filter === 'archived');
        }, 15_000);
      }
    } else {
      if (refreshRef.current) {
        clearInterval(refreshRef.current);
        refreshRef.current = null;
      }
    }

    return () => {
      if (refreshRef.current) {
        clearInterval(refreshRef.current);
        refreshRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, authStatus]);

  // Refetch when switching to/from archived tab (needs different API call)
  const prevFilterRef = useRef(filter);
  useEffect(() => {
    const wasArchived = prevFilterRef.current === 'archived';
    const isArchived = filter === 'archived';
    prevFilterRef.current = filter;
    if (wasArchived !== isArchived && initializedRef.current) {
      fetchJobs(isArchived);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Clear selection when filter changes
  useEffect(() => {
    setSelected(new Set());
    setBatchDeleteConfirm(false);
  }, [filter]);

  async function cloneJob(e: React.MouseEvent, jobId: string) {
    e.preventDefault();
    e.stopPropagation();
    setCloning(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}/clone`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        await fetchJobs(filter === 'archived');
        router.push(`/jobs/${data.jobId}/results`);
      }
    } catch (err) {
      console.error('Clone failed:', err);
    } finally {
      setCloning(null);
    }
  }

  async function handleArchive(e: React.MouseEvent, jobId: string, archived: boolean) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
      setArchiveConfirm(null);
      await fetchJobs(filter === 'archived');
    } catch (err) {
      console.error('Archive failed:', err);
    }
  }

  async function handleDeleteSingle(e: React.MouseEvent, jobId: string) {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleteConfirm(null);
        setSelected(prev => { const n = new Set(prev); n.delete(jobId); return n; });
        await fetchJobs(filter === 'archived');
      }
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(false);
    }
  }

  async function handleBatchDelete() {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/jobs/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: Array.from(selected) }),
      });
      if (res.ok) {
        setSelected(new Set());
        setBatchDeleteConfirm(false);
        await fetchJobs(filter === 'archived');
      }
    } catch (err) {
      console.error('Batch delete failed:', err);
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelect(jobId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(j => j.jobId || j.id)));
    }
  }

  async function fetchJobs(inclArchived = false) {
    setLoading(true);
    try {
      const url = inclArchived ? '/api/jobs?includeArchived=true' : '/api/jobs';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
        // If we fetched all jobs (incl. archived), update the archived count
        if (inclArchived) {
          setArchivedCount((data.jobs || []).filter((j: Job) => j.archived === true).length);
        }
      }
      // Always fetch archived count for the badge (lightweight — only needs count)
      if (!inclArchived) {
        const arRes = await fetch('/api/jobs?includeArchived=true');
        if (arRes.ok) {
          const arData = await arRes.json();
          setArchivedCount((arData.jobs || []).filter((j: Job) => j.archived === true).length);
        }
      }
    } catch (e) {
      console.error('Failed to fetch jobs:', e);
    } finally {
      setLoading(false);
    }
  }

  const FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'generating', label: 'Generating' },
    { value: 'review', label: 'In Review' },
    { value: 'complete', label: 'Complete' },
    { value: 'failed', label: 'Failed' },
    { value: 'archived', label: 'Archived' },
  ];

  // When filter === 'archived': jobs contains all (incl. archived), show only archived
  // Otherwise: jobs is already filtered by API (no archived), apply status filter client-side
  const filtered = filter === 'archived'
    ? jobs.filter(j => j.archived === true)
    : filter === 'all'
      ? jobs
      : jobs.filter(j => {
          const s = j.status?.toLowerCase();
          if (filter === 'complete') return s === 'complete' || s === 'completed' || s === 'done';
          if (filter === 'generating') return s === 'generating' || s === 'queued' || s === 'uploading';
          return s === filter;
        });

  // Count for filter badges (non-archived filters use current jobs array)
  const countFor = (filterVal: string) => {
    if (filterVal === 'archived') return archivedCount;
    return jobs.filter(j => {
      const s = j.status?.toLowerCase();
      if (filterVal === 'complete') return s === 'complete' || s === 'completed';
      if (filterVal === 'generating') return s === 'generating' || s === 'queued' || s === 'uploading';
      return s === filterVal;
    }).length;
  };

  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  const GRID = isAdmin
    ? 'grid-cols-[32px_130px_1fr_110px_160px_110px_80px_180px]'
    : 'grid-cols-[130px_1fr_110px_160px_110px_80px_160px]';

  return (
    <Shell user={user}>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Jobs</h1>
          <p className="text-sm text-neutral-500 mt-1">{jobs.filter(j => !j.archived).length} active jobs</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Batch delete bar */}
          {isAdmin && selected.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-600">{selected.size} selected</span>
              {!batchDeleteConfirm ? (
                <button
                  onClick={() => setBatchDeleteConfirm(true)}
                  className="text-xs border border-red-300 px-3 py-1.5 text-red-600 hover:bg-red-50 transition-colors font-medium"
                >
                  Delete selected
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-red-600 font-medium">Delete {selected.size} job{selected.size > 1 ? 's' : ''} permanently?</span>
                  <button
                    onClick={handleBatchDelete}
                    disabled={deleting}
                    className="text-xs px-3 py-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 font-medium"
                  >
                    {deleting ? 'Deleting...' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setBatchDeleteConfirm(false)}
                    className="text-xs px-2 py-1 border border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                  >
                    Cancel
                  </button>
                </div>
              )}
              <button
                onClick={() => { setSelected(new Set()); setBatchDeleteConfirm(false); }}
                className="text-xs text-neutral-400 hover:text-neutral-600 ml-1"
              >
                Clear
              </button>
            </div>
          )}
          <Link
            href="/jobs/new"
            className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors"
          >
            New Job
          </Link>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-1.5 mb-6 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f.value
                ? 'bg-neutral-900 text-white'
                : 'border border-neutral-300 text-neutral-500 hover:bg-neutral-50'
            }`}
          >
            {f.label}
            {f.value !== 'all' && (
              <span className="ml-1.5 opacity-60">
                {countFor(f.value)}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-neutral-400 text-sm mb-3">
            {filter === 'all' ? 'No jobs yet.' : filter === 'archived' ? 'No archived jobs.' : `No ${filter} jobs.`}
          </p>
          {filter === 'all' && (
            <Link href="/jobs/new" className="text-sm text-neutral-900 underline">
              Create your first job
            </Link>
          )}
        </div>
      ) : (
        <div className="border border-neutral-200 bg-white divide-y divide-neutral-100">
          {/* Header */}
          <div className={`grid ${GRID} gap-4 px-5 py-2.5 bg-neutral-50`}>
            {isAdmin && (
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="w-3.5 h-3.5 accent-neutral-900 cursor-pointer"
                />
              </div>
            )}
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Job Name</span>
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Design</span>
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Category</span>
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Models</span>
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Date</span>
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</span>
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Actions</span>
          </div>

          {filtered.map(job => {
            const jobId = job.jobId || job.id;
            const statusKey = job.status?.toLowerCase() || 'generating';
            const isArchived = job.archived === true;
            const isSelected = selected.has(jobId);
            return (
              <div
                key={jobId}
                className={`grid ${GRID} gap-4 px-5 py-3.5 transition-colors items-center border-t border-neutral-100 ${
                  isSelected ? 'bg-blue-50/50' : isArchived ? 'bg-neutral-50 opacity-70' : 'hover:bg-neutral-50'
                }`}
              >
                {/* Checkbox */}
                {isAdmin && (
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(jobId)}
                      className="w-3.5 h-3.5 accent-neutral-900 cursor-pointer"
                    />
                  </div>
                )}

                {/* Job Name */}
                <span className="text-sm text-neutral-500 truncate" title={job.jobName || ''}>
                  {job.jobName || <span className="text-neutral-300">—</span>}
                </span>

                {/* Design Number */}
                <div>
                  <Link href={`/jobs/${jobId}/results`} className="text-sm font-medium text-neutral-900 hover:underline">
                    {job.designNumber || '—'}
                  </Link>
                </div>

                <span className="text-sm text-neutral-600 capitalize">{job.garmentCategory || '—'}</span>
                <span className="text-sm text-neutral-600">
                  {Array.isArray(job.modelIds) && job.modelIds.length > 0
                    ? job.modelIds.join(', ')
                    : '—'}
                </span>
                <span className="text-sm text-neutral-500">{formatDate(job.updatedAt || job.createdAt)}</span>
                <span className={`inline-flex text-xs px-2 py-0.5 font-medium w-fit ${STATUS_STYLES[statusKey] || STATUS_STYLES.generating}`}>
                  {statusKey === 'queued' && job.queuePosition
                    ? `Queued #${job.queuePosition}`
                    : STATUS_LABEL[statusKey] || job.status}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {!isArchived && (
                    <button
                      onClick={(e) => cloneJob(e, jobId)}
                      disabled={cloning === jobId}
                      className="text-xs border border-neutral-300 px-3 py-1 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 transition-colors"
                    >
                      {cloning === jobId ? '...' : 'Clone'}
                    </button>
                  )}

                  {isAdmin && !isArchived && archiveConfirm !== jobId && deleteConfirm !== jobId && (
                    <button
                      onClick={() => setArchiveConfirm(jobId)}
                      className="text-xs border border-neutral-200 px-3 py-1 text-neutral-400 hover:text-neutral-700 hover:border-neutral-400 transition-colors"
                    >
                      Archive
                    </button>
                  )}

                  {isAdmin && !isArchived && archiveConfirm === jobId && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-neutral-600">Sure?</span>
                      <button
                        onClick={(e) => handleArchive(e, jobId, true)}
                        className="text-xs px-2 py-0.5 bg-neutral-900 text-white hover:bg-neutral-700"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setArchiveConfirm(null)}
                        className="text-xs px-2 py-0.5 border border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  {isAdmin && isArchived && (
                    <button
                      onClick={(e) => handleArchive(e, jobId, false)}
                      className="text-xs border border-neutral-300 px-3 py-1 text-neutral-500 hover:bg-neutral-50 transition-colors"
                    >
                      Unarchive
                    </button>
                  )}

                  {/* Delete button (admin only) */}
                  {isAdmin && deleteConfirm !== jobId && (
                    <button
                      onClick={() => { setDeleteConfirm(jobId); setArchiveConfirm(null); }}
                      className="text-xs border border-red-200 px-3 py-1 text-red-400 hover:text-red-600 hover:border-red-400 transition-colors"
                    >
                      Delete
                    </button>
                  )}

                  {isAdmin && deleteConfirm === jobId && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-red-600">Permanent!</span>
                      <button
                        onClick={(e) => handleDeleteSingle(e, jobId)}
                        disabled={deleting}
                        className="text-xs px-2 py-0.5 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {deleting ? '...' : 'Delete'}
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="text-xs px-2 py-0.5 border border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
