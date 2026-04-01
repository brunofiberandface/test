import { NextRequest, NextResponse } from 'next/server';
import { listUsers, createUser } from '@/lib/firestore';

/**
 * GET /api/users
 * List all users (admin only in production).
 */
export async function GET() {
  try {
    const users = await listUsers();
    return NextResponse.json({ users });
  } catch (err: any) {
    console.error('[Users GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/users
 * Create a new user.
 */
export async function POST(req: NextRequest) {
  try {
    const { email, displayName, role } = await req.json();
    if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });
    await createUser(email, {
      displayName: displayName || email.split('@')[0],
      role: role || 'creator',
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[Users POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
