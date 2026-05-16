/**
 * Dump the `description` field of male models to see if any text in there
 * is forcing Gemini to draw a bra (the description is injected into the prompt
 * as "with these EXACT specific attributes: <description>").
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
  const ids = ['M1', 'M2', 'M4', 'M5', 'M6', 'M7', 'M8', 'M15', 'M16', 'M21'];
  for (const id of ids) {
    const snap = await db.collection('models').doc(id).get();
    const d = snap.data() as Record<string, unknown>;
    const desc = ((d.description as string) || '').split('\n')[0].slice(0, 280);
    console.log(`${id.padEnd(4)} | name=${(d.name as string || '?').padEnd(15)} | desc: ${desc}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
