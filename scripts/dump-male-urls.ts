/**
 * Dump the exact assets4K_fullBodyFront URLs for problem males so we can
 * compare what's actually in GCS vs what Bruno is seeing.
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
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';

(async () => {
  const db = new Firestore();
  const storage = new Storage();
  const bucket = storage.bucket('gstar-ai-studio-assets');
  const ids = ['M2', 'M8', 'M15', 'M16', 'M21'];
  for (const id of ids) {
    const snap = await db.collection('models').doc(id).get();
    const d = snap.data() as Record<string, string>;
    console.log(`\n══ ${id} ══`);
    console.log(`  stored URL: ${d.assets4K_fullBodyFront}`);
    // Also list files in GCS to see actual timestamps
    const [files] = await bucket.getFiles({ prefix: `model-assets/${id}/` });
    for (const f of files) {
      const [meta] = await f.getMetadata();
      console.log(`  GCS file: ${f.name.padEnd(45)} | updated: ${meta.updated} | size: ${(Number(meta.size) / 1024).toFixed(0)}KB`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
