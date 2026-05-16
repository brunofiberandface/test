/**
 * Flip a single qaShoeMatrix cell back to status='pending' + clear
 * viewsCompleted so collectPendingBatchEntries picks it up for the test
 * batch submission.
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

const cellId = process.argv[2];
if (!cellId) { console.error('Usage: ... <cellId>'); process.exit(1); }

(async () => {
  const db = new Firestore();
  await db.collection('qaShoeMatrix').doc(cellId).set(
    {
      status: 'pending',
      viewsCompleted: [],
      errorMessage: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  console.log(`✓ ${cellId} flipped to pending`);
})().catch(e => { console.error(e); process.exit(1); });
