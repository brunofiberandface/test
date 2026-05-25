/**
 * GET /api/admin/health
 *
 * Phase 3 observability — single endpoint surfacing system-wide health for
 * the monitoring dashboard AND alert-check.
 *
 * Designed to be cheap (≈3-5 Firestore queries) so it can be polled every
 * 10-30s by the dashboard and every 5min by the alert cron.
 *
 * Returns a JSON snapshot:
 *   - worker: active/heartbeat-age/mode
 *   - queue: slots + queue depth + active job summaries
 *   - inflight: shots currently in 'generating' status with age
 *   - stuck: shots in 'generating' >15min (should be 0 with watchdogs working)
 *   - failures: shots failed in last 1h
 *   - completion: jobs completed in last 1h / 6h / 24h
 *   - alerts: array of {severity, message} for any condition crossing threshold
 */
import { NextResponse } from 'next/server';
import { shotsCol, jobsCol, getQueueState } from '@/lib/firestore';
import { getQueueInfo } from '@/lib/worker/tasks';

const STUCK_GENERATING_MS = 900_000;   // 15 min
const STUCK_HEARTBEAT_MS = 420_000;    // 7 min (5 was false-positiving during long Seedream calls)
const STUCK_HEARTBEAT_JOB_MODE_MS = 1_800_000; // 30 min — in job/tasks mode the
                                               // worker exits cleanly between
                                               // batches, so the heartbeat is
                                               // naturally stale 1-15 min. 30
                                               // min without progress is the
                                               // real "Cloud Run Job stuck /
                                               // trigger failing" symptom.
const FAILURE_WINDOW_MS = 3_600_000;   // 1h

interface HealthAlert {
  severity: 'info' | 'warn' | 'critical';
  message: string;
}

interface ShotInfo {
  shotId: string;
  shotType: string;
  jobId: string;
  status: string;
  progressPct?: number;
  progressStep?: string;
  ageMinutes: number;
}

function timestampMs(updatedAt: any): number {
  if (!updatedAt) return 0;
  if (typeof updatedAt.toDate === 'function') return updatedAt.toDate().getTime();
  if (updatedAt instanceof Date) return updatedAt.getTime();
  if (typeof updatedAt === 'string') return new Date(updatedAt).getTime();
  return 0;
}

