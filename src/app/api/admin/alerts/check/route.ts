/**
 * GET/POST /api/admin/alerts/check
 *
 * Phase 3 alerter — invoked by Cloud Scheduler every 5 min. Pulls
 * /api/admin/health, checks for alerts, posts a message to a webhook
 * (Slack-compatible) when any condition crosses threshold.
 *
 * To avoid alert spam, posts at most one message per condition per 30 min
 * (via a Firestore-stored last-alert timestamp keyed by alert message hash).
 *
 * Required env: ALERT_WEBHOOK_URL (Slack incoming webhook URL).
 * Optional env: ALERT_WEBHOOK_DISABLED=1 to disable without removing env.
 *
 * Returns JSON summary: { alertsFired, alertsSkippedAsDupe, errors }.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/firestore';
import crypto from 'crypto';

const SUPPRESSION_MS = 30 * 60_000;  // 30 min dedupe window
const ALERT_LOG_COL = db.collection('alertLog');

interface HealthAlert {
  severity: 'info' | 'warn' | 'critical';
  message: string;
}

function hashMessage(msg: string): string {
  return crypto.createHash('sha256').update(msg).digest('hex').substring(0, 16);
}

async function shouldFire(hash: string, now: number): Promise<boolean> {
  const doc = await ALERT_LOG_COL.doc(hash).get();
  if (!doc.exists) return true;
  const lastFiredMs = (doc.data()?.lastFiredAt as { toDate?: () => Date })?.toDate?.()?.getTime?.() || 0;
  return (now - lastFiredMs) > SUPPRESSION_MS;
}

async function recordFired(hash: string, alert: HealthAlert): Promise<void> {
  await ALERT_LOG_COL.doc(hash).set({
    severity: alert.severity,
    message: alert.message.slice(0, 500),
    lastFiredAt: new Date(),
  }, { merge: true });
}

function isHeartbeatAlert(a: HealthAlert): boolean {
  return /worker heartbeat stale/i.test(a.message);
}

/**
 * Attempt auto-recovery for the heartbeat alert. Returns the recovery result
 * so the caller can adjust the Slack message text. Idempotent — safe to call
 * even when no recovery is needed.
 */
async function tryAutoHeal(baseUrl: string): Promise<{ ok: boolean; message: string } | null> {
  try {
    const resp = await fetch(`${baseUrl}/api/admin/worker/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: !!data.ok, message: data.message || `HTTP ${resp.status}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

async function postToWebhook(
  alerts: HealthAlert[],
  autoHeal: { ok: boolean; message: string } | null,
): Promise<{ ok: boolean; status?: number; err?: string }> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return { ok: false, err: 'ALERT_WEBHOOK_URL not set' };
  if (process.env.ALERT_WEBHOOK_DISABLED === '1') return { ok: false, err: 'disabled by env' };

  // Slack-style payload: { text: "..." }. Works for Slack, Discord (with
  // /slack endpoint), and any webhook accepting plain JSON {text}.
  const sevEmoji = { critical: '🔴', warn: '🟡', info: '🔵' } as const;
  const lines = alerts.map(a => `${sevEmoji[a.severity]} *${a.severity.toUpperCase()}*: ${a.message}`);
  const baseUrl = process.env.INTERNAL_BASE_URL || 'https://gstar-ai-studio-674145888056.europe-west1.run.app';
  const dashboardUrl = `${baseUrl}/admin/monitoring`;
  const recoverUrl = `${baseUrl}/api/admin/worker/recover`;

  // If we attempted auto-heal for a heartbeat alert, prepend the outcome so
  // the message tells the user the system has already attempted to fix it.
  let autoHealLine = '';
  if (autoHeal) {
    autoHealLine = autoHeal.ok
      ? `\n🟢 *AUTO-RECOVERED*: ${autoHeal.message}`
      : `\n⚠️ *AUTO-RECOVERY FAILED*: ${autoHeal.message}`;
  }

  // Always include the tap-to-recover link when any heartbeat-related alert
  // is in the batch — it's mobile-friendly and idempotent.
  const showRecoverLink = alerts.some(isHeartbeatAlert);
  const recoverLine = showRecoverLink
    ? `\n<${recoverUrl}|🔧 Tap to recover worker>`
    : '';

  const text = `*gstar-ai-studio alert* (${alerts.length})\n${lines.join('\n')}${autoHealLine}\n<${dashboardUrl}|Open monitoring dashboard>${recoverLine}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : String(e) };
  }
}

async function runCheck() {
  const base = process.env.INTERNAL_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  let alerts: HealthAlert[] = [];
  try {
    const healthRes = await fetch(`${base}/api/admin/health`, { method: 'GET' });
    if (!healthRes.ok) {
      return { ok: false, error: `health endpoint returned ${healthRes.status}`, alertsFired: 0, alertsSkippedAsDupe: 0 };
    }
    const data = await healthRes.json();
    alerts = (data.alerts as HealthAlert[]) || [];
  } catch (e) {
    return { ok: false, error: `health fetch failed: ${e instanceof Error ? e.message : String(e)}`, alertsFired: 0, alertsSkippedAsDupe: 0 };
  }

  if (alerts.length === 0) {
    return { ok: true, alertsFired: 0, alertsSkippedAsDupe: 0, message: 'no alerts' };
  }

  const now = Date.now();
  let fired = 0;
  let skipped = 0;
  const toFire: HealthAlert[] = [];
  for (const alert of alerts) {
    const hash = hashMessage(alert.message);
    const should = await shouldFire(hash, now);
    if (should) {
      toFire.push(alert);
      await recordFired(hash, alert);
      fired++;
    } else {
      skipped++;
    }
  }

  // ── AUTO-HEAL (2026-05-14) ──────────────────────────────────────────────
  // When the heartbeat alert is present, the worker is most likely dead and
  // the singleton lock is preventing fresh claims. Call the recover endpoint
  // before posting to Slack so Bruno sees ONE message: "Auto-recovered" —
  // instead of repeated "Worker may be dead" alarms every 5 min until he
  // gets to a laptop. The recovery is idempotent; if the worker is actually
  // healthy, the brief disruption self-resolves on the next heartbeat tick.
  //
  // We run auto-heal on the SCANNED alerts (not just the toFire dedupe'd
  // subset) — a previously-fired heartbeat alert that got skipped as dupe
  // still indicates the worker is dead and still needs recovery.
  let autoHeal: { ok: boolean; message: string } | null = null;
  const hasHeartbeatAlert = alerts.some(a => /worker heartbeat stale/i.test(a.message));
  if (hasHeartbeatAlert) {
    autoHeal = await tryAutoHeal(base);
  }

  let webhookResult: { ok: boolean; status?: number; err?: string } | null = null;
  if (toFire.length > 0) {
    webhookResult = await postToWebhook(toFire, autoHeal);
  }

  return {
    ok: true,
    alertsFired: fired,
    alertsSkippedAsDupe: skipped,
    autoHeal,
    webhookResult,
  };
}

export async function GET() {
  return NextResponse.json(await runCheck());
}

export async function POST() {
  return NextResponse.json(await runCheck());
}
