/**
 * Cloud Tasks helper — Phase 4.
 *
 * Replaces the in-proc worker loop's per-shot dispatch with Google Cloud Tasks.
 * Each eligible shot becomes a separate Cloud Tasks task targeting
 * `/api/internal/process-shot`. Cloud Tasks handles:
 *   - Concurrency limiting (maxConcurrentDispatches on the queue)
 *   - Retries with exponential backoff
 *   - Rate limiting (maxDispatchesPerSecond)
 *   - Dead-letter behaviour (maxAttempts → permanent failure)
 *
 * Only used when `WORKER_MODE=tasks`. The inproc and job modes keep using
 * `loop.ts`; this module is a parallel implementation that can be flipped on
 * via env var, with full rollback by reverting WORKER_MODE.
 *
 * Required env vars (set on the Cloud Run service when WORKER_MODE=tasks):
 *   TASKS_QUEUE_NAME       — e.g. `gstar-shot-queue`
 *   TASKS_QUEUE_LOCATION   — e.g. `europe-west1` (defaults to GCP_REGION)
 *   TASKS_TARGET_URL       — public HTTPS URL of /api/internal/process-shot
 *   TASKS_INVOKER_SA       — service-account email used as OIDC token audience
 *   INTERNAL_TASK_SECRET   — shared secret header for the task handler to
 *                            verify (defence-in-depth alongside OIDC)
 */
import { CloudTasksClient } from '@google-cloud/tasks';
import { listShots, getQueueState, db } from '@/lib/firestore';
import { APP_CONFIG } from '@/lib/config';

const PROJECT = process.env.GCP_PROJECT_ID || 'gstar-ai-studio';
const REGION = process.env.GCP_REGION || 'europe-west1';
const QUEUE_NAME = process.env.TASKS_QUEUE_NAME || 'gstar-shot-queue';
const QUEUE_LOCATION = process.env.TASKS_QUEUE_LOCATION || REGION;
const TARGET_URL = process.env.TASKS_TARGET_URL || '';
const INVOKER_SA = process.env.TASKS_INVOKER_SA || '';

let _client: CloudTasksClient | null = null;
function getClient(): CloudTasksClient {
  if (!_client) _client = new CloudTasksClient();
  return _client;
}

function queuePath(): string {
  return `projects/${PROJECT}/locations/${QUEUE_LOCATION}/queues/${QUEUE_NAME}`;
}

export interface ShotTaskPayload {
  shotId: string;
  jobId: string;
  shotType: string;
  version: number;
  useDressedBase?: boolean;
}

/**
 * Enqueue a single shot as a Cloud Tasks task.
 *
 * Task name is deterministic (`shot-${shotId}-v${version}-${attempt}`) so
 * Cloud Tasks dedupes within its 1h dedupe window. If two callers race to
 * enqueue the same shot (e.g. two parallel completions both detecting the
 * same dependent now-eligible), only one task is created.
 *
 * Returns:
 *   - { enqueued: true }   on success
 *   - { enqueued: false, reason: 'duplicate' }  on dedupe-name collision (already enqueued)
 *   - throws on any other failure (caller should log + continue)
 */
export async function enqueueShotTask(
  payload: ShotTaskPayload,
  opts: { attempt?: number } = {},
): Promise<{ enqueued: boolean; reason?: string }> {
  if (!TARGET_URL) throw new Error('TASKS_TARGET_URL not set');
  if (!INVOKER_SA) throw new Error('TASKS_INVOKER_SA not set');

  const attempt = opts.attempt ?? 0;
  const taskName = `${queuePath()}/tasks/shot-${payload.shotId}-v${payload.version}-${attempt}`;

  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  const task = {
    name: taskName,
    httpRequest: {
      httpMethod: 'POST' as const,
      url: TARGET_URL,
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.INTERNAL_TASK_SECRET
          ? { 'X-Internal-Task-Secret': process.env.INTERNAL_TASK_SECRET }
          : {}),
      },
      body,
      oidcToken: {
        serviceAccountEmail: INVOKER_SA,
        audience: TARGET_URL,
      },
    },
  };

  try {
    await getClient().createTask({ parent: queuePath(), task });
    return { enqueued: true };
  } catch (err: any) {
    // Code 6 (ALREADY_EXISTS) means dedupe — another worker beat us to it. OK.
    if (err?.code === 6 || /already exists/i.test(err?.message || '')) {
      return { enqueued: false, reason: 'duplicate' };
    }
    throw err;
  }
}

