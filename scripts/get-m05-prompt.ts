import * as path from 'path';
import * as fs from 'fs';
const pr = path.resolve(__dirname, '..');
const envPath = path.join(pr, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(pr, 'sa_key.json');
import { Firestore } from '@google-cloud/firestore';
const saKey = JSON.parse(fs.readFileSync(path.join(pr, 'sa_key.json'), 'utf-8'));
const db = new Firestore({ projectId: saKey.project_id || 'gstar-ai-studio', credentials: { client_email: saKey.client_email, private_key: saKey.private_key } });
(async () => {
  const snap = await db.collection('promptVault')
    .where('shotType', '==', 'M05')
    .where('isActive', '==', true)
    .where('pipeline', '==', 'seedream')
    .limit(1).get();
  const d = snap.docs[0]?.data() as any;
  if (!d) { console.error('no active M05 seedream prompt'); process.exit(1); }
  console.log(`rev=${d.revision} label=${d.label||''} updated=${d.updatedAt?.toDate?.()}`);
  console.log('--- CONTENT ---');
  console.log(d.content);
})();
