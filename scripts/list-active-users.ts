/**
 * Read-only: list current users in Firestore + flag who needs to be added
 * to the Entra group `APP-G-STAR-AI-Studio` before the Azure AD SSO deploy.
 *
 * Run from gstar-studio/ root:
 *   npx tsx scripts/list-active-users.ts
 *
 * Output groups:
 *   KEEPS EMAIL/OTP ACCESS  → fiberandface.com domain or whitelisted Gmail
 *   MUST USE MICROSOFT      → everyone else (gstar-raw.com, g-star.com, etc.)
 *                             → these users must be members of the Entra
 *                                group BEFORE deploy or they get locked out.
 */
import * as path from 'path';
import * as fs from 'fs';

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

import { Firestore } from '@google-cloud/firestore';

const ADMIN_DOMAINS = ['fiberandface.com'];
const ADMIN_WHITELIST = ['brunodheedene@gmail.com', 'bruno@fiberandface.com'];

function classify(email: string): 'admin-email' | 'azure-required' {
  const lower = email.toLowerCase();
  if (ADMIN_WHITELIST.includes(lower)) return 'admin-email';
  const domain = lower.split('@')[1];
  if (ADMIN_DOMAINS.includes(domain)) return 'admin-email';
  return 'azure-required';
}

function fmtDate(v: unknown): string {
  if (!v) return 'never';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Firestore Timestamp
  const t = v as { toDate?: () => Date };
  if (typeof t?.toDate === 'function') return t.toDate().toISOString().slice(0, 10);
  return String(v);
}

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const snap = await db.collection('users').orderBy('createdAt', 'desc').get();
  const all = snap.docs.map(d => ({ email: d.id, ...(d.data() as Record<string, unknown>) }));

  const adminUsers: typeof all = [];
  const azureUsers: typeof all = [];
  const inactiveUsers: typeof all = [];

  for (const u of all) {
    if (u.active === false) {
      inactiveUsers.push(u);
      continue;
    }
    if (classify(u.email) === 'admin-email') adminUsers.push(u);
    else azureUsers.push(u);
  }

  const print = (header: string, list: typeof all) => {
    console.log(`\n${header}  (${list.length})`);
    console.log('─'.repeat(header.length + String(list.length).length + 4));
    if (list.length === 0) {
      console.log('  (none)');
      return;
    }
    for (const u of list) {
      const role = u.role || '-';
      const last = fmtDate(u.lastLogin);
      const created = fmtDate(u.createdAt);
      console.log(`  ${u.email.padEnd(40)}  role=${String(role).padEnd(8)}  last=${last}  created=${created}`);
    }
  };

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  USERS REPORT — ${all.length} total in Firestore`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  print('KEEPS EMAIL/OTP ACCESS  (fiberandface.com + whitelist)', adminUsers);
  print('MUST USE MICROSOFT  (must be in Entra group APP-G-STAR-AI-Studio)', azureUsers);
  print('INACTIVE USERS  (already locked out, ignored)', inactiveUsers);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  PRE-DEPLOY CHECKLIST');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  → Confirm every "MUST USE MICROSOFT" email above is a member`);
  console.log(`    of Entra group APP-G-STAR-AI-Studio`);
  console.log(`    (Object ID 749c0cf5-7191-4937-8284-f81c4d9e90dc).`);
  console.log(`  → If anyone is missing from the group, add them BEFORE deploy`);
  console.log(`    or they will be unable to log in after the auth changes ship.`);
  console.log('');
}

main().catch(e => {
  console.error('Failed:', e);
  process.exit(1);
});