/**
 * Find shots in `pending`/`queued` whose deps are met, and enqueue tasks for
 * each. Used both:
 *   - by `triggerWorker(tasks-mode)` after job enqueue / slot fill
 *   - by `/api/internal/process-shot` after a shot completes (fans out dependents)
 */
export async function enqueueEligibleShotsForJob(jobId: string): Promise<{
  enqueued: number;
  skipped: number;
  errors: string[];
}> {
  const shots = await listShots(jobId);
  if (shots.length === 0) return { enqueued: 0, skipped: 0, errors: [] };

  const byType: Record<string, any> = {};
  for (const s of shots) byType[(s as any).shotType] = s;

  let enqueued = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const shotType of APP_CONFIG.shotOrder) {
    const shot = byType[shotType];
    if (!shot) continue;
    const status = (shot as any).status;
    // Skip anything not in a runnable state. `generating` is in flight —
    // never re-enqueue (the in-flight task or watchdog handles it).
    if (status !== 'pending' && status !== 'queued') {
      skipped++;
      continue;
    }
    const deps = APP_CONFIG.shots[shotType as keyof typeof APP_CONFIG.shots]?.dependsOn || [];
    const depsMet = deps.every((dep: string) => {
      const d = byType[dep];
      return d && ((d as any).status === 'done' || (d as any).status === 'approved');
    });
    if (!depsMet) { skipped++; continue; }

    const payload: ShotTaskPayload = {
      shotId: (shot as any).shotId || (shot as any).id,
      jobId,
      shotType,
      version: (shot as any).version || 1,
      ...((shot as any).useDressedBase ? { useDressedBase: true } : {}),
    };

    try {
      const r = await enqueueShotTask(payload);
      if (r.enqueued) enqueued++; else skipped++;
    } catch (e) {
      errors.push(`${shotType}/${payload.shotId.substring(0, 8)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { enqueued, skipped, errors };
}

/**
 * `triggerWorker(reason)` in tasks mode = enqueue eligible shots for every
 * job currently in an active slot. Idempotent (deterministic task names).
 */
export async function triggerWorkerTasks(reason: string = 'unknown'): Promise<void> {
  try {
    const state = await getQueueState();
    const activeSlots = state.slots.filter(s => s !== null);
    if (activeSlots.length === 0) {
      console.log(`[triggerWorker:tasks] kick (${reason}) → no active slots`);
      return;
    }

    let totalEnqueued = 0;
    let totalSkipped = 0;
    const allErrors: string[] = [];
    for (const slot of activeSlots) {
      if (!slot) continue;
      const r = await enqueueEligibleShotsForJob(slot.jobId);
      totalEnqueued += r.enqueued;
      totalSkipped += r.skipped;
      allErrors.push(...r.errors);
    }
    console.log(`[triggerWorker:tasks] kick (${reason}) → enqueued=${totalEnqueued} skipped=${totalSkipped}${allErrors.length ? ` errors=${allErrors.length}` : ''}`);
    if (allErrors.length) console.warn('[triggerWorker:tasks] errors:', allErrors);
  } catch (err) {
    console.warn(`[triggerWorker:tasks] kick (${reason}) failed (non-blocking):`, err);
  }
}

/**
 * Round-robin key index counter for the tasks-mode worker. Each task
 * increments and reads a counter to pick a slot in KEY_POOL / BYTEPLUS_POOL.
 *
 * Stateless (Cloud Tasks tasks have no shared memory) and race-safe
 * (Firestore transaction). With maxConcurrentDispatches=N matching pool size,
 * keys are evenly distributed across concurrent tasks.
 */
const KEY_COUNTER_DOC = db.collection('system').doc('keyCounter');

export async function nextKeyIndex(): Promise<number> {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(KEY_COUNTER_DOC);
    const current = (doc.exists ? (doc.data()?.value as number) : 0) || 0;
    const next = (current + 1) % 1_000_000;
    tx.set(KEY_COUNTER_DOC, { value: next, updatedAt: new Date() });
    return next;
  });
}

/** Useful for /api/admin/health to surface "is Cloud Tasks reachable + queue config" */
export async function getQueueInfo(): Promise<{
  ok: boolean;
  queue?: string;
  state?: string;
  maxConcurrent?: number;
  maxAttempts?: number;
  error?: string;
}> {
  try {
    const [q] = await getClient().getQueue({ name: queuePath() });
    return {
      ok: true,
      queue: q.name || queuePath(),
      state: q.state ? String(q.state) : undefined,
      maxConcurrent: q.rateLimits?.maxConcurrentDispatches ?? undefined,
      maxAttempts: q.retryConfig?.maxAttempts ?? undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
