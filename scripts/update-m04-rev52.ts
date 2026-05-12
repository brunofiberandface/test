/**
 * M04 rev 52: pant hem MUST extend to FLOOR level. Boot almost fully hidden.
 *
 * Bruno 2026-05-07: rev 51 had fabric draping OVER the upper boot but
 * stopping mid-boot — leaving the lower boot fully visible. Wrong principle.
 * The garment is an OUTER tube hanging from the body to the FLOOR. The boot
 * is INSIDE that tube and is mostly hidden. Only a sliver of sole visible.
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

const OLD = `- If PART B says "drape over and around sneakers, pool on ground" but the ACTUAL footwear is tall boots (cowboy, ankle, chelsea, knee-high, or any boot with a shaft taller than a low shoe): the wide-leg fabric drapes ONTO the boot from above and rests on the boot's upper exterior surface, COVERING the upper portion of the boot. Specifically: the upper boot shaft and the boot opening are HIDDEN behind the pant fabric — fabric drapes over them like a curtain falling from above, then continues down the boot's exterior in soft folds, reaching toward the floor. Only the LOWER portion of the boot remains visible: the heel, the lower-rear quarter of the shaft, the sole, and the toe-box. The bulk of the boot's upper exterior (front of shaft, sides of shaft, the opening at the top) is covered and obscured by the pant fabric resting on top of it. The fabric does not bunch, balloon, gather, or stack at any single point on the boot — it drapes smoothly OVER and DOWN the boot in soft natural folds. Think of a long curtain draped over a cylinder: the curtain rests on top, falls down the sides, hides the upper section of the cylinder, and the bottom of the cylinder peeks out below.`;

const NEW = `- If PART B says "drape over and around sneakers, pool on ground" but the ACTUAL footwear is tall boots (cowboy, ankle, chelsea, knee-high, or any boot with a shaft taller than a low shoe): the wide-leg pant fabric is an OUTER TUBE that hangs from the leg all the way down to FLOOR LEVEL. The hem of the pant rests on the actual floor surface, NOT on the boot, NOT at the boot top, NOT mid-boot — the hem must reach the ground, with the bottom edge of the fabric meeting or pooling on the floor itself. The boot sits INSIDE this outer tube of fabric and is almost entirely HIDDEN by it. Specifically: the boot opening, the entire boot shaft (front, sides, and back), the upper exterior, the heel, and the boot's body are all COVERED and OBSCURED by the cascading pant fabric. Only a SMALL VISIBLE PORTION remains — typically the boot's toe-tip and a sliver of the sole at the very bottom front, just barely peeking out below the floor-length hem at ground level. The visual impression from the back is: pant fabric flowing from the leg straight down to the floor in soft folds, with maybe a hint of the boot's lowest edge visible at the very bottom-front. The boot is INSIDE the pant; the pant fabric is OUTSIDE and below it. Think of a long full-length curtain hanging in front of a small object on the floor: the curtain reaches the floor, the object is hidden behind the curtain, only the very bottom of the object peeks below the curtain's bottom edge.

LAYER PRINCIPLE (memorize this exactly): the garment goes ABOVE / OUTSIDE; the boot goes UNDER / INSIDE. The garment hem reaches the FLOOR. The boot is hidden, with a small sole-and-toe sliver visible at floor level. This applies to all boots, regardless of shaft height, whenever the silhouette intent is full-length / floor-length / "pools on ground" / "cascading to floor".`;

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
    console.error('OLD text (rev 51 tall-boot bullet) not found — refusing to patch.');
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
    uploadedBy: 'script:update-m04-rev52',
    uploadedAt: new Date(),
    parentRevision: oldRev,
    note: 'rev 52: hem MUST reach floor; boot mostly hidden inside outer tube of fabric; only sole/toe sliver visible at ground level. Rev 51 had fabric stopping at boot top.',
  });
  await batch.commit();
  console.log(`✓ Activated M04 rev ${newRev} (${newRef.id})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
