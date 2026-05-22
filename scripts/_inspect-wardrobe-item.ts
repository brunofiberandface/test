import * as fs from 'fs';
import * as path from 'path';
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');
import { Firestore } from '@google-cloud/firestore';

const id = process.argv[2];
if (!id) { console.error('Usage: ... <wardrobeId>'); process.exit(1); }

(async () => {
  const db = new Firestore();
  const snap = await db.collection('wardrobe').doc(id).get();
  const d = snap.data() as Record<string, unknown>;
  console.log(`name: ${d.name}`);
  console.log(`fitModels:`);
  const fm = (d.fitModels || {}) as Record<string, string>;
  for (const k of Object.keys(fm)) {
    const url = fm[k];
    const r = await fetch(url.split('?')[0], { method: 'HEAD' });
    const len = r.headers.get('content-length');
    console.log(`  ${k.padEnd(15)} ${url}`);
    console.log(`  ${''.padEnd(15)} → HEAD ${r.status}, content-length=${len}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
