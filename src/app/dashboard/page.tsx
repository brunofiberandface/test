'use client';

import { useEffect, useState } from 'react';
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
}

interface QueueState {
  activeJobId: string | null;
  activeJobName: string | null;
  activeStartedAt: string | null;
  queue: Array<{ jobId: string; jobName: string; queuedAt: string }>;
}

const STATUS_STYLES: Record<string, string> = {
  uploading: 'bg-neutral-100 text-neutral-600',
  generating: 'bg-amber-50 text-amber-700',
  review: 'bg-blue-50 text-blue-700',
  complete: 'bg-green-50 text-green-700',
  completed: 'bg-green-50 text-green-700',
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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [queueState, setQueueState] = useState<QueueState | null>(null);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/');
      return;
    }
    if (authStatus === 'authenticated') {
      fetchJobs();
      fetchQueue();
      // Poll queue status every 10s
      const interval = setInterval(fetchQueue, 10000);
      return () => clearInterval(interval);
    }
  }, [authStatus]);

  async function fetchQueue() {
    try {
      const res = await fetch('/api/queue');
      if (res.ok) {
        const data = await res.json();
        setQueueState(data);
      }
    } catch { /* non-blocking */ }
  }

  async function fetchJobs() {
    try {
      const res = await fetch('/api/jobs', {
        headers: { 'x-user-email': session?.user?.email || '' },
      });
      if (!res.ok) throw new Error('Failed to load jobs');
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const user = session?.user ? {
    email: session.user.email || '',
    name: session.user.name || '',
    role: 'admin' as const, // Default to admin for now
  } : undefined;

  const stats = {
    total: jobs.length,
    generating: jobs.filter(j => j.status === 'generating' || j.status === 'uploading').length,
    review: jobs.filter(j => j.status === 'review').length,
    completed: jobs.filter(j => j.status === 'complete' || j.status === 'completed').length,
  };

  return (
    <Shell user={user}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Dashboard</h1>
          <p className="text-sm text-neutral-500 mt-1">Overview of all generation jobs</p>
        </div>
        <Link
          href="/jobs/new"
          className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors"
        >
          New Job
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'TOTAL JOBS', value: stats.total, sub: `${stats.total} active` },
          { label: 'GENERATING', value: stats.generating, sub: 'in progress' },
          { label: 'REVIEW', value: stats.review, sub: 'awaiting approval' },
          { label: 'COMPLETED', value: stats.completed, sub: 'all shots approved' },
        ].map(stat => (
          <div key={stat.label} className="border border-neutral-200 bg-white p-5">
            <p className="text-xs text-neutral-500 uppercase tracking-wider">{stat.label}</p>
            <p className="text-2xl font-bold text-neutral-900 mt-1">{stat.value}</p>
            <p className="text-xs text-neutral-400 mt-1">{stat.sub}</p>
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
          {queueState?.queue && queueState.queue.length > 0 && (
            <>
              {queueState.queue.map((entry, idx) => (
                <div key={entry.jobId} className="px-5 py-3 flex items-center gap-3 border-b border-neutral-50">
                  <span className="text-xs font-mono text-neutral-400 w-6 text-right flex-shrink-0">#{idx + 1}</span>
                  <Link href={`/jobs/${entry.jobId}/results`} className="text-sm text-neutral-700 hover:underline flex-1 min-w-0 truncate">
                    {entry.jobName || entry.jobId}
                  </Link>
                  <span className="text-xs text-neutral-400 flex-shrink-0">waiting</span>
                </div>
              ))}
            </>
          )}
          {queueState?.queue?.length === 0 && !queueState?.activeJobId && (
            <div className="px-5 py-3 text-sm text-neutral-400">Queue empty</div>
          )}
        </div>
      )}

      {/* Jobs table */}
      <div className="border border-neutral-200 bg-white">
        <div className="px-5 py-3 border-b border-neutral-200">
          <h2 className="text-sm font-medium text-neutral-900">Recent Jobs</h2>
        </div>

        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-neutral-400">Loading jobs...</div>
        ) : error ? (
          <div className="px-5 py-12 text-center text-sm text-red-500">{error}</div>
        ) : jobs.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-neutral-400 mb-4">No jobs yet</p>
            <Link href="/jobs/new" className="text-sm text-neutral-900 underline">Create your first job</Link>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-100">
                <th className="text-left px-5 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Job Name</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Design #</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Category</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Models</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Last Run</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => (
                <tr key={job.id} className="border-b border-neutral-50 hover:bg-neutral-50 cursor-pointer">
                  <td className="px-5 py-3">
                    <Link href={`/jobs/${job.id}/results`} className="text-sm font-medium text-neutral-900 hover:underline">
                      {job.jobName || job.designNumber || <span className="text-neutral-400 font-normal italic">—</span>}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-sm text-neutral-500">{job.designNumber}</td>
                  <td className="px-5 py-3 text-sm text-neutral-600 capitalize">{job.garmentCategory}</td>
                  <td className="px-5 py-3 text-sm text-neutral-600">{(job.modelIds || []).join(', ')}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-block px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[job.status] || 'bg-neutral-100 text-neutral-600'}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm text-neutral-400">{formatDate(job.updatedAt || job.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
