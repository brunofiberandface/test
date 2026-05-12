/**
 * POST /api/admin/reformat-shots
 *
 * Re-export PDP + PLP for existing shots from their stored master, WITHOUT
 * re-rendering through Gemini/Seedream. Use after a deliverable-format.ts
 * change (e.g. the 2026-05-12 cover→contain fix for aspect mismatches) to
 * propagate the new export behaviour to historical shots — including approved
 * ones, since approved shots get downloaded by the brand team.
 *
 * The shot document is NOT touched beyond updating pdpUrl + plpUrl. Status
 * stays done/approved, imageUrl stays the same master. No re-generation, no
 * Gemini/BytePlus API calls, no cost.
 *
 * Auth: X-Internal-Task-Secret header (same secret as /api/internal/process-shot).
 *
 * Body:
 *   { shotIds: string[] }           — reformat specific shots
 *   OR
 *   { shotType: 'M01'|'M02'|'M05'|'M06', status?: 'done'|'approved'|'both',
 *     limit?: number, jobId?: string }
 *                                  — sweep all matching shots
 *
 * Concurrency is capped at 5 to avoid OOM on the Cloud Run container while
 * also draining batches quickly. Each shot ~2-3s (download + sharp + upload).
 *
 * Returns: {
 *   processed: number,
 *   skipped: { shotId: string; reason: string }[],
 *   errors:   { shotId: string; error: string }[],
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, shotsCol } from '@/lib/firestore';
import { uploadGeneratedImage } from '@/lib/gcs';
import { formatBoth, isDeliverableShot } from '@/lib/pipeline/deliverable-format';
import type { ShotType } from '@/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const INTERNAL_TASK_SECRET = process.env.INTERNAL_TASK_SECRET || '';
const MAX_CONCURRENCY = 5;

interface ProcessResult {
  processed: number;
  skipped: { shotId: string; reason: string }[];
  errors: { shotId: string; error: string }[];
}

async function reformatOne(shotId: string): Promise<{ ok: boolean; reason?: string; error?: string }> {
  const doc = await shotsCol.doc(shotId).get();
  if (!doc.exists) return { ok: false, reason: 'shot-not-found' };
  const data = doc.data()!;

  const shotType = data.shotType as ShotType;
  if (!isDeliverableShot(shotType)) return { ok: false, reason: `not-deliverable-shot-type (${shotType})` };

  const status = data.status as string;
  if (status !== 'done' && status !== 'approved') return { ok: false, reason: `status=${status}` };

  const imageUrl = data.imageUrl as string | undefined;
  if (!imageUrl) return { ok: false, reason: 'no-master-imageUrl' };

  const jobId = data.jobId as string | undefined;
  if (!jobId) return { ok: false, reason: 'no-jobId' };

  // Look up the job to get the folder name (jobName) and modelId for filenames
  const jobDoc = await db.collection('jobs').doc(jobId).get();
  if (!jobDoc.exists) return { ok: false, reason: 'job-not-found' };
  const job = jobDoc.data()!;
  const jobName = (job.jobName as string) || jobId;
  const modelId = (job.modelId as string) || 'unknown';
  const version = (data.version as number) || 1;

  // Fetch the master image
  let masterBuf: Buffer;
  try {
    const cleanUrl = imageUrl.split('?')[0];
    const r = await fetch(cleanUrl);
    if (!r.ok) return { ok: false, error: `fetch master ${r.status}` };
    masterBuf = Buffer.from(await r.arrayBuffer());
  } catch (e) {
    return { ok: false, error: `fetch master: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Re-format
  let pdp: Buffer, plp: Buffer;
  try {
    const out = await formatBoth(masterBuf);
    pdp = out.pdp;
    plp = out.plp;
  } catch (e) {
    return { ok: false, error: `formatBoth: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Upload (overwrites the existing pdp/plp at the same path)
  const pdpName = `${modelId}_${shotType}_v${version}_pdp.jpg`;
  const plpName = `${modelId}_${shotType}_v${version}_plp.jpg`;
  let pdpUrl: string, plpUrl: string;
  try {
    [pdpUrl, plpUrl] = await Promise.all([
      uploadGeneratedImage(jobName, pdpName, pdp, 'image/jpeg'),
      uploadGeneratedImage(jobName, plpName, plp, 'image/jpeg'),
    ]);
  } catch (e) {
    return { ok: false, error: `upload: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Update shot doc — ONLY pdpUrl + plpUrl, NOT status. Don't touch the master.
  await shotsCol.doc(shotId).update({
    pdpUrl,
    plpUrl,
    pdpReformattedAt: new Date(),
  });

  return { ok: true };
}

/** Bounded-concurrency map. Caps simultaneous reformatOne calls at MAX_CONCURRENCY. */
async function mapWithConcurrency<T, R>(items: T[], fn: (item: T) => Promise<R>, n: number): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
  return out;
}

export async function POST(req: NextRequest) {
  if (!INTERNAL_TASK_SECRET) {
    return NextResponse.json({ error: 'INTERNAL_TASK_SECRET not set on server' }, { status: 500 });
  }
  if (req.headers.get('x-internal-task-secret') !== INTERNAL_TASK_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  // Resolve the shotId list
  let shotIds: string[] = [];
  if (Array.isArray(body.shotIds) && body.shotIds.length > 0) {
    shotIds = body.shotIds.filter((x: any) => typeof x === 'string');
  } else if (body.shotType) {
    const shotType = body.shotType as string;
    const statusFilter = body.status as ('done' | 'approved' | 'both' | undefined);
    const limit = Math.min(typeof body.limit === 'number' ? body.limit : 500, 1000);
    let q = shotsCol.where('shotType', '==', shotType) as FirebaseFirestore.Query;
    if (body.jobId) q = q.where('jobId', '==', body.jobId);
    if (statusFilter === 'done') q = q.where('status', '==', 'done');
    else if (statusFilter === 'approved') q = q.where('status', '==', 'approved');
    // 'both' or undefined → no status filter, then filter client-side below
    const snap = await q.limit(limit).get();
    shotIds = snap.docs
      .filter(d => {
        if (statusFilter === 'done' || statusFilter === 'approved') return true;
        const s = d.data().status;
        return s === 'done' || s === 'approved';
      })
      .map(d => d.id);
  } else {
    return NextResponse.json({ error: 'provide shotIds[] OR shotType' }, { status: 400 });
  }

  if (shotIds.length === 0) {
    return NextResponse.json({ processed: 0, skipped: [], errors: [], message: 'no shots matched' });
  }

  console.log(`[reformat-shots] starting batch of ${shotIds.length} shots, concurrency=${MAX_CONCURRENCY}`);

  const result: ProcessResult = { processed: 0, skipped: [], errors: [] };
  const results = await mapWithConcurrency(shotIds, async (sid) => {
    const r = await reformatOne(sid);
    if (r.ok) result.processed++;
    else if (r.error) result.errors.push({ shotId: sid, error: r.error });
    else if (r.reason) result.skipped.push({ shotId: sid, reason: r.reason });
    return r;
  }, MAX_CONCURRENCY);

  console.log(`[reformat-shots] done: processed=${result.processed} skipped=${result.skipped.length} errors=${result.errors.length}`);
  return NextResponse.json({
    total: shotIds.length,
    processed: result.processed,
    skipped: result.skipped,
    errors: result.errors,
    ...(results.length < 50 ? {} : { _note: 'detail truncated; see processed count' }),
  });
}
