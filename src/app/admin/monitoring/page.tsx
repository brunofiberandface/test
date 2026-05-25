'use client';

import { useEffect, useState, useCallback } from 'react';
import Shell from '@/components/Shell';

interface ShotInfo {
  shotId: string;
  shotType: string;
  jobId: string;
  status: string;
  progressPct?: number;
  progressStep?: string;
  ageMinutes: number;
}

interface RecentFailure {
  shotId: string;
  shotType: string;
  jobId: string;
  ageMinutes: number;
  error: string | null;
}

interface HealthData {
  timestamp: string;
  summary: {
    workerMode: string;
    workerActive: boolean;
    workerHeartbeatAt: string | null;
    workerHeartbeatAgeMinutes: number | null;
    activeSlots: number;
    queueDepth: number;
    inflightCount: number;
    stuckCount: number;
    failuresLastHour: number;
    completedLast1h: number;
    completedLast6h: number;
    completedLast24h: number;
    tasksQueueOk?: boolean | null;
    tasksQueueState?: string | null;
    tasksQueueMaxConcurrent?: number | null;
  };
  alerts: Array<{ severity: 'info' | 'warn' | 'critical'; message: string }>;
  slots: Array<{ jobId: string; jobName: string; currentShot: string | null }>;
  queue: Array<{ jobId: string; jobName: string }>;
  inflight: ShotInfo[];
  stuck: ShotInfo[];
  recentFailures: RecentFailure[];
}

const sevStyles = {
  critical: 'bg-red-50 border-red-300 text-red-900',
  warn: 'bg-amber-50 border-amber-300 text-amber-900',
  info: 'bg-blue-50 border-blue-200 text-blue-900',
};

