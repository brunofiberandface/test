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
  for (const target of [22, 20, 18, 16, 14, 12, 10]) {
    const snap = await db.collection('promptVault').where('shotType', '==', 'M05').where('revision', '==', target).limit(1).get();
    const r = snap.docs[0]?.data() as any;
    if (!r) continue;
    console.log(`\n=========== M05 REV ${target} (pipeline=${r.pipeline||'?'}) ===========`);
    const c = (r.content || '') as string;
    const i = c.toLowerCase().indexOf('camera');
    const block = c.substring(Math.max(0, i - 50), Math.min(c.length, i + 800));
    console.log(block);
  }
})();
