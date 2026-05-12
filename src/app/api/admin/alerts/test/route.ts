/**
 * GET/POST /api/admin/alerts/test
 *
 * One-off webhook verification endpoint. Posts a synthetic "this is a test"
 * alert to ALERT_WEBHOOK_URL and returns the webhook response status.
 *
 * Use after changing ALERT_WEBHOOK_URL or after a Slack channel reroute, to
 * prove delivery end-to-end without waiting for a real production alert.
 */
import { NextResponse } from 'next/server';

async function sendTest() {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return { ok: false, error: 'ALERT_WEBHOOK_URL not set' };
  if (process.env.ALERT_WEBHOOK_DISABLED === '1') return { ok: false, error: 'ALERT_WEBHOOK_DISABLED=1' };

  const dashboardUrl = (process.env.INTERNAL_BASE_URL || 'https://gstar-ai-studio-674145888056.europe-west1.run.app') + '/admin/monitoring';
  const text = `🔵 *gstar-ai-studio webhook test* — if you see this, alerts are wired correctly. <${dashboardUrl}|Open monitoring dashboard>`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const body = await resp.text().catch(() => '');
    return { ok: resp.ok, status: resp.status, body: body.slice(0, 200) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET() {
  return NextResponse.json(await sendTest());
}

export async function POST() {
  return NextResponse.json(await sendTest());
}
