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
  modelName?: string;
  modelId?: string;
  createdAt: string;
  updatedAt?: string;
  creatorEmail?: string;
  archived?: boolean;
  queuePosition?: number;
  approvedCount?: number;
  totalShots?: number;
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
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
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

  // Inline edit state
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Action state
  const [cloning, setCloning] = useState<string | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const initializedRef = useRef(false);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/');
      return;
    }
    if (authStatus === 'authenticated') {
      fetchJobs(filter === 'archived');
      fetchQueue();
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
        refreshRef.current = setInterval(() => fetchJobs(filter === 'archived'), 15000);
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

  async function fetchQueue() {
    try {
      const res = await fetch('/api/queue');
      if (res.ok) setQueueState(await res.json());
    } catch { /* non-blocking */ }
  }

  async function fetchJobs(inclArchived = false) {
    setLoading(true);
    try {
      const url = inclArchived ? '/api/jobs?includeArchived=true' : '/api/jobs';
      const res = await fetch(url, { headers: { 'x-user-email': session?.user?.email || '' } });
      if (!res.ok) throw new Error('Failed to load jobs');
      const data = await res.json();
      setJobs(data.jobs || []);
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
  const stats = {
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
          {isAdmin && selected.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-600">{selected.size} selected</span>
              {!batchDeleteConfirm ? (
                <button onClick={() => setBatchDeleteConfirm(true)}
                  className="text-xs border border-red-300 px-3 py-1.5 text-red-600 hover:bg-red-50 transition-colors font-medium">
                  Delete selected
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

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
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
                <th className="text-left px-5 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Job Name</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Design</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Category</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Model</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Date</th>
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
                    <td className="px-5 py-3">
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
                    <td className="px-5 py-3 text-sm text-neutral-600">{job.modelName || '—'}</td>
                    <td className="px-5 py-3 text-sm text-neutral-400">{formatDate(job.updatedAt || job.createdAt)}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex text-xs px-2 py-0.5 font-medium ${STATUS_STYLES[statusKey] || STATUS_STYLES.generating}`}>
                        {statusKey === 'queued' && job.queuePosition
                          ? `Queued #${job.queuePosition}`
                          : statusKey === 'review' && job.totalShots
                            ? `In Review ${job.approvedCount ?? 0}/${job.totalShots}`
                            : STATUS_LABEL[statusKey] || job.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {!isArchived && (
                          <button onClick={e => cloneJob(e, jobId)} disabled={cloning === jobId}
                            className="text-xs border border-neutral-300 px-3 py-1 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 transition-colors">
                            {cloning === jobId ? '...' : 'Clone'}
                          </button>
                        )}
                        {isAdmin && !isArchived && archiveConfirm !== jobId && deleteConfirm !== jobId && (
                          <button onClick={() => setArchiveConfirm(jobId)}
                            className="text-xs border border-neutral-200 px-3 py-1 text-neutral-400 hover:text-neutral-700 hover:border-neutral-400 transition-colors">
                            Archive
                          </button>
                        )}
                        {isAdmin && !isArchived && archiveConfirm === jobId && (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-neutral-600">Sure?</span>
                            <button onClick={e => handleArchive(e, jobId, true)}
                              className="text-xs px-2 py-0.5 bg-neutral-900 text-white hover:bg-neutral-700">Yes</button>
                            <button onClick={() => setArchiveConfirm(null)}
                              className="text-xs px-2 py-0.5 border border-neutral-300 text-neutral-600 hover:bg-neutral-50">✕</button>
                          </div>
                        )}
                        {isAdmin && isArchived && (
                          <button onClick={e => handleArchive(e, jobId, false)}
                            className="text-xs border border-neutral-300 px-3 py-1 text-neutral-500 hover:bg-neutral-50 transition-colors">
                            Unarchive
                          </button>
                        )}
                        {isAdmin && deleteConfirm !== jobId && (
                          <button onClick={() => { setDeleteConfirm(jobId); setArchiveConfirm(null); }}
                            className="text-xs border border-red-200 px-3 py-1 text-red-400 hover:text-red-600 hover:border-red-400 transition-colors">
                            Delete
                          </button>
                        )}
                        {isAdmin && deleteConfirm === jobId && (
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
        </div>
      )}
    </Shell>
  );
}
