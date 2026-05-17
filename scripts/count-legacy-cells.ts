/**
 * Count qaShoeMatrix cells stuck in legacy state:
 *   status='done' BUT no `images` map (or images < 4 views).
 * These were rendered before the 4-view refactor and never got picked up
 * by the batch because their status was already 'done'.
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
  const snap = await db.collection('qaShoeMatrix').get();
  let legacy = 0, full4 = 0, partial = 0, archived = 0, other = 0;
  const legacyIds: string[] = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (data.archived) { archived++; continue; }
    const images = data.images as Record<string, string> | undefined;
    const imagesCount = images ? Object.keys(images).length : 0;
    if (imagesCount === 4) { full4++; continue; }
    if (data.status === 'done' && imagesCount === 0 && data.imageUrl) {
      legacy++;
      legacyIds.push(d.id);
      continue;
    }
    if (imagesCount > 0 && imagesCount < 4) { partial++; continue; }
    other++;
  }
  console.log(`Total cells: ${snap.docs.length}`);
  console.log(`  archived:          ${archived}`);
  console.log(`  full4 (4 images):  ${full4}`);
  console.log(`  partial (1-3):     ${partial}`);
  console.log(`  LEGACY (done +     ${legacy}  ← need to be flipped + re-batched`);
  console.log(`         imageUrl)`);
  console.log(`  other:             ${other}`);
  if (legacy > 0) console.log(`\nLegacy cell IDs:\n${legacyIds.slice(0, 10).map(id => '  ' + id).join('\n')}${legacy > 10 ? `\n  ... and ${legacy - 10} more` : ''}`);
})().catch(e => { console.error(e); process.exit(1); });
