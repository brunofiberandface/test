/**
 * Email sending via Resend API.
 * Sends from notifications@fiberandface.com (or RESEND_FROM env var).
 * Falls back to console.log when RESEND_API_KEY is not set (local dev).
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.RESEND_FROM || 'G-Star AI Studio <notifications@fiberandface.com>';

async function sendEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log(`[Email] (dev) Would send "${opts.subject}" to ${opts.to.join(', ')}`);
    return true;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Email] Resend API error ${res.status}: ${errText}`);
      return false;
    }

    const data = await res.json();
    console.log(`[Email] Sent "${opts.subject}" to ${opts.to.join(', ')} (id=${data.id})`);
    return true;
  } catch (err) {
    console.error('[Email] Failed to send:', err);
    return false;
  }
}

export async function sendOTPEmail(email: string, code: string): Promise<boolean> {
  const html = `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
      <h1 style="font-size: 24px; font-weight: bold; letter-spacing: -0.5px; margin: 0 0 4px;">G-STAR</h1>
      <p style="font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 3px; margin: 0 0 32px;">AI Studio</p>

      <p style="font-size: 14px; color: #333; margin: 0 0 24px;">Your verification code:</p>

      <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 0 0 24px;">
        <span style="font-size: 32px; font-family: 'SF Mono', 'Courier New', monospace; letter-spacing: 8px; font-weight: bold; color: #000;">${code}</span>
      </div>

      <p style="font-size: 12px; color: #999;">This code expires in 5 minutes. If you didn't request this, ignore this email.</p>
    </div>
  `;

  return sendEmail({
    to: [email],
    subject: `${code} — G-Star AI Studio verification`,
    html,
  });
}

/**
 * Send comment notification emails to all other users on a job thread.
 */
export async function sendCommentNotification(opts: {
  recipients: string[];
  authorName: string;
  authorEmail: string;
  jobName: string;
  jobId: string;
  shotType?: string;
  commentText: string;
}): Promise<boolean> {
  const { recipients, authorName, authorEmail, jobName, jobId, shotType, commentText } = opts;
  if (recipients.length === 0) return true;

  const studioUrl = process.env.NEXTAUTH_URL || 'https://gstar-ai-studio-674145888056.europe-west1.run.app';
  const jobUrl = `${studioUrl}/jobs/${jobId}/results`;
  const shotLabel = shotType ? ` on ${shotType}` : '';

  const html = `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px 20px;">
      <h1 style="font-size: 20px; font-weight: bold; letter-spacing: -0.5px; margin: 0 0 4px;">G-STAR</h1>
      <p style="font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 3px; margin: 0 0 24px;">AI Studio</p>

      <p style="font-size: 14px; color: #333; margin: 0 0 16px;">
        <strong>${authorName}</strong> commented${shotLabel} on <strong>${jobName}</strong>:
      </p>

      <div style="background: #f5f5f5; padding: 16px; border-left: 3px solid #333; margin: 0 0 24px;">
        <p style="font-size: 14px; color: #333; margin: 0; white-space: pre-wrap;">${commentText}</p>
      </div>

      <a href="${jobUrl}" style="display: inline-block; background: #1a1a1a; color: #fff; padding: 10px 24px; text-decoration: none; font-size: 13px; font-weight: 500;">
        View Job
      </a>

      <p style="font-size: 11px; color: #bbb; margin: 24px 0 0;">
        Reply by commenting in the studio. You received this because you're part of this job thread.
      </p>
    </div>
  `;

  return sendEmail({
    to: recipients,
    subject: `${authorName} commented${shotLabel} — ${jobName}`,
    html,
    replyTo: authorEmail,
  });
}
