/**
 * POST /api/qa/shoe-matrix/batch-check
 *
 * Polls Google's Gemini Batch API for the current batch job's state. If
 * the batch has succeeded, downloads the result JSONL from GCS, parses
 * each row, uploads the rendered image + thumb, and patches the cell doc.
 *
 * Implementation status: TODO_POLL in shoe-matrix-batch.ts. This endpoint
 * is wired so the UI button works; the polling logic itself is scaffolded.
 */
import { NextResponse } from 'next/server';
import { checkBatch } from '@/lib/qa/shoe-matrix-batch';

export async function POST() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });
    const result = await checkBatch(apiKey);
    if (!result) return NextResponse.json({ error: 'no active batch' }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[batch-check] failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
