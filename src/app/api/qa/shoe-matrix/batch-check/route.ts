/**
 * POST /api/qa/shoe-matrix/batch-check
 *
 * Polls Google's Gemini Batch API for the current batch job's state. If
 * the batch has succeeded, downloads the result JSONL from GCS, parses
 * each row, uploads the rendered image + thumb, and patches the cell doc.
 *
 * Stage 4 (2026-05-17): after a successful poll, triggers the worker so any
 * `awaiting-matrix` jobs whose cells just landed get promoted to 'generating'
 * and enqueued for normal processing. Trigger is fire-and-forget — the
 * batch-check response returns the poll result without waiting on the worker.
 */
import { NextResponse } from 'next/server';
import { checkBatch } from '@/lib/qa/shoe-matrix-batch';
import { triggerWorker } from '@/lib/worker/trigger';

export async function POST() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });
    const result = await checkBatch(apiKey);
    if (!result) return NextResponse.json({ error: 'no active batch' }, { status: 404 });

    // Wake the worker so it can scan awaiting-matrix jobs and resume any
    // whose cells just landed in this drain pass. Non-blocking.
    triggerWorker('batch-check').catch(() => { /* already logged inside helper */ });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[batch-check] failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
