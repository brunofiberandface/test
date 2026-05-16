/**
 * GET /api/qa/shoe-matrix/batch-status
 *
 * Returns the current batch job doc (or null if no batch is active).
 * UI uses this to render the status banner: total/completed/failed,
 * state (PENDING/RUNNING/SUCCEEDED/FAILED), and the submission timestamp.
 *
 * Safe to call frequently (single Firestore read).
 */
import { NextResponse } from 'next/server';
import { getCurrentBatchJob } from '@/lib/qa/shoe-matrix-batch';

export async function GET() {
  try {
    const job = await getCurrentBatchJob();
    return NextResponse.json({ job });
  } catch (err) {
    console.error('[batch-status] failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