export async function GET() {
  const now = Date.now();
  const alerts: HealthAlert[] = [];

  // Queue state
  const queueState = await getQueueState();
  const workerHeartbeatMs = timestampMs(queueState.workerHeartbeat);
  const heartbeatAgeMs = workerHeartbeatMs ? now - workerHeartbeatMs : Number.POSITIVE_INFINITY;
  const activeSlots = queueState.slots.filter((s: any) => s !== null);

  // Worker config from env
  const workerMode = (process.env.WORKER_MODE || 'inproc').toLowerCase();

  // Cloud Tasks queue info (Phase 4) — only meaningful when workerMode='tasks',
  // but always fetched so we can surface mis-configured states.
  let tasksInfo: Awaited<ReturnType<typeof getQueueInfo>> | null = null;
  if (workerMode === 'tasks') {
    tasksInfo = await getQueueInfo();
  }

  // In-flight shots
  const genSnap = await shotsCol.where('status', '==', 'generating').get();
  const inflight: ShotInfo[] = [];
  const stuck: ShotInfo[] = [];
  for (const doc of genSnap.docs) {
    const data = doc.data();
    const ms = timestampMs(data.updatedAt);
    const ageMs = ms ? now - ms : 0;
    const info: ShotInfo = {
      shotId: doc.id,
      shotType: (data.shotType as string) || '?',
      jobId: (data.jobId as string) || '',
      status: 'generating',
      progressPct: data.progressPct as number | undefined,
      progressStep: data.progressStep as string | undefined,
      ageMinutes: Math.round(ageMs / 60_000),
    };
    inflight.push(info);
    if (ageMs > STUCK_GENERATING_MS) stuck.push(info);
  }

  // Failures in the last hour — `failed` status with updatedAt within window
  const failSnap = await shotsCol.where('status', '==', 'failed').get();
  const recentFailures = failSnap.docs.filter(d => {
    const ms = timestampMs(d.data().updatedAt);
    return ms > 0 && (now - ms) <= FAILURE_WINDOW_MS;
  }).map(d => {
    const data = d.data();
    return {
      shotId: d.id,
      shotType: (data.shotType as string) || '?',
      jobId: (data.jobId as string) || '',
      ageMinutes: Math.round((now - timestampMs(data.updatedAt)) / 60_000),
      error: ((data.error || data.errorMessage) as string | undefined)?.slice(0, 200) || null,
    };
  });

  // Job completion counts over rolling windows
  const reviewSnap = await jobsCol.where('status', '==', 'review').get();
  const completeSnap = await jobsCol.where('status', '==', 'complete').get();
  const completedJobs = [...reviewSnap.docs, ...completeSnap.docs].map(d => ({
    jobId: d.id,
    ms: timestampMs(d.data().updatedAt),
  }));
  const completedLast1h = completedJobs.filter(j => j.ms > 0 && now - j.ms <= 3_600_000).length;
  const completedLast6h = completedJobs.filter(j => j.ms > 0 && now - j.ms <= 21_600_000).length;
  const completedLast24h = completedJobs.filter(j => j.ms > 0 && now - j.ms <= 86_400_000).length;

  // Alerts
  //
  // Heartbeat alert is MODE-AWARE (2026-05-14):
  //   - `inproc`: worker is a long-lived HTTP request; heartbeat updates
  //     continuously while alive → stale = worker died (real alert).
  //   - `job` / `tasks`: worker is a short-lived Cloud Run Job that exits
  //     cleanly between batches. Heartbeat = timestamp of last job exit.
  //     A "stale" heartbeat in this mode is the NORMAL between-batches state,
  //     NOT a sign of failure. Firing this alert in job mode was causing
  //     repeated false-positive "Worker may be dead" alarms every 5 min while
  //     the system was healthy (Bruno screenshot 2026-05-14: active=1,
  //     inflight=0, 0 failures, 6 jobs/24h — healthy, just between batches).
  //
  //     The real "stuck" symptom in job/tasks modes is already covered by
  //     the `stuck` shots alert below (shots in 'generating' >15 min). That
  //     alert fires only on actual progress halt, not on intermittent
  //     heartbeat.
  if (workerMode === 'inproc' && activeSlots.length > 0 && heartbeatAgeMs > STUCK_HEARTBEAT_MS) {
    alerts.push({
      severity: 'critical',
      message: `Worker heartbeat stale: ${Math.round(heartbeatAgeMs / 60_000)} min old (active slots: ${activeSlots.length}). Worker may be dead.`,
    });
  }
  // Job / tasks mode: fire ONLY on a much larger threshold AND only when
  // there are no shots in flight (because in-flight = worker is actively
  // running, regardless of heartbeat freshness vs threshold). 30 min with
  // an active slot and nothing in flight = something genuinely blocking
  // shot progression (Cloud Run Job trigger failing, queue stuck, etc).
  if (
    (workerMode === 'job' || workerMode === 'tasks') &&
    activeSlots.length > 0 &&
    inflight.length === 0 &&
    heartbeatAgeMs > STUCK_HEARTBEAT_JOB_MODE_MS
  ) {
    alerts.push({
      severity: 'critical',
      message: `${workerMode} worker idle ${Math.round(heartbeatAgeMs / 60_000)} min with active slot(s) and no shots in flight — job pipeline may be stuck.`,
    });
  }
  if (workerMode === 'tasks' && tasksInfo && !tasksInfo.ok) {
    alerts.push({
      severity: 'critical',
      message: `Cloud Tasks queue unreachable: ${tasksInfo.error || 'unknown error'}`,
    });
  }
  if (workerMode === 'tasks' && tasksInfo?.state && tasksInfo.state !== 'RUNNING') {
    alerts.push({
      severity: 'critical',
      message: `Cloud Tasks queue is in state '${tasksInfo.state}' (expected RUNNING). Dispatches will not happen.`,
    });
  }
  if (stuck.length > 0) {
    alerts.push({
      severity: 'critical',
      message: `${stuck.length} shot(s) stuck in 'generating' >15min: ${stuck.map(s => `${s.shotType}/${s.shotId.substring(0,6)}(${s.ageMinutes}m)`).join(', ')}`,
    });
  }
  if (recentFailures.length > 3) {
    alerts.push({
      severity: 'warn',
      message: `${recentFailures.length} shot failures in the last hour.`,
    });
  }

  const summary = {
    workerMode,
    workerActive: queueState.workerActive,
    workerHeartbeatAt: queueState.workerHeartbeat,
    workerHeartbeatAgeMinutes: workerHeartbeatMs ? Math.round(heartbeatAgeMs / 60_000) : null,
    activeSlots: activeSlots.length,
    queueDepth: queueState.queue.length,
    inflightCount: inflight.length,
    stuckCount: stuck.length,
    failuresLastHour: recentFailures.length,
    completedLast1h,
    completedLast6h,
    completedLast24h,
    tasksQueueOk: tasksInfo?.ok ?? null,
    tasksQueueState: tasksInfo?.state ?? null,
    tasksQueueMaxConcurrent: tasksInfo?.maxConcurrent ?? null,
  };

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    summary,
    alerts,
    slots: activeSlots,
    queue: queueState.queue,
    inflight,
    stuck,
    recentFailures,
    tasksInfo,
  });
}
