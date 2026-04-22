/**
 * Fetch M03 image URLs for the original (skinny) and new (post-fix) jobs and
 * download both so they can be viewed side-by-side.
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

const OLD = 'E9RZzfNp2aUeqKUtnFBg';
const NEW = 'REnIyr5sobFhIyEGEWG3';

async function getM03Url(db: FirebaseFirestore.Firestore, jobId: string) {
  const snap = await db.collection('shots').where('jobId', '==', jobId).where('shotType', '==', 'M03').get();
  let url: string | null = null;
  let sv = 0;
  snap.forEach((d) => {
    const s = d.data() as any;
    const v = s.version || 1;
    if (s.imageUrl && v >= sv) { url = s.imageUrl; sv = v; }
  });
  return { url, version: sv };
}

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const [oldR, newR] = await Promise.all([getM03Url(db, OLD), getM03Url(db, NEW)]);
  console.log('OLD M03:', oldR);
  console.log('NEW M03:', newR);

  const outDir = '/sessions/stoic-beautiful-darwin/mnt/gstar';
  for (const [label, r] of [['kate-BEFORE-fix-M03', oldR], ['kate-AFTER-fix-M03', newR]] as const) {
    if (!r.url) { console.log(`${label}: no URL`); continue; }
    const res = await fetch(r.url);
    if (!res.ok) { console.log(`${label}: HTTP ${res.status}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const out = path.join(outDir, `${label}.png`);
    fs.writeFileSync(out, buf);
    console.log(`  → ${out}  (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
