/**
 * Append ?v=<timestamp> to a specific (modelId, view) URL pair in Firestore
 * so the Next.js Image optimizer / browser cache refetches after a
 * re-upload. Generic version of cachebust-m15.ts.
 *
 * Usage: ... <modelId> <view>
 *   where view in (fullBodyFront, fullBodyBack, legsFront, legsBack)
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

const [modelId, view] = process.argv.slice(2);
if (!modelId || !view) {
  console.error('Usage: ... <modelId> <view>');
  process.exit(1);
}

(async () => {
  const db = new Firestore();
  const v = Date.now();
  const base = `https://storage.googleapis.com/gstar-ai-studio-assets/output/model-assets/${modelId}`;
  await db.collection('models').doc(modelId).update({
    [`assets4K_${view}`]: `${base}/${view}.png?v=${v}`,
    [`assetsThumb_${view}`]: `${base}/${view}_thumb.jpg?v=${v}`,
    assets4K_updatedAt: new Date().toISOString(),
  });
  console.log(`✓ ${modelId} ${view} cache-busted with ?v=${v}`);
})().catch(e => { console.error(e); process.exit(1); });
