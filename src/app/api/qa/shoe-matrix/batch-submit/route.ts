/**
 * POST /api/qa/shoe-matrix/batch-submit
 *
 * Collects every (pending | failed | partial) cell × view that hasn't
 * landed yet, builds the JSONL request file, uploads to GCS, submits to
 * Gemini Pro Image Preview Batch API. 50% cheaper than synchronous calls,
 * runs async — Google completes the batch within 24h (usually <12h).
 *
 * Returns the batch name + total request count.
 *
 * For now: the actual JSONL build + Google batches.create call lives in
 * shoe-matrix-batch.ts and is flagged TODO_SUBMIT. This endpoint just
 * exposes the entry collection + the would-be submit, so the UI can show
 * a count + cost estimate before we wire the heavy part.
 */
import { NextResponse } from 'next/server';
import { collectPendingBatchEntries, submitBatch } from '@/lib/qa/shoe-matrix-batch';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const dryRun = !!body.dryRun;

  try {
    const entries = await collectPendingBatchEntries({
      includePartial: body.includePartial !== false,
      shoeIds: Array.isArray(body.shoeIds) ? body.shoeIds : undefined,
      modelIds: Array.isArray(body.modelIds) ? body.modelIds : undefined,
    });

    const totalRequests = entries.length;
    const estimatedCost = +(totalRequests * 0.12).toFixed(2); // Pro Batch API: $0.12/image at 4K

    if (dryRun || totalRequests === 0) {
      return NextResponse.json({
        dryRun: true,
        totalRequests,
        estimatedCost,
        entries: entries.slice(0, 5).map(e => ({ cellId: e.cellId, view: e.view })), // preview only
        message: totalRequests === 0
          ? 'Nothing to submit — all non-blocked cells are done.'
          : `Would submit ${totalRequests} requests at ~$${estimatedCost} via Pro Batch API.`,
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });

    const result = await submitBatch(entries, apiKey);
    return NextResponse.json({
      submitted: true,
      name: result.name,
      totalRequests: result.totalRequests,
      estimatedCost,
    });
  } catch (err) {
    console.error('[batch-submit] failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
