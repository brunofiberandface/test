import { NextRequest, NextResponse } from 'next/server';
import { usersCol } from '@/lib/firestore';

// POST /api/admin/migrate-user — one-time migration: copy user data from old email to new email
// Body: { fromEmail, toEmail }
export async function POST(req: NextRequest) {
  try {
    const { fromEmail, toEmail } = await req.json();
    if (!fromEmail || !toEmail) {
      return NextResponse.json({ error: 'fromEmail and toEmail required' }, { status: 400 });
    }

    // Read old user doc
    const oldDoc = await usersCol.doc(fromEmail).get();
    if (!oldDoc.exists) {
      return NextResponse.json({ error: `User ${fromEmail} not found` }, { status: 404 });
    }

    const oldData = oldDoc.data()!;

    // Create new user doc with same data (including password hash)
    await usersCol.doc(toEmail).set({
      ...oldData,
      displayName: oldData.displayName || toEmail.split('@')[0],
      migratedFrom: fromEmail,
      migratedAt: new Date(),
    });

    console.log(`[Admin] Migrated user ${fromEmail} → ${toEmail}`);
    return NextResponse.json({ success: true, from: fromEmail, to: toEmail });
  } catch (error) {
    console.error('[Admin] Migration failed:', error);
    return NextResponse.json({ error: 'Migration failed' }, { status: 500 });
  }
}
