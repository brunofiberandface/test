import { NextRequest, NextResponse } from 'next/server';
import { updateUser } from '@/lib/firestore';

/**
 * PATCH /api/users/[email]
 * Update user role or active status.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  try {
    const { email } = await params;
    const decoded = decodeURIComponent(email);
    const body = await req.json();
    const updates: Record<string, any> = {};
    if (body.role !== undefined) updates.role = body.role;
    if (body.active !== undefined) updates.active = body.active;
    if (body.displayName !== undefined) updates.displayName = body.displayName;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    await updateUser(decoded, updates);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[Users PATCH]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
