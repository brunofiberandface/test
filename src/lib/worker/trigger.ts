/**
 * Worker trigger — single entrypoint for kicking the worker after a job
 * enqueue / shot reset / rerun. Behaviour branches on `WORKER_MODE` env var:
 *
 *   - `inproc` (DEFAULT): fire-and-forget HTTP POST to /api/jobs/process-queue
 *     on localhost. Current behaviour, identical to pre-Phase-2.
 *
 *   - `job`: Run Admin v2 API call to trigger the `gstar-worker-job` Cloud
 *     Run Job. The Job runs the same `runWorkerLoop()` but in its own
 *     always-on-CPU container, immune to Cloud Run's CPU-throttling-during-
 *     await (LEARNING #78).
 *
 *   - `tasks` (Phase 4): enqueue eligible shots as Cloud Tasks tasks. Each
 *     task targets /api/internal/process-shot. Cloud Tasks handles
 *     concurrency + retries + rate limiting. Slots stay as a job-level
 *     bookkeeping primitive; per-shot dispatch moves to Cloud Tasks.
 *
 * Rollback: unset WORKER_MODE (or set to `inproc`) — every trigger site
 * reverts to the in-proc path on next request.
 *
 * The function is fire-and-forget — the caller does NOT await the worker's
 * completion. The worker may run for minutes (Cloud Run Job) or hold the
 * HTTP response open (in-proc). Either way, callers return immediately.
 */
import { GoogleAuth } from 'google-auth-library';
import { triggerWorkerTasks } from './tasks';

const WORKER_MODE = (process.env.WORKER_MODE || 'inproc').toLowerCase();
const PROJECT = process.env.GCP_PROJECT_ID || 'gstar-ai-studio';
const REGION = process.env.GCP_REGION || 'europe-west1';
const JOB_NAME = process.env.WORKER_JOB_NAME || 'gstar-worker-job';

const RUN_API_BASE = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}`;

let _auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!_auth) {
    _auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }
  return _auth;
}

function getInternalBase(): string {
  if (process.env.INTERNAL_BASE_URL) return process.env.INTERNAL_BASE_URL;
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

/**
 * Fire-and-forget worker kick. Resolves immediately after dispatch (does
 * NOT wait for the worker to finish). Errors are logged but don't throw —
 * callers should never have to handle worker-trigger failures.
 *
 * @param reason  Short label for logs, e.g. 'job-create', 'reset', 'unstick'.
 */
export async function triggerWorker(reason: string = 'unknown'): Promise<void> {
  if (WORKER_MODE === 'tasks') {
    return triggerWorkerTasks(reason);
  }
  if (WORKER_MODE === 'job') {
    return triggerWorkerJob(reason);
  }
  return triggerWorkerInProc(reason);
}

function triggerWorkerInProc(reason: string): Promise<void> {
  const base = getInternalBase();
  // Fire-and-forget — do NOT await. The worker holds the response open
  // until idle, which can be many minutes. Awaiting would block the
  // calling request handler (LEARNING #62).
  fetch(`${base}/api/jobs/process-queue`, { method: 'POST' })
    .then(res => console.log(`[triggerWorker:inproc] kick (${reason}) → ${res.status}`))
    .catch(err => console.warn(`[triggerWorker:inproc] kick (${reason}) failed (non-blocking):`, err));
  return Promise.resolve();
}

async function triggerWorkerJob(reason: string): Promise<void> {
  // Cloud Run Job invocation is a single short HTTP call to Run Admin v2.
  // The actual worker runs asynchronously in the Job container. Our await
  // here is just the trigger acknowledgement (~500ms), not worker work.
  try {
    const auth = getAuth();
    const client = await auth.getClient();
    const tokenResp = await client.getAccessToken();
    const token = tokenResp.token;
    if (!token) throw new Error('failed to get access token');

    const runResp = await fetch(`${RUN_API_BASE}/jobs/${JOB_NAME}:run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      // No overrides needed — the Job's env (set at deploy time) carries
      // INTERNAL_BASE_URL + key pools. We just want to spawn an execution.
      body: JSON.stringify({}),
    });

    if (!runResp.ok) {
      const txt = await runResp.text().catch(() => '');
      // If the Job is ALREADY running (Cloud Run Jobs returns 409 when
      // parallelism=1 and a previous execution is still active), that's
      // fine — the running Job will pick up the new shot via its loop.
      // No need to spawn another.
      if (runResp.status === 409) {
        console.log(`[triggerWorker:job] kick (${reason}) → 409 (already running, OK)`);
        return;
      }
      console.warn(`[triggerWorker:job] kick (${reason}) → ${runResp.status}: ${txt.slice(0, 200)}`);
      return;
    }

    console.log(`[triggerWorker:job] kick (${reason}) → 200 (Job execution started)`);
  } catch (err) {
    console.warn(`[triggerWorker:job] kick (${reason}) failed (non-blocking):`, err);
  }
}
