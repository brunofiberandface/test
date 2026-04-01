import { NextRequest, NextResponse } from 'next/server';
import { storeOTP, verifyOTP, getUser, createUser, userHasPassword, setUserPassword } from '@/lib/firestore';
import { sendOTPEmail } from '@/lib/email';
import crypto from 'crypto';

const ALLOWED_DOMAINS = ['gstar-raw.com', 'g-star.com', 'fiberandface.com'];

// POST /api/auth/otp — check email, send OTP, verify OTP, set password
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, email: rawEmail, code, password } = body;
  const email = rawEmail?.toLowerCase().trim();

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  // ── CHECK: Does this email have access? ──
  if (action === 'check') {
    const domain = email.split('@')[1];
    let user = await getUser(email);

    // Auto-create for allowed domains
    if (!user && ALLOWED_DOMAINS.includes(domain)) {
      await createUser(email, {
        displayName: email.split('@')[0],
        role: 'creator',
      });
      user = await getUser(email);
    }

    if (!user || (user as Record<string, unknown>).active === false) {
      return NextResponse.json({
        authorized: false,
        error: 'This email is not authorized. Contact your admin.',
      });
    }

    const hasPassword = await userHasPassword(email);
    return NextResponse.json({
      authorized: true,
      hasPassword,
      displayName: (user as Record<string, unknown>).displayName || email.split('@')[0],
    });
  }

  // ── SEND: Generate and email OTP ──
  if (action === 'send') {
    // Verify user exists
    const user = await getUser(email);
    if (!user || (user as Record<string, unknown>).active === false) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    await storeOTP(email, otp);
    const sent = await sendOTPEmail(email, otp);

    return NextResponse.json({
      success: true,
      message: sent ? 'Code sent to your email' : 'Code generated (check server logs)',
    });
  }

  // ── VERIFY: Check OTP code ──
  if (action === 'verify') {
    if (!code) {
      return NextResponse.json({ error: 'Code required' }, { status: 400 });
    }

    const valid = await verifyOTP(email, code);
    if (!valid) {
      return NextResponse.json({ success: false, error: 'Invalid or expired code' }, { status: 401 });
    }

    return NextResponse.json({ success: true, verified: true });
  }

  // ── SET PASSWORD: After OTP verification ──
  if (action === 'set-password') {
    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    await setUserPassword(email, password);
    return NextResponse.json({ success: true, message: 'Password set' });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
