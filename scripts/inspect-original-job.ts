/**
 * Read-only: dump the wardrobe config from the original Kate Boyfriend job
 * so we can create an identical one (same model, same top, same shoe) and
 * isolate the effect of the deploy.
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

const JOB_ID = 'E9RZzfNp2aUeqKUtnFBg';

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const snap = await db.collection('jobs').doc(JOB_ID).get();
  if (!snap.exists) { console.log('job not found'); return; }
  const j = snap.data() as any;
  console.log('jobName:      ', j.jobName);
  console.log('modelId:      ', j.modelId);
  console.log('creatorEmail: ', j.creatorEmail);
  console.log('stylingNotes: ', j.stylingNotes || '(none)');
  console.log('wardrobe:');
  console.log(JSON.stringify(j.wardrobe, null, 2));

  // Resolve wardrobe item names for readability
  for (const slot of ['shoe', 'top', 'bottom'] as const) {
    const s = j.wardrobe?.[slot];
    if (s?.itemId) {
      const w = await db.collection('wardrobe').doc(s.itemId).get();
      const d = w.data() as any;
      console.log(`  ${slot}: ${s.itemId}  ${d?.name || '(?)'}  isFocus=${!!s.isFocus}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
