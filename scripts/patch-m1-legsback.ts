/**
 * One-off: M1 × black derby's legsBack succeeded in the first run but got
 * dropped from Firestore when the retry overwrote `images`. The GCS file
 * still exists. Patch Firestore to re-link it.
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
  const id = 'ATik7YEpFQB7fpcBVpkL_M1';
  const baseUrl = 'https://storage.googleapis.com/gstar-ai-studio-assets/output/qa-matrix/ATik7YEpFQB7fpcBVpkL/M1';
  const v = Date.now();
  await db.collection('qaShoeMatrix').doc(id).set(
    {
      'images.legsBack': `${baseUrl}/legsBack.png?v=${v}`,
      'thumbs.legsBack': `${baseUrl}/legsBack_thumb.jpg?v=${v}`,
      viewsCompleted: ['fullBodyFront', 'fullBodyBack', 'legsFront', 'legsBack'],
      status: 'done',
      errorMessage: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  console.log(`✓ Patched ${id} — legsBack re-linked, status=done`);
})().catch(e => { console.error(e); process.exit(1); });
