/**
 * Cloud Run Job entrypoint — Phase 2 worker, runs the shared `runWorkerLoop()`
 * from `src/lib/worker/loop.ts` in an always-on-CPU container.
 *
 * Triggered by main service (when WORKER_MODE=job is set) via Run Admin v2 API
 * whenever a job is enqueued. Job runs until idle, then exits cleanly. Next
 * shot enqueue triggers a new Job execution.
 *
 * REQUIRED env vars:
 *   - INTERNAL_BASE_URL: public URL of the main service (e.g. https://gstar-ai-studio-...run.app)
 *     The worker HTTPS-calls /api/generate on this URL.
 *   - FIRESTORE_PROJECT: GCP project for Firestore (default 'gstar-ai-studio')
 *   - GEMINI_API_KEY, GEMINI_API_KEY_2, ...: Gemini key pool
 *   - BYTEPLUS_API_KEY, BYTEPLUS_API_KEY_2, ...: BytePlus key pool
 *   - WORKER_STALE_INFLIGHT_WATCHDOG: '0' to disable Phase 1 watchdog (default ON)
 *
 * The container exits with code 0 on success, non-zero on fatal error.
 * Cloud Run Jobs handles retry policy (configured at deploy time).
 */
import { runWorkerLoop } from '../src/lib/worker/loop';

async function main() {
  if (!process.env.INTERNAL_BASE_URL) {
    console.error('[WorkerJob] FATAL: INTERNAL_BASE_URL env var is required. Set to the gstar-ai-studio service URL.');
    process.exit(2);
  }
  console.log(`[WorkerJob] Starting — INTERNAL_BASE_URL=${process.env.INTERNAL_BASE_URL}`);
  console.log(`[WorkerJob] Watchdog enabled: ${process.env.WORKER_STALE_INFLIGHT_WATCHDOG !== '0'}`);

  try {
    const result = await runWorkerLoop({ workerName: 'job' });
    console.log(`[WorkerJob] Exit — ${result.message}`);
    process.exit(0);
  } catch (err) {
    console.error(`[WorkerJob] Fatal error:`, err);
    process.exit(1);
  }
}

main();
