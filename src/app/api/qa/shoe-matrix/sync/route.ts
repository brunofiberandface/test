/**
 * POST /api/qa/shoe-matrix/sync
 * Body (optional): { reconcileOnly?: boolean, newModelBufferMs?: number, renderBudgetMs?: number }
 *
 * Reconciles the shoe×model matrix against current active shoes and active
 * models, then renders any pending/failed cells within a time budget.
 *
 * Behaviour:
 *   - Cells whose model is no longer active (or whose shoe was deleted) are
 *     marked `archived: true` — kept in Firestore for audit, hidden from UI.
 *   - Cells whose model is re-activated are un-archived (existing render kept,
 *     re-rendered only if `status === 'failed'`).
 *   - New (active shoe × active model) pairs get a pending cell, provided the
 *     model is older than the buffer (default 1h — prevents misclick-driven
 *     compute).
 *   - Pending + failed cells are rendered sequentially until the budget runs
 *     out. Anything left over stays pending for the next sync call.
 *
 * Pass `reconcileOnly: true` for a fast housekeeping pass that only touches
 * Firestore (no Seedream calls). Useful for hooking into model archive/create
 * flows where we want stale cells cleaned up immediately.
 *
 * GET /api/qa/shoe-matrix/sync
 * Same as POST with default options — convenient for Cloud Scheduler / cron
 * trigger URLs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { syncMatrix, type SyncMatrixOptions } from '@/lib/qa/shoe-matrix';

// Render budget caps at ~13min so we stay well under Cloud Run's 900s request
// timeout. The sync endpoint itself runs longer than that occasionally during
// large backlogs — set maxDuration to the platform max.
export const maxDuration = 900;

async function runSync(options: SyncMatrixOptions) {
  const result = await syncMatrix(options);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as SyncMatrixOptions;
    return await runSync(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ShoeMatrix sync]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  try {
    return await runSync({});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ShoeMatrix sync GET]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
