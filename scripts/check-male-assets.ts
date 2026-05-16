/**
 * One-off: check the assets4K_* URLs and assetsThumb_* URLs for males who
 * Bruno reports still have bras — find out if the regen actually wrote new
 * files or if there's a cache issue.
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
  const ids = ['M2', 'M8', 'M15', 'M16', 'M21', 'M1', 'M4', 'M5'];
  for (const id of ids) {
    const snap = await db.collection('models').doc(id).get();
    if (!snap.exists) { console.log(`${id}: NOT FOUND`); continue; }
    const d = snap.data() as Record<string, unknown>;
    console.log(`\n══ ${id} ══`);
    console.log(`  gender:               ${d.gender}`);
    console.log(`  assets4K_updatedAt:   ${d.assets4K_updatedAt || '(none)'}`);
    console.log(`  assetsThumb_updatedAt:${d.assetsThumb_updatedAt || '(none)'}`);
    console.log(`  fullBodyFront 4K:     ${d.assets4K_fullBodyFront ? 'set' : 'MISSING'}`);
    console.log(`  fullBodyBack 4K:      ${d.assets4K_fullBodyBack ? 'set' : 'MISSING'}`);
    console.log(`  legsFront 4K:         ${d.assets4K_legsFront ? 'set' : 'MISSING'}`);
    console.log(`  legsBack 4K:          ${d.assets4K_legsBack ? 'set' : 'MISSING'}`);
    console.log(`  fullBodyFront thumb:  ${d.assetsThumb_fullBodyFront ? 'set' : 'MISSING'}`);
    console.log(`  fullBodyBack thumb:   ${d.assetsThumb_fullBodyBack ? 'set' : 'MISSING'}`);
    console.log(`  legsFront thumb:      ${d.assetsThumb_legsFront ? 'set' : 'MISSING'}`);
    console.log(`  legsBack thumb:       ${d.assetsThumb_legsBack ? 'set' : 'MISSING'}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
