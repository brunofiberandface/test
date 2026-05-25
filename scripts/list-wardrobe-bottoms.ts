/**
 * List wardrobe bottom items with refs available, for picking test cases.
 * Usage: npx tsx scripts/list-wardrobe-bottoms.ts
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
  const snap = await db.collection('wardrobe').where('category', '==', 'bottom').get();
  type W = { name?: string; flatFrontUrl?: string; flatBackUrl?: string; fitModels?: Record<string, string>; designNumber?: string };
  const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as W) }));
  console.log(`Found ${items.length} bottom items.\n`);
  items.forEach(it => {
    const hasFlat = !!it.flatFrontUrl;
    const hasFit = !!(it.fitModels?.front);
    console.log(`${it.id.padEnd(22)} | flat=${hasFlat ? 'Y' : ' '} fit=${hasFit ? 'Y' : ' '} | ${it.designNumber || '(no design)'} | ${it.name}`);
  });
})().catch(e => { console.error(e); process.exit(1); });
