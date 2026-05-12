/**
 * POST /api/internal/process-shot
 *
 * Cloud Tasks target — Phase 4. Each task processes one shot end-to-end:
 *   1. Idempotency check (skip if shot already past pending/queued)
 *   2. Dependency check (skip if deps still missing — will be re-enqueued
 *      when a dep completes)
 *   3. Mark `generating`, update slot progress + worker heartbeat
 *   4. Pick a Gemini + BytePlus key via round-robin counter
 *   5. Call /api/generate (same body shape as the loop uses)
 *   6. On completion:
 *        - Fan out newly-eligible dependent shots within the job
 *        - If job is now complete, finalize + releaseSlot + fan out the
 *          newly-promoted job's initial shots
 *
 * Authentication (defence in depth):
 *   - Cloud Tasks must invoke with an OIDC token whose audience matches this
 *     URL. Cloud Run enforces the audience check at the platform level when
 *     the service is configured with `--ingress=internal` or invoker IAM is
 *     locked down to TASKS_INVOKER_SA.
 *   - Additionally, we accept `X-Internal-Task-Secret` and compare to
 *     INTERNAL_TASK_SECRET when set. This is a belt-and-braces check that
 *     also lets local dev / curl bypass OIDC (set the secret in env).
 *
 * Response codes:
 *   - 200: success OR idempotent skip (don't retry)
 *   - 425 (Too Early): deps not yet met (don't retry — will be re-enqueued)
 *   - 5xx: transient error → Cloud Tasks retries with exponential backoff
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  shotsCol,
  listShots,
  updateSlotProgress,
  updateWorkerHeartbeat,
  updateJobStatus,
  releaseSlot,
} from '@/lib/firestore';
import { APP_CONFIG } from '@/lib/config';
import { enqueueEligibleShotsForJob, nextKeyIndex } from '@/lib/worker/tasks';

export const dynamic = 'force-dynamic';
export const maxDuration = 600; // 10 min — single shot can take 3-4 min in worst case

const INTERNAL_TASK_SECRET = process.env.INTERNAL_TASK_SECRET || '';

function loadKeyPool(prefix: string): string[] {
  const keys: string[] = [];
  const first = process.env[prefix];
  if (first) keys.push(first);
  for (let i = 2; i <= 20; i++) {
    const k = process.env[`${prefix}_${i}`];
    if (k) keys.push(k);
  }
  return keys;
}

function getInternalBase(): string {
  if (process.env.INTERNAL_BASE_URL) return process.env.INTERNAL_BASE_URL;
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

function authenticate(req: NextRequest): { ok: boolean; reason?: string } {
  // Endpoint is FAIL-CLOSED: if INTERNAL_TASK_SECRET isn't configured, reject
  // every call. This protects the route during Phase 4 rollout — the code
  // can ship before the secret is set, and the endpoint stays unreachable
  // until the Phase 4 env wiring is complete.
  if (!INTERNAL_TASK_SECRET) {
    return { ok: false, reason: 'INTERNAL_TASK_SECRET not configured on server' };
  }
  const got = req.headers.get('x-internal-task-secret');
  if (got !== INTERNAL_TASK_SECRET) {
    return { ok: false, reason: 'bad or missing X-Internal-Task-Secret' };
  }
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if (!auth.ok) {
    return NextResponse.json({ error: 'unauthorized', reason: auth.reason }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad request: invalid JSON' }, { status: 400 });
  }

  const { shotId, jobId, shotType, version, useDressedBase } = body as {
    shotId?: string;
    jobId?: string;
    shotType?: string;
    version?: number;
    useDressedBase?: boolean;
  };

  if (!shotId || !jobId || !shotType) {
    return NextResponse.json({ error: 'missing shotId/jobId/shotType' }, { status: 400 });
  }

  // ── 1. Idempotency check ────────────────────────────────────────────────
  const shotDoc = await shotsCol.doc(shotId).get();
  if (!shotDoc.exists) {
    console.warn(`[process-shot] ${shotType} ${shotId.substring(0, 8)} not found — task is stale, skipping`);
    return NextResponse.json({ ok: true, skipped: 'not-found' });
  }
  const shotData = shotDoc.data()!;
  const status = shotData.status as string;
  if (status !== 'pending' && status !== 'queued') {
    console.log(`[process-shot] ${shotType} ${shotId.substring(0, 8)} status=${status}, skipping`);
    return NextResponse.json({ ok: true, skipped: `status=${status}` });
  }

  // ── 2. Dependency check ─────────────────────────────────────────────────
  const siblings = await listShots(jobId);
  const byType: Record<string, any> = {};
  for (const s of siblings) byType[(s as any).shotType] = s;
  const deps = APP_CONFIG.shots[shotType as keyof typeof APP_CONFIG.shots]?.dependsOn || [];
  const depsMet = deps.every((dep: string) => {
    const d = byType[dep];
    return d && ((d as any).status === 'done' || (d as any).status === 'approved');
  });
  if (!depsMet) {
    console.log(`[process-shot] ${shotType} ${shotId.substring(0, 8)} deps not met — skipping (will re-enqueue on dep complete)`);
    return NextResponse.json({ ok: true, skipped: 'deps-not-met' }, { status: 200 });
  }

  // ── 3. Mark generating + slot progress ──────────────────────────────────
  await shotsCol.doc(shotId).update({
    status: 'generating',
    progressStep: 'queued by Cloud Tasks',
    progressPct: 0,
    updatedAt: new Date(),
  });
  await updateSlotProgress(jobId, shotType);
  await updateWorkerHeartbeat();

  // ── 4. Pick keys via round-robin ────────────────────────────────────────
  const KEY_POOL = loadKeyPool('GEMINI_API_KEY');
  const BYTEPLUS_POOL = loadKeyPool('BYTEPLUS_API_KEY');
  if (KEY_POOL.length === 0 || BYTEPLUS_POOL.length === 0) {
    await shotsCol.doc(shotId).update({
      status: 'pending',
      progressStep: 'key pool empty',
      updatedAt: new Date(),
    });
    return NextResponse.json({ error: 'key pool empty' }, { status: 500 });
  }
  const idx = await nextKeyIndex();
  const geminiKey = KEY_POOL[idx % KEY_POOL.length];
  const bytePlusKey = BYTEPLUS_POOL[idx % BYTEPLUS_POOL.length];
  console.log(
    `[process-shot] ${shotType} ${shotId.substring(0, 8)} → Gemini ...${geminiKey.slice(-4)} / BytePlus ...${bytePlusKey.slice(-4)} (idx=${idx})`,
  );

  // ── 5. Call /api/generate ───────────────────────────────────────────────
  let genOk = false;
  let genErr: string | null = null;
  let genStatus = 0;
  try {
    const res = await fetch(`${getInternalBase()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shotId,
        jobId,
        shotType,
        version: version ?? 1,
        apiKey: geminiKey,
        seedreamApiKey: bytePlusKey,
        ...(useDressedBase ? { useDressedBase: true } : {}),
      }),
    });
    genStatus = res.status;
    genOk = res.ok;
    if (!res.ok) genErr = (await res.text().catch(() => 'unknown')).slice(0, 300);
  } catch (e) {
    genErr = e instanceof Error ? e.message : String(e);
  }

  await updateWorkerHeartbeat();

  // /api/generate updates the shot status itself (done/failed). We only
  // intervene if the call itself failed (HTTP error) — reset to pending so
  // either the next retry of THIS task, or a future trigger, picks it up.
  if (!genOk) {
    console.error(`[process-shot] ${shotType} ${shotId.substring(0, 8)} generate failed (${genStatus}): ${genErr}`);
    // For 5xx, return 5xx so Cloud Tasks retries. For 4xx, treat as terminal
    // and let the shot stay in whatever state /api/generate left it in.
    if (genStatus >= 500 || genStatus === 0) {
      // Reset to pending so a retry can re-pick it. /api/generate may have
      // left it as 'failed' — but for transient/5xx we'd rather retry.
      try {
        await shotsCol.doc(shotId).update({ status: 'pending', updatedAt: new Date() });
      } catch { /* swallow */ }
      return NextResponse.json({ error: 'generate failed', genStatus, genErr }, { status: 503 });
    }
    // 4xx terminal — don't retry. Continue to finalization path so the job
    // gets closed if this was the last shot.
  } else {
    console.log(`[process-shot] ${shotType} ${shotId.substring(0, 8)} ✓`);
  }

  // ── 6. Fan out dependents + job finalization ────────────────────────────
  try {
    // Re-read shots since /api/generate may have transitioned this and others.
    const fanout = await enqueueEligibleShotsForJob(jobId);
    if (fanout.enqueued > 0) {
      console.log(`[process-shot] ${shotType} ${shotId.substring(0, 8)} → fanned out ${fanout.enqueued} dependents`);
    }
  } catch (e) {
    console.warn(`[process-shot] fan-out failed (non-fatal):`, e);
  }

  try {
    await maybeFinalizeJob(jobId);
  } catch (e) {
    console.warn(`[process-shot] finalize check failed (non-fatal):`, e);
  }

  return NextResponse.json({ ok: true, shotId, shotType, genOk, genStatus });
}

async function maybeFinalizeJob(jobId: string): Promise<void> {
  const shots = await listShots(jobId);
  const allTerminal = shots.length > 0 && shots.every(
    (s: any) => s.status === 'done' || s.status === 'approved' || s.status === 'failed',
  );
  if (!allTerminal) return;

  const anySucceeded = shots.some((s: any) => s.status === 'done' || s.status === 'approved');
  const finalStatus = anySucceeded ? 'review' : 'failed';
  await updateJobStatus(jobId, finalStatus);
  const failedCount = shots.filter((s: any) => s.status === 'failed').length;
  console.log(`[process-shot] Job ${jobId.substring(0, 8)} complete — ${finalStatus}${failedCount > 0 ? ` (${failedCount} shot(s) failed)` : ''}`);

  const next = await releaseSlot(jobId);
  if (next) {
    console.log(`[process-shot] Next job from queue: ${next.jobId.substring(0, 8)} — fanning out initial shots`);
    try {
      await enqueueEligibleShotsForJob(next.jobId);
    } catch (e) {
      console.warn('[process-shot] next-job fan-out failed:', e);
    }
  }
}
