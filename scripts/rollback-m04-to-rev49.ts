/**
 * Roll back the active M04 prompt to rev 49 (universal HEM-OVER-SHOE LAYER
 * ORDER block, no silhouette PART B overrides). The shoe geometry is now
 * handled post-hoc by the Gemini shoe-edit step (gemini-shoe-edit.ts), so
 * the rev-50→53 attempts to override silhouette PART B at Seedream-time are
 * obsolete and risk fighting Gemini's later edit.
 *
 * Strategy: deactivate the current rev (whatever it is, presumably 53), then
 * re-activate the existing rev-49 doc. Don't delete intermediate revs —
 * keep the audit trail.
 */
import * as path from 'path';
import * as fs from 'fs';

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

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });
  const col = db.collection('promptVault');

  // Find current active M04
  const activeSnap = await col.where('shotType', '==', 'M04').where('isActive', '==', true).limit(1).get();
  if (activeSnap.empty) { console.error('no active M04 prompt'); process.exit(1); }
  const cur = activeSnap.docs[0];
  const curData = cur.data() as any;
  const curRev = curData.revision;
  console.log(`current active M04: rev ${curRev} (${cur.id})`);

  if (curRev === 49) {
    console.log('rev 49 already active — nothing to do.');
    return;
  }

  // Find rev-49 doc
  const rev49Snap = await col.where('shotType', '==', 'M04').where('revision', '==', 49).limit(1).get();
  if (rev49Snap.empty) {
    console.error('rev 49 not found in promptVault — cannot roll back');
    process.exit(2);
  }
  const rev49Doc = rev49Snap.docs[0];
  console.log(`will activate rev 49 (${rev49Doc.id})`);

  const batch = db.batch();
  batch.update(cur.ref, { isActive: false });
  batch.update(rev49Doc.ref, { isActive: true, updatedAt: new Date(), reactivatedFromRev: curRev, reactivationNote: 'Rolled back from rev ' + curRev + ' — silhouette PART B overrides obsolete now that gemini-shoe-edit.ts handles shoe geometry post-hoc.' });
  await batch.commit();

  console.log(`✓ Active M04 = rev 49 (${rev49Doc.id}); rev ${curRev} deactivated (still archived in vault).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
