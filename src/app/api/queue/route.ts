import { NextResponse } from 'next/server';
import { getQueueState, forceReleaseGenerationLock, resetQueueState } from '@/lib/firestore';

/**
 * GET /api/queue
 *
 * Returns current generation queue state:
 * - activeJobId / activeJobName — job currently generating
 * - queue — ordered list of waiting jobs
 */
export async function GET() {
  try {
    const state = await getQueueState();
    return NextResponse.json(state);
  } catch (error) {
    console.error('[Queue] Failed to get queue state:', error);
    return NextResponse.json({ error: 'Failed to get queue state' }, { status: 500 });
  }
}

/**
 * POST /api/queue
 *
 * Hard-reset the queue document to a clean empty state.
 * Clears all slots, queue entries, AND legacy single-slot fields.
 * Use when the queue is stuck due to stale legacy schema fields.
 */
export async function POST() {
  try {
    await resetQueueState();
    console.warn('[Queue] Queue state hard-reset to empty');
    return NextResponse.json({ ok: true, message: 'Queue reset to empty state' });
  } catch (error) {
    console.error('[Queue] Reset failed:', error);
    return NextResponse.json({ error: 'Failed to reset queue' }, { status: 500 });
  }
}

/**
 * DELETE /api/queue
 *
 * Force-release the current generation lock. Use when a job is stuck
 * and the lock wasn't released properly (e.g. Cloud Run timeout).
 * Automatically promotes the next job in queue to active.
 */
export async function DELETE() {
  try {
    const { released, next } = await forceReleaseGenerationLock();
    console.warn(`[Queue] Force-released lock from job ${released}. Next: ${next?.jobName || 'none'}`);
    return NextResponse.json({ released, next });
  } catch (error) {
    console.error('[Queue] Force-release failed:', error);
    return NextResponse.json({ error: 'Failed to force-release lock' }, { status: 500 });
  }
}
