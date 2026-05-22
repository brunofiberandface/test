/**
 * Dump every wardrobe bottom's fitModels URLs + audit count to JSON.
 * Used to drive the angle backfill batch — we need each item's actual slot URLs
 * (front45Left/Right, back45Left/Right) so the backfill script can resolve the
 * GCS destination path via doc lookup.
 */
import * as fs from 'fs';
import * as path from 'path';
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');
import { Firestore } from '@google-cloud/firestore';
(async () => {
  const db = new Firestore();
  const snap = await db.collection('wardrobe').get();
  const items = snap.docs
    .filter(d => {
      const data = d.data() as Record<string, unknown>;
      const cat = data.category as string;
      const archived = data.archived as boolean | undefined;
      return (cat === 'bottom') && archived !== true;
    })
    .map(d => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        name: data.name as string,
        designNumber: data.designNumber as string,
        category: data.category as string,
        fitModels: data.fitModels as Record<string, string>,
        fitModels4K_count: data.fitModels4K_count,
        fitModels4K_status: data.fitModels4K_status,
      };
    });
  fs.writeFileSync('/tmp/wardrobe_fitmodels_full.json', JSON.stringify(items, null, 2));
  console.log(`Dumped ${items.length} bottoms`);
})().catch(e => { console.error(e); process.exit(1); });
