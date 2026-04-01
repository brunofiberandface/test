import { NextRequest, NextResponse } from 'next/server';
import { deleteJobs } from '@/lib/firestore';

// POST /api/jobs/batch-delete — permanently delete multiple jobs at once
// Body: { jobIds: string[] }
export async function POST(req: NextRequest) {
  try {
    const { jobIds } = await req.json();
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return NextResponse.json({ error: 'jobIds must be a non-empty array' }, { status: 400 });
    }
    if (jobIds.length > 50) {
      return NextResponse.json({ error: 'Maximum 50 jobs per batch delete' }, { status: 400 });
    }

    await deleteJobs(jobIds);
    console.log(`[Jobs] Batch deleted ${jobIds.length} jobs: ${jobIds.join(', ')}`);
    return NextResponse.json({ success: true, deleted: jobIds.length });
  } catch (error) {
    console.error('Error batch deleting jobs:', error);
    return NextResponse.json({ error: 'Failed to batch delete jobs' }, { status: 500 });
  }
}
