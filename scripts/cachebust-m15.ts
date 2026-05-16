/**
 * Append ?v=<timestamp> to M15's legsFront URL in Firestore so the
 * client-side page + Next.js Image optimizer treat it as a new image and
 * fetch the freshly-cropped version instead of the cached old one.
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
  const v = Date.now();
  const base = 'https://storage.googleapis.com/gstar-ai-studio-assets/output/model-assets/M15';
  await db.collection('models').doc('M15').update({
    assets4K_legsFront: `${base}/legsFront.png?v=${v}`,
    assetsThumb_legsFront: `${base}/legsFront_thumb.jpg?v=${v}`,
    assets4K_updatedAt: new Date().toISOString(),
  });
  console.log(`✓ M15 legsFront URLs cache-busted with ?v=${v}`);
})().catch(e => { console.error(e); process.exit(1); });
