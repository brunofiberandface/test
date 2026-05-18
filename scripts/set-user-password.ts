/**
 * One-off: set a password directly for a user (bypasses the OTP-then-set
 * flow). Used when email delivery is broken and a user can't receive the
 * 6-digit OTP. Admin manually hands the password to the user via another
 * channel.
 *
 * Also creates the user record with `active: true, role: 'creator'` if
 * they don't already exist, so non-admin-domain users (e.g. @g-star.com)
 * can still authenticate via the credentials provider.
 *
 * Usage:
 *   npx tsx scripts/set-user-password.ts <email> <password>
 *
 * Example:
 *   npx tsx scripts/set-user-password.ts yasemin-goergec@g-star.com '8pZ#3vL9kQ'
 */
import * as fs from 'fs';
import * as path from 'path';
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  const c = fs.readFileSync(envPath, 'utf-8');
  for (const line of c.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { getUser, createUser, setUserPassword, updateUser } from '../src/lib/firestore';

const [rawEmail, password] = process.argv.slice(2);
if (!rawEmail || !password) {
  console.error('Usage: npx tsx scripts/set-user-password.ts <email> <password>');
  process.exit(1);
}
if (password.length < 6) {
  console.error('Password must be at least 6 characters.');
  process.exit(1);
}

const email = rawEmail.toLowerCase().trim();

(async () => {
  let user = await getUser(email);
  if (!user) {
    console.log(`User ${email} does not exist — creating with active=true, role=creator`);
    await createUser(email, {
      displayName: email.split('@')[0],
      role: 'creator',
    });
    user = await getUser(email);
  } else {
    const data = user as Record<string, unknown>;
    if (data.active === false) {
      console.log(`User ${email} exists but inactive — re-enabling`);
      await updateUser(email, { active: true });
    } else {
      console.log(`User ${email} already active`);
    }
  }
  await setUserPassword(email, password);
  console.log(`✓ Password set for ${email}.`);
  console.log(`  They can now log in via the email + password flow (mode='password').`);
  console.log(`  No OTP email needed.`);
})().catch(e => { console.error(e); process.exit(1); });
