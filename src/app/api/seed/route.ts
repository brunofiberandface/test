import { NextResponse } from 'next/server';
import { getUser, createUser, setUserPassword } from '@/lib/firestore';

// One-time seed endpoint — creates Bruno's admin account with password
// DELETE this file after first use for security
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  // Simple protection
  if (key !== 'gstar2026seed') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const email = searchParams.get('email') || 'bruno@fiberandface.com';
  const password = 'GstarStudio2026!';

  try {
    // Check if user already exists
    let user = await getUser(email);
    if (!user) {
      await createUser(email, {
        displayName: 'Bruno Dheedene',
        role: 'admin',
      });
      user = await getUser(email);
    }

    // Set password
    await setUserPassword(email, password);

    return NextResponse.json({
      success: true,
      message: `Account seeded for ${email}`,
      hint: 'Password: GstarStudio2026! — change this after first login',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
