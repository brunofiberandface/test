import { NextRequest } from 'next/server';
import { getQueueState } from '@/lib/firestore';

/**
 * GET /api/jobs/queue-watchdog
 *
 * DEPRECATED — replaced by /api/jobs/process-queue (server-side worker).
 * This endpoint now just returns the current queue state for backwards compat.
 */
export async function GET(req: NextRequest) {
  const state = await getQueueState();
  return new Response(JSON.stringify({
    ok: true,
    deprecated: true,
    message: 'Use POST /api/jobs/process-queue instead',
    slots: state.slots,
    queueLength: state.queue.length,
    workerActive: state.workerActive,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
