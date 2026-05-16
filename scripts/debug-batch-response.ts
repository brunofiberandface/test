/**
 * Debug: fetch the raw batch state from Google and dump the full JSON
 * so we can see where the output file lives in the actual response shape.
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

(async () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Need to use one from Cloud Run env via gcloud. Instead, pass via arg.
    console.error('GEMINI_API_KEY not set locally. Pulling from Cloud Run env...');
    console.error('Run with: GEMINI_API_KEY=<key> npx tsx scripts/debug-batch-response.ts');
    process.exit(1);
  }

  const db = new Firestore();
  const doc = await db.collection('system').doc('shoeMatrixBatchJob').get();
  const job = doc.data() as { name: string };
  const name = job.name;
  console.log(`Polling ${name}...`);

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}?key=${apiKey}`);
  if (!res.ok) {
    console.error(`status ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const data = await res.json();
  console.log('\n══ RAW RESPONSE ══');
  console.log(JSON.stringify(data, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
