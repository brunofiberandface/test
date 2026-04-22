/**
 * Read-only: dump the active M03 prompt template from the vault.
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

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const snap = await db.collection('promptVault').where('shotType', '==', 'M03').where('isActive', '==', true).limit(1).get();
  if (snap.empty) { console.log('no active M03 prompt'); return; }
  const p = snap.docs[0].data() as any;
  console.log('revision:', p.revision);
  console.log('modelOverride:', p.modelOverride || '(none)');
  console.log('aspectOverride:', p.aspectOverride || '(none)');
  console.log('updatedAt:', p.updatedAt?.toDate?.() || p.updatedAt);
  console.log('\n─── generationPrompt ───');
  console.log(p.generationPrompt);
}

main().catch((e) => { console.error(e); process.exit(1); });
