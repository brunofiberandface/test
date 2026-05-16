/**
 * Inspect a qaShoeMatrix cell directly — bypasses any HTTP caching to see
 * what Firestore actually has. Used to diagnose why batch results aren't
 * showing up in the UI.
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

const cellId = process.argv[2];
if (!cellId) { console.error('Usage: ... <cellId>'); process.exit(1); }

(async () => {
  const db = new Firestore();
  const doc = await db.collection('qaShoeMatrix').doc(cellId).get();
  if (!doc.exists) { console.log(`${cellId}: NOT FOUND`); return; }
  const d = doc.data() as Record<string, unknown>;
  console.log(`Cell: ${cellId}`);
  console.log(JSON.stringify(d, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
