import { db, jobsCol, shotsCol, releaseWorker } from '@/lib/firestore';

/**
 * POST/GET /api/jobs/reset-queue
 *
 * Emergency reset: clears the generation queue, releases worker lock,
 * and resets all stuck "generating" jobs/shots back to "queued".
 */
async function handleReset() {
  const actions: string[] = [];

  try {
    // 1. Clear the queue state — empty slots, empty queue, release worker
    const queueRef = db.collection('system').doc('generationQueue');
    await queueRef.set({
      slots: [null, null],
      queue: [],
      workerHeartbeat: null,
      workerActive: false,
      updatedAt: new Date().toISOString(),
    });
    actions.push('Cleared queue state (slots + queue)');

    // 2. Release worker claim
    try {
      await releaseWorker();
      actions.push('Released worker lock');
    } catch { /* already released */ }

    // 3. Reset all "generating" jobs back to "queued"
    const genJobs = await jobsCol.where('status', '==', 'generating').get();
    for (const doc of genJobs.docs) {
      await doc.ref.update({ status: 'queued', updatedAt: new Date() });
      actions.push(`Reset job "${doc.data().jobName || doc.data().designNumber || doc.id}" to queued`);
    }

    // 4. Reset all "generating" shots back to "queued"
    const genShots = await shotsCol.where('status', '==', 'generating').get();
    let shotCount = 0;
    for (const doc of genShots.docs) {
      await doc.ref.update({ status: 'queued', updatedAt: new Date(), error: null, claimedBySlot: null });
      shotCount++;
    }
    if (shotCount > 0) actions.push(`Reset ${shotCount} generating shots to queued`);

    return new Response(JSON.stringify({ ok: true, actions }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err), actions }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function POST() {
  return handleReset();
}

export async function GET() {
  return handleReset();
}
