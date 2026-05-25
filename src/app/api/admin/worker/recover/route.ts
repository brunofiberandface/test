/**
 * GET/POST /api/admin/worker/recover
 *
 * Mobile-tappable + autonomous worker recovery.
 *
 * BACKGROUND (2026-05-14):
 *   When the in-proc worker dies (Cloud Run revision deleted, OOM, etc.) but
 *   active slots are still in Firestore, the singleton lock blocks any new
 *   worker from claiming. Health checks fire `Worker heartbeat stale: X min
 *   old` alerts on Slack every 5 min via /api/admin/alerts/check. Pre-this
 *   endpoint, the only fix was to run scripts/deploy-and-cycle-worker.sh
 *   locally (force-release lock + trigger worker). That required a laptop.
 *
 *   This endpoint does the same lock-release + trigger work via plain HTTP
 *   so:
 *     - The alerts/check cron can call it autonomously (auto-heal)
 *     - Bruno can tap a Slack link on his phone to recover manually
 *
 * WHAT IT DOES:
 *   1. Backdate `system/generationQueue` workerHeartbeat to 1 hour ago and
 *      set workerActive=false. This makes the singleton claim immediately
 *      available regardless of what state the previous worker was in.
 *   2. Fire-and-forget POST to /api/jobs/process-queue to trigger a fresh
 *      worker claim on the current revision.
 *
 * IDEMPOTENT: calling it on a healthy worker temporarily disrupts the
 * singleton for one tick — the healthy worker re-heartbeats on its next
 * iteration. No data loss. No destructive ops.
 *
 * AUTH: none. The endpoint is idempotent and low-stakes; worst case is a
 * brief disruption that self-resolves. Slack tappable links work without
 * auth on the user's phone browser. If abuse becomes a concern we can add
 * a query-string secret (env: WORKER_RECOVER_SECRET).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firestore';

const QUEUE_DOC = db.collection('system').doc('generationQueue');

interface RecoveryResult {
  ok: boolean;
  step1_releaseLock: { ok: boolean; previousHeartbeat: string | null; previousActive: boolean; error?: string };
  step2_triggerWorker: { ok: boolean; status?: number; error?: string };
  message: string;
}

async function recoverWorker(): Promise<RecoveryResult> {
  // Step 1: Read current state (for the result), then force-release lock
  let previousHeartbeat: string | null = null;
  let previousActive = false;
  let releaseOk = false;
  let releaseErr: string | undefined;

  try {
    const snap = await QUEUE_DOC.get();
    if (snap.exists) {
      const d = snap.data() as { workerHeartbeat?: string; workerActive?: boolean } | undefined;
      previousHeartbeat = d?.workerHeartbeat || null;
      previousActive = d?.workerActive || false;
    }
    // Backdate heartbeat to 1h ago so any worker claim immediately succeeds
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    await QUEUE_DOC.set({
      workerActive: false,
      workerHeartbeat: oneHourAgo,
    }, { merge: true });
    releaseOk = true;
  } catch (e) {
    releaseErr = e instanceof Error ? e.message : String(e);
  }

  // Step 2: Trigger fresh worker. Fire-and-forget — process-queue holds the
  // request open for the duration of the worker loop (minutes), so we use a
  // short timeout and don't await the full response body.
  let triggerOk = false;
  let triggerStatus: number | undefined;
  let triggerErr: string | undefined;

  const baseUrl = process.env.INTERNAL_BASE_URL
    || `http://localhost:${process.env.PORT || '3000'}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const resp = await fetch(`${baseUrl}/api/jobs/process-queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    }).catch((e: Error) => {
      // AbortError is expected (worker keeps the connection open)
      if (e.name === 'AbortError') {
        return { ok: true, status: 200 } as Response;
      }
      throw e;
    });
    clearTimeout(timer);
    triggerStatus = resp.status;
    triggerOk = resp.ok;
  } catch (e) {
    triggerErr = e instanceof Error ? e.message : String(e);
    // If the abort fired before we set ok, we still treat it as a successful
    // trigger — the worker takes the request and keeps it open.
    if (triggerErr.includes('aborted') || triggerErr.includes('AbortError')) {
      triggerOk = true;
      triggerErr = undefined;
    }
  }

  const ok = releaseOk && triggerOk;
  const message = ok
    ? 'Worker recovered: lock released and fresh worker triggered.'
    : `Recovery partial: lock=${releaseOk ? 'OK' : 'FAILED'}, trigger=${triggerOk ? 'OK' : 'FAILED'}`;

  return {
    ok,
    step1_releaseLock: { ok: releaseOk, previousHeartbeat, previousActive, error: releaseErr },
    step2_triggerWorker: { ok: triggerOk, status: triggerStatus, error: triggerErr },
    message,
  };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export async function POST() {
  const result = await recoverWorker();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

/**
 * GET — designed for Slack/phone tap. Runs the recovery and returns a small
 * mobile-friendly HTML page showing the result. The Slack alert template
 * includes a link to this endpoint so users can recover with one tap.
 */
export async function GET(_req: NextRequest) {
  const result = await recoverWorker();
  const statusEmoji = result.ok ? '🟢' : '🔴';
  const heading = result.ok ? 'Worker recovered' : 'Recovery had issues';
  const prevHb = result.step1_releaseLock.previousHeartbeat
    ? new Date(result.step1_releaseLock.previousHeartbeat).toISOString()
    : '(none)';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>${heading} — gstar-ai-studio</title>
  <style>
    body {
      font: 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 24px;
      background: #f5f5f5;
      color: #1a1a1a;
      -webkit-text-size-adjust: 100%;
    }
    .card {
      background: #fff;
      max-width: 520px;
      margin: 12vh auto 0;
      padding: 28px 24px;
      border-radius: 18px;
      box-shadow: 0 2px 16px rgba(0,0,0,0.06);
    }
    h1 { margin: 0 0 16px; font-size: 28px; font-weight: 600; }
    p { margin: 0 0 12px; line-height: 1.45; }
    .row { display: flex; justify-content: space-between; padding: 12px 0; border-top: 1px solid #ececec; }
    .row:first-of-type { border-top: none; }
    .label { color: #666; font-size: 14px; }
    .value { color: #1a1a1a; font-size: 15px; font-weight: 500; text-align: right; max-width: 60%; }
    .btn {
      display: block;
      margin-top: 28px;
      padding: 16px 20px;
      background: #1a1a1a;
      color: #fff;
      text-align: center;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 600;
      font-size: 17px;
    }
    .btn-secondary { background: #ececec; color: #1a1a1a; margin-top: 10px; }
    .timestamp { color: #999; font-size: 12px; margin-top: 16px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${statusEmoji} ${heading}</h1>
    <p>${result.message}</p>

    <div class="row">
      <span class="label">Previous heartbeat</span>
      <span class="value">${escapeHtml(prevHb)}</span>
    </div>
    <div class="row">
      <span class="label">Lock release</span>
      <span class="value">${result.step1_releaseLock.ok ? '✅ OK' : '❌ ' + escapeHtml(result.step1_releaseLock.error || 'failed')}</span>
    </div>
    <div class="row">
      <span class="label">Worker trigger</span>
      <span class="value">${result.step2_triggerWorker.ok ? '✅ OK' : '❌ ' + escapeHtml(result.step2_triggerWorker.error || 'failed')}</span>
    </div>

    <a href="/admin/monitoring" class="btn">Open monitoring dashboard</a>
    <a href="/api/admin/worker/recover" class="btn btn-secondary">Recover again</a>

    <p class="timestamp">${new Date().toISOString()}</p>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status: result.ok ? 200 : 500,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
