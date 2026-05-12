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

async function postToWebhook(alerts: HealthAlert[]): Promise<{ ok: boolean; status?: number; err?: string }> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return { ok: false, err: 'ALERT_WEBHOOK_URL not set' };
  if (process.env.ALERT_WEBHOOK_DISABLED === '1') return { ok: false, err: 'disabled by env' };

  // Slack-style payload: { text: "..." }. Works for Slack, Discord (with
  // /slack endpoint), and any webhook accepting plain JSON {text}.
  const sevEmoji = { critical: '🔴', warn: '🟡', info: '🔵' } as const;
  const lines = alerts.map(a => `${sevEmoji[a.severity]} *${a.severity.toUpperCase()}*: ${a.message}`);
  const dashboardUrl = (process.env.INTERNAL_BASE_URL || 'https://gstar-ai-studio-674145888056.europe-west1.run.app') + '/admin/monitoring';
  const text = `*gstar-ai-studio alert* (${alerts.length})\n${lines.join('\n')}\n<${dashboardUrl}|Open monitoring dashboard>`;

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

  let webhookResult: { ok: boolean; status?: number; err?: string } | null = null;
  if (toFire.length > 0) {
    webhookResult = await postToWebhook(toFire);
  }

  return {
    ok: true,
    alertsFired: fired,
    alertsSkippedAsDupe: skipped,
    webhookResult,
  };
}

export async function GET() {
  return NextResponse.json(await runCheck());
}

export async function POST() {
  return NextResponse.json(await runCheck());
}
