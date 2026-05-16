/**
 * Surgically mark ONE view of a (model × shoe) cell as needing re-render.
 * Used when the source Tier-1 asset for that view changed and we want to
 * re-render only that view without re-rendering the other 3.
 *
 * Removes the view from viewsCompleted (so collectPendingBatchEntries
 * picks it up), and flips status to 'partial' so it's eligible for batch.
 *
 * Usage: ... <cellId> <view>
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

const [cellId, view] = process.argv.slice(2);
if (!cellId || !view) { console.error('Usage: ... <cellId> <view>'); process.exit(1); }

(async () => {
  const db = new Firestore();
  await db.collection('qaShoeMatrix').doc(cellId).update({
    viewsCompleted: FieldValue.arrayRemove(view),
    status: 'partial',
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`✓ ${cellId}: removed ${view} from viewsCompleted, status=partial`);
})().catch(e => { console.error(e); process.exit(1); });
