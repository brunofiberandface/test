/**
 * Show exactly what's in Firestore + GCS for M15's legsFront, to verify
 * whether the upload landed at the URL the model-detail page reads.
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
  const snap = await db.collection('models').doc('M15').get();
  const d = snap.data() as Record<string, string>;
  console.log('M15 Firestore state:');
  console.log(`  assets4K_fullBodyFront: ${d.assets4K_fullBodyFront}`);
  console.log(`  assets4K_fullBodyBack:  ${d.assets4K_fullBodyBack}`);
  console.log(`  assets4K_legsFront:     ${d.assets4K_legsFront}`);
  console.log(`  assets4K_legsBack:      ${d.assets4K_legsBack}`);
  console.log('');
  console.log(`  assetsThumb_legsFront:  ${d.assetsThumb_legsFront}`);
  console.log('');
  console.log(`  assets4K_updatedAt:     ${d.assets4K_updatedAt}`);
  console.log(`  assetsThumb_updatedAt:  ${d.assetsThumb_updatedAt}`);
  console.log('');
  // Test HEAD on the stored URL
  const url = d.assets4K_legsFront;
  if (url) {
    const r = await fetch(url.split('?')[0], { method: 'HEAD' });
    console.log(`HEAD ${url.split('?')[0]}:`);
    console.log(`  status: ${r.status}`);
    console.log(`  last-modified: ${r.headers.get('last-modified')}`);
    console.log(`  content-length: ${r.headers.get('content-length')}`);
    console.log(`  content-type: ${r.headers.get('content-type')}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
