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
  const snap = await db.collection('promptVault').where('shotType', '==', 'M05').get();
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
  docs.sort((a, b) => (a.revision || 0) - (b.revision || 0));
  for (const d of docs) {
    console.log(`rev=${d.revision} pipeline=${d.pipeline||'?'} active=${d.isActive} label=${(d.label||'').slice(0,40)} created=${d.createdAt?.toDate?.() || '?'}`);
  }
  // Print rev 28 + 27 content if found (the rev30 says it's "rev 28 ... skin-fidelity alt")
  for (const target of [28, 27, 26, 25, 24]) {
    const r = docs.find(d => d.revision === target && d.pipeline === 'seedream');
    if (r) {
      console.log(`\n=========== M05 REV ${target} (${r.label || ''}) ===========`);
      const c = (r as any).content as string;
      // Just dump the Step2 block
      const i = c.indexOf('### Camera');
      const j = c.indexOf('### Hero') > 0 ? c.indexOf('### Body') : c.length;
      console.log(c.substring(i, Math.min(c.length, i + 1500)));
      console.log('...');
    }
  }
})();
