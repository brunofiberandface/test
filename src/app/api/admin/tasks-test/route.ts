/**
 * POST /api/admin/tasks-test
 *
 * Phase 4 dry-run helper. Exercises `enqueueShotTask` from inside the service
 * (i.e. the *enqueue side* of Cloud Tasks) without flipping WORKER_MODE.
 *
 * Auth: X-Internal-Task-Secret header (same secret as /api/internal/process-shot).
 *
 * Body: { shotId, jobId, shotType, version?, useDressedBase? }
 *
 * Returns: { ok, result } on success — `result.enqueued` confirms the task
 * landed in the queue.
 *
 * SAFE to call with a fake shotId (e.g. `phase4-drytest-fake`): the handler
 * is idempotent and will return `skipped: 'not-found'` when Cloud Tasks
 * dispatches the task — no real work, no API spend.
 *
 * Delete this endpoint after Phase 4 is fully validated.
 */
import { NextRequest, NextResponse } from 'next/server';
import { enqueueShotTask } from '@/lib/worker/tasks';

export const dynamic = 'force-dynamic';

const INTERNAL_TASK_SECRET = process.env.INTERNAL_TASK_SECRET || '';

export async function POST(req: NextRequest) {
  if (!INTERNAL_TASK_SECRET) {
    return NextResponse.json({ error: 'INTERNAL_TASK_SECRET not set on server' }, { status: 500 });
  }
  if (req.headers.get('x-internal-task-secret') !== INTERNAL_TASK_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { shotId, jobId, shotType, version, useDressedBase, attempt } = body as {
    shotId?: string;
    jobId?: string;
    shotType?: string;
    version?: number;
    useDressedBase?: boolean;
    attempt?: number;
  };

  if (!shotId || !jobId || !shotType) {
    return NextResponse.json({ error: 'missing shotId/jobId/shotType' }, { status: 400 });
  }

  try {
    const result = await enqueueShotTask(
      { shotId, jobId, shotType, version: version ?? 1, ...(useDressedBase ? { useDressedBase: true } : {}) },
      { attempt: attempt ?? Math.floor(Date.now() / 1000) },
    );
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e), code: e?.code },
      { status: 500 },
    );
  }
}
