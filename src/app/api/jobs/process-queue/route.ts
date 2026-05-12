/**
 * POST /api/jobs/process-queue — in-proc worker entrypoint.
 *
 * Thin HTTP wrapper around `runWorkerLoop()` (in `src/lib/worker/loop.ts`).
 *
 * The same loop is also runnable as a Cloud Run Job (`cloud-run-job-worker/`)
 * when env var `WORKER_MODE=job` flips trigger sites to the Run Admin v2 API.
 * In that mode this endpoint stays callable as a safety net (e.g. Cloud
 * Scheduler kicks). Worker-singleton lock prevents concurrent runs.
 */
import { NextRequest } from 'next/server';
import { runWorkerLoop } from '@/lib/worker/loop';

export async function POST(_req: NextRequest) {
  const result = await runWorkerLoop({ workerName: 'inproc' });
  return new Response(JSON.stringify({ message: result.message }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
