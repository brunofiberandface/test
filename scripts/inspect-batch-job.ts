/**
 * Inspect the system/shoeMatrixBatchJob doc directly to see what's in
 * Firestore vs what the API endpoint surfaces.
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
  const db = new Firestore();
  const doc = await db.collection('system').doc('shoeMatrixBatchJob').get();
  const d = doc.data() as Record<string, unknown>;
  console.log('Batch job fields:');
  for (const k of Object.keys(d).sort()) {
    const v = d[k];
    if (Array.isArray(v)) {
      console.log(`  ${k}: Array(${v.length})${v.length < 5 ? ' ' + JSON.stringify(v) : ''}`);
    } else {
      console.log(`  ${k}: ${JSON.stringify(v)}`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
