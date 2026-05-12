/**
 * M04 rev 51: tighten the tall-boot example so fabric COVERS the upper
 * portion of the boot, not just flows past it.
 *
 * Rev 50 fixed the tucked-in failure mode but Seedream produced fabric that
 * flowed OUTSIDE the boot shaft yet left almost the whole boot visible —
 * Bruno: "boots need to be UNDER the jeans, still stopping at top of boots".
 *
 * Strategy: replace the tall-boot bullet in the ACTUAL-FOOTWEAR OVERRIDE
 * block with explicit COVERAGE language — the fabric rests on top of the
 * boot upper, hides it, only the lower portion (heel, sole, toe) is visible.
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

const OLD = `- If PART B says "drape over and around sneakers, pool on ground" but the ACTUAL footwear is tall boots: the wide-leg fabric flows continuously down the OUTSIDE of the boot shaft from above the boot top, around and down its exterior, to the floor. The fabric does not gather, bunch, stack, or balloon at the boot opening — it flows past the opening smoothly. The boot shaft remains visible underneath the cascading fabric where the fabric falls outside it.`;

const NEW = `- If PART B says "drape over and around sneakers, pool on ground" but the ACTUAL footwear is tall boots (cowboy, ankle, chelsea, knee-high, or any boot with a shaft taller than a low shoe): the wide-leg fabric drapes ONTO the boot from above and rests on the boot's upper exterior surface, COVERING the upper portion of the boot. Specifically: the upper boot shaft and the boot opening are HIDDEN behind the pant fabric — fabric drapes over them like a curtain falling from above, then continues down the boot's exterior in soft folds, reaching toward the floor. Only the LOWER portion of the boot remains visible: the heel, the lower-rear quarter of the shaft, the sole, and the toe-box. The bulk of the boot's upper exterior (front of shaft, sides of shaft, the opening at the top) is covered and obscured by the pant fabric resting on top of it. The fabric does not bunch, balloon, gather, or stack at any single point on the boot — it drapes smoothly OVER and DOWN the boot in soft natural folds. Think of a long curtain draped over a cylinder: the curtain rests on top, falls down the sides, hides the upper section of the cylinder, and the bottom of the cylinder peeks out below.`;

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });
  const col = db.collection('promptVault');

  const snap = await col.where('shotType', '==', 'M04').where('isActive', '==', true).limit(1).get();
  if (snap.empty) { console.error('no active M04 prompt'); process.exit(1); }
  const cur = snap.docs[0];
  const data = cur.data() as any;
  const oldRev = data.revision || 0;
  const content = data.content as string;

  if (!content.includes(OLD)) {
    console.error('OLD text (rev 50 tall-boot bullet) not found — refusing to patch.');
    process.exit(2);
  }
  const newContent = content.replace(OLD, NEW);
  if (newContent === content) { console.error('no change'); process.exit(3); }

  const newRev = oldRev + 1;
  console.log(`Patching M04: rev ${oldRev} → rev ${newRev}`);
  console.log(`  content: ${content.length} → ${newContent.length} (+${newContent.length - content.length})`);

  const batch = db.batch();
  batch.update(cur.ref, { isActive: false });
  const newRef = col.doc();
  batch.set(newRef, {
    id: newRef.id,
    shotType: 'M04',
    pipeline: data.pipeline || 'seedream',
    revision: newRev,
    isActive: true,
    content: newContent,
    filename: data.filename || 'M04_GENERATION_GUIDE.md',
    uploadedBy: 'script:update-m04-rev51',
    uploadedAt: new Date(),
    parentRevision: oldRev,
    note: 'rev 51: tall-boot bullet now requires fabric to COVER upper boot exterior (curtain-over-cylinder analogy). Rev 50 had fabric flow outside but boots stayed mostly exposed.',
  });
  await batch.commit();
  console.log(`✓ Activated M04 rev ${newRev} (${newRef.id})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