function Stat({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const toneClasses = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-red-700' : 'text-neutral-900';
  return (
    <div className="border border-neutral-200 bg-white p-4">
      <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium mb-1">{label}</p>
      <p className={`text-2xl font-bold ${toneClasses}`}>{value}</p>
      {hint && <p className="text-xs text-neutral-400 mt-1">{hint}</p>}
    </div>
  );
}

export default function MonitoringPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/health', { cache: 'no-store' });
      if (!res.ok) throw new Error(`health endpoint returned ${res.status}`);
      const d = (await res.json()) as HealthData;
      setData(d);
      setErr(null);
      setLastFetched(new Date());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const i = setInterval(fetchHealth, 15_000);
    return () => clearInterval(i);
  }, [fetchHealth]);

  if (!data && !err) {
    return (
      <Shell>
        <div className="p-6 max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">Monitoring</h1>
          <p className="text-sm text-neutral-500">Loading…</p>
        </div>
      </Shell>
    );
  }

  if (err && !data) {
    return (
      <Shell>
        <div className="p-6 max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">Monitoring</h1>
          <div className="p-4 bg-red-50 border border-red-300 text-red-800 text-sm">{err}</div>
        </div>
      </Shell>
    );
  }

  const s = data!.summary;
  // Heartbeat tone is mode-aware (2026-05-14). In job/tasks modes the worker
  // is a short-lived Cloud Run Job that exits cleanly between batches —
  // heartbeat-age in those modes measures "time since last batch ran", not
  // "is the worker alive". Showing it red was misleading. Treat it as a
  // neutral status indicator in those modes.
  const workerHbTone: 'good' | 'warn' | 'bad' | 'neutral' =
    s.workerMode !== 'inproc'
      ? 'neutral'
      : s.workerHeartbeatAgeMinutes == null
        ? 'warn'
        : s.workerHeartbeatAgeMinutes <= 2 ? 'good' : s.workerHeartbeatAgeMinutes <= 5 ? 'warn' : 'bad';

  return (
    <Shell>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-baseline justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Monitoring</h1>
            <p className="text-xs text-neutral-500 mt-1">
              Auto-refreshes every 15s · Last fetched: {lastFetched ? lastFetched.toLocaleTimeString() : '—'}
              {err && <span className="ml-2 text-red-600">· {err}</span>}
            </p>
          </div>
          <button onClick={fetchHealth} className="text-xs border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">Refresh</button>
        </div>

        {/* Alert banner */}
        {data!.alerts.length > 0 && (
          <div className="mb-6 space-y-2">
            {data!.alerts.map((a, i) => (
              <div key={i} className={`border ${sevStyles[a.severity]} p-3 text-sm`}>
                <span className="uppercase tracking-wider text-[10px] font-bold mr-2">{a.severity}</span>
                {a.message}
              </div>
            ))}
          </div>
        )}

        {/* Headline stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat
            label="Worker mode"
            value={s.workerMode}
            hint={
              s.workerMode === 'tasks'
                ? (s.tasksQueueOk
                    ? `queue: ${s.tasksQueueState || '?'}${s.tasksQueueMaxConcurrent != null ? ` (${s.tasksQueueMaxConcurrent} max)` : ''}`
                    : 'queue unreachable')
                : (s.workerActive ? 'active' : 'idle')
            }
            tone={
              s.workerMode === 'tasks'
                ? (s.tasksQueueOk && s.tasksQueueState === 'RUNNING' ? 'good' : 'bad')
                : (s.workerActive ? 'good' : 'neutral')
            }
          />
          <Stat
            label="Heartbeat age"
            value={s.workerHeartbeatAgeMinutes == null ? '—' : `${s.workerHeartbeatAgeMinutes}m`}
            hint={s.workerHeartbeatAt ? new Date(s.workerHeartbeatAt).toLocaleTimeString() : '—'}
            tone={workerHbTone}
          />
          <Stat
            label="Active slots"
            value={s.activeSlots}
            hint={`+ ${s.queueDepth} queued`}
          />
          <Stat
            label="In flight"
            value={s.inflightCount}
            hint={`${s.stuckCount} stuck`}
            tone={s.stuckCount > 0 ? 'bad' : 'good'}
          />
          <Stat
            label="Failures (1h)"
            value={s.failuresLastHour}
            tone={s.failuresLastHour === 0 ? 'good' : s.failuresLastHour <= 3 ? 'warn' : 'bad'}
          />
          <Stat
            label="Completed 1h"
            value={s.completedLast1h}
          />
          <Stat
            label="Completed 6h"
            value={s.completedLast6h}
          />
          <Stat
            label="Completed 24h"
            value={s.completedLast24h}
          />
        </div>

        {/* Active slots */}
        <section className="mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-600 mb-2">Active slots</h2>
          {data!.slots.length === 0 ? (
            <p className="text-sm text-neutral-400">No active jobs.</p>
          ) : (
            <div className="border border-neutral-200 bg-white">
              {data!.slots.map(slot => (
                <div key={slot.jobId} className="px-4 py-2.5 border-b border-neutral-100 text-sm flex items-center justify-between">
                  <div>
                    <a href={`/jobs/${slot.jobId}/results`} className="font-medium text-neutral-900 hover:underline">{slot.jobName}</a>
                  </div>
                  <div className="text-neutral-500">{slot.currentShot || 'idle'}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* In-flight shots */}
        <section className="mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-600 mb-2">In flight ({data!.inflight.length})</h2>
          {data!.inflight.length === 0 ? (
            <p className="text-sm text-neutral-400">No shots currently generating.</p>
          ) : (
            <div className="border border-neutral-200 bg-white">
              {data!.inflight.map(s => (
                <div key={s.shotId} className={`px-4 py-2.5 border-b border-neutral-100 text-sm flex items-center justify-between ${data!.stuck.find(x => x.shotId === s.shotId) ? 'bg-red-50' : ''}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-mono text-neutral-500">{s.shotType}</span>
                    <a href={`/jobs/${s.jobId}/results`} className="text-neutral-900 hover:underline truncate">{s.jobId.substring(0,8)}…</a>
                    <span className="text-xs text-neutral-400 truncate">{s.progressStep || '—'}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-neutral-500">{s.progressPct ?? 0}%</span>
                    <span className={`text-xs ${s.ageMinutes > 15 ? 'text-red-600 font-medium' : s.ageMinutes > 5 ? 'text-amber-700' : 'text-neutral-500'}`}>{s.ageMinutes}m</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent failures */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-600 mb-2">Failures last hour ({data!.recentFailures.length})</h2>
          {data!.recentFailures.length === 0 ? (
            <p className="text-sm text-neutral-400">No failures in the last hour.</p>
          ) : (
            <div className="border border-neutral-200 bg-white">
              {data!.recentFailures.map(f => (
                <div key={f.shotId} className="px-4 py-2.5 border-b border-neutral-100 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-neutral-500">{f.shotType}</span>
                    <a href={`/jobs/${f.jobId}/results`} className="text-neutral-900 hover:underline">{f.jobId.substring(0,8)}…</a>
                    <span className="text-xs text-neutral-500 ml-auto">{f.ageMinutes}m ago</span>
                  </div>
                  {f.error && <p className="text-xs text-red-700 mt-1 ml-7 truncate" title={f.error}>{f.error}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}
