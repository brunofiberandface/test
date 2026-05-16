/**
 * Cleanup for cells polluted by the batch-check bug where dot-notation
 * field paths in set({merge:true}) created literal top-level keys named
 * "images.fullBodyFront" etc instead of merging into the nested map.
 *
 * For each cell ID passed on the command line:
 *   1. Read the current doc.
 *   2. For each polluted key like "images.<view>": extract the value, write
 *      it INTO the proper nested images.<view> via update() (dot-notation
 *      works correctly with update). Same for thumbs.
 *   3. Delete the polluted literal-dotted keys via FieldValue.delete().
 *
 * Idempotent — running on a clean cell is a no-op.
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

const cellIds = process.argv.slice(2);
if (cellIds.length === 0) { console.error('Usage: ... <cellId1> [<cellId2> ...]'); process.exit(1); }

(async () => {
  const db = new Firestore();
  for (const id of cellIds) {
    const docRef = db.collection('qaShoeMatrix').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) { console.log(`${id}: NOT FOUND`); continue; }
    const data = snap.data() as Record<string, unknown>;

    const update: Record<string, unknown> = {};
    let migrated = 0;
    for (const key of Object.keys(data)) {
      if (key.startsWith('images.') || key.startsWith('thumbs.')) {
        // Move the value into the nested field via update() (which DOES
        // interpret dot-notation correctly), then delete the polluted key.
        update[key.replace(/^(images|thumbs)\./, '$1.')] = data[key];
        // Mark the literal dotted-key field for deletion. We need to use
        // FieldPath here because update() with a dotted string key would
        // try to interpret it as a nested path.
        const literalKeyDeletion = db.collection('qaShoeMatrix').doc('__placeholder__');
        // Actually we can't delete a literal dotted-string field via update()
        // because the SDK treats it as a path. Use direct Firestore writes
        // with the FieldPath constructor.
        migrated++;
        void literalKeyDeletion;
      }
    }

    if (migrated === 0) {
      console.log(`${id}: clean (no polluted keys)`);
      continue;
    }

    // Step 1: write the values into proper nested paths via update().
    await docRef.update(update);

    // Step 2: delete the literal dotted-string keys. Firestore's
    // DocumentReference.update accepts FieldPath instances for keys that
    // contain dots, allowing us to target the literal field name.
    const { FieldPath } = await import('@google-cloud/firestore');
    const deleteUpdate: Array<unknown> = [];
    for (const key of Object.keys(data)) {
      if (key.startsWith('images.') || key.startsWith('thumbs.')) {
        deleteUpdate.push(new FieldPath(key));
        deleteUpdate.push(FieldValue.delete());
      }
    }
    if (deleteUpdate.length > 0) {
      // update() with alternating (FieldPath, value) pairs.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (docRef as any).update(...deleteUpdate);
    }

    console.log(`${id}: migrated ${migrated} polluted keys`);
  }
})().catch(e => { console.error(e); process.exit(1); });
