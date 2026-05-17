/**
 * Flip all legacy qaShoeMatrix cells (status='done' but no 4-view images
 * map) back to status='pending' so the batch collector picks them up.
 *
 * Preserves the legacy `imageUrl` field as fallback display until the
 * new 4-view images land — UI will show the old single-view image with
 * a "legacy 1-view" badge until then.
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
import { Firestore, FieldValue } from '@google-cloud/firestore';

(async () => {
  const db = new Firestore();
  const snap = await db.collection('qaShoeMatrix').get();
  let flipped = 0;
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (data.archived) continue;
    const images = data.images as Record<string, string> | undefined;
    const imagesCount = images ? Object.keys(images).length : 0;
    if (imagesCount === 4) continue;       // already full4, leave alone
    if (data.status !== 'done') continue;  // already pending/failed/partial — batch will pick up
    if (imagesCount > 0) continue;         // has SOME new images — would be 'partial' but we leave it
    // Legacy: status='done' + no images map. Flip.
    await db.collection('qaShoeMatrix').doc(d.id).update({
      status: 'pending',
      viewsCompleted: [],
      updatedAt: FieldValue.serverTimestamp(),
    });
    flipped++;
  }
  console.log(`✓ Flipped ${flipped} legacy cells back to pending`);
})().catch(e => { console.error(e); process.exit(1); });
