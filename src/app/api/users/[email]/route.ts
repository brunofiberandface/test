import { NextRequest, NextResponse } from 'next/server';
import { updateUser, setUserPassword } from '@/lib/firestore';

/**
 * PATCH /api/users/[email]
 * Update user role, active status, displayName, OR password.
 *
 * Password handling is separate from the other fields — it's hashed +
 * stored via setUserPassword (which manages salt/hash/passwordSetAt).
 * Admin sets password directly here as a workaround when the OTP email
 * doesn't reach the user (spam, firewall, etc.). Min 6 chars enforced.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  try {
    const { email } = await params;
    const decoded = decodeURIComponent(email);
    const body = await req.json();

    // Password is handled separately because it goes through hash+salt.
    if (typeof body.password === 'string') {
      if (body.password.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
      }
      await setUserPassword(decoded, body.password);
      // Allow combining password with other field updates in the same call.
    }

    const updates: Record<string, any> = {};
    if (body.role !== undefined) updates.role = body.role;
    if (body.active !== undefined) updates.active = body.active;
    if (body.displayName !== undefined) updates.displayName = body.displayName;

    if (Object.keys(updates).length === 0 && typeof body.password !== 'string') {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }
    if (Object.keys(updates).length > 0) {
      await updateUser(decoded, updates);
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[Users PATCH]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
