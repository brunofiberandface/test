/**
 * GET /api/jobs/counts
 *
 * Returns aggregate counts of jobs in the database, broken down by status.
 * Used by the dashboard header + filter chips to show DB-wide totals, not
 * the count of the currently-paginated visible slice.
 *
 * 2026-05-13: introduced when dashboard pagination shipped. Before pagination
 * the header counted from the loaded jobs array directly, which became wrong
 * the moment we capped initial load at 50.
 *
 * Response:
 *   { total, generating, review, completed, archived }   (all integers)
 */
import { NextResponse } from 'next/server';
import { getJobCounts } from '@/lib/firestore';

export async function GET() {
  try {
    const counts = await getJobCounts();
    return NextResponse.json(counts);
  } catch (error) {
    console.error('[/api/jobs/counts] failed:', error);
    return NextResponse.json({ error: 'Failed to compute counts' }, { status: 500 });
  }
}
