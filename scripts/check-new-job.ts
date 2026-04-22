/**
 * Read-only: pull the new verification job and print its silhouetteAnalysis.
 * This is the immediate proof point — if fitHint propagated through, the
 * stored silhouette should classify as boyfriend/relaxed, not skinny/straight.
 */
import * as path from 'path';
import * as fs from 'fs';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { Firestore } from '@google-cloud/firestore';

const JOB_ID = process.argv[2] || 'REnIyr5sobFhIyEGEWG3';

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const snap = await db.collection('jobs').doc(JOB_ID).get();
  if (!snap.exists) { console.log('job not found'); return; }
  const j = snap.data() as any;

  console.log('jobName:         ', j.jobName);
  console.log('status:          ', j.status);
  console.log('silhouetteError: ', j.silhouetteError || '(none)');

  const grab = (txt: string | undefined) => {
    if (!txt) return '(empty)';
    const m = txt.match(/FIT CATEGORY[^\n]{0,400}/i);
    return m ? m[0].replace(/\*\*/g, '').trim() : '(no FIT CATEGORY line)';
  };

  const sil = j.silhouetteAnalysis;
  if (!sil) { console.log('\nNo silhouetteAnalysis stored.'); return; }

  console.log('\nFIT CATEGORY FRONT:', grab(sil.front));
  console.log('FIT CATEGORY BACK :', grab(sil.back));
  console.log(`\nfront length: ${(sil.front || '').length} chars`);
  console.log(`back  length: ${(sil.back  || '').length} chars`);

  console.log('\n── FRONT (first 800 chars) ──');
  console.log((sil.front || '').slice(0, 800));
  console.log('\n── BACK (first 800 chars) ──');
  console.log((sil.back || '').slice(0, 800));

  // Also dump shot statuses
  console.log('\n── Shots ──');
  const shotsSnap = await db.collection('shots').where('jobId', '==', JOB_ID).get();
  shotsSnap.forEach((d) => {
    const s = d.data() as any;
    console.log(`  ${s.shotType}: status=${s.status} version=${s.version || 1}${s.imageUrl ? ' ✓ image' : ''}`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
