/**
 * M04 rev 50: subordinate silhouette PART B's footwear references to the
 * job's ACTUAL shoes.
 *
 * Root cause analysis (replay TLXfhGjJIrKh1IRYSPzH 2026-05-07):
 *   The silhouette is cached on the wardrobe item, analyzed once. PART B
 *   often hard-codes "sneakers + 3cm" as the production translation. When
 *   the job pairs the same garment with a different shoe (cowboy boots),
 *   Seedream sees a contradiction and produces a "wide-leg fabric pooling
 *   AROUND boot opening" hybrid that reads as tucked-into-boot.
 *
 * Strategy: keep the rev-49 layer-order block. ADD an explicit override that
 * says: silhouette's footwear references are PLACEHOLDERS; the actual shoes
 * for this render are {shoes_description}; apply the layer-order rule using
 * the actual shoe geometry, NOT the silhouette's footwear assumption.
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

// Anchor — the rev 49 block we just added. We append AFTER this paragraph.
const ANCHOR = `The above layer-order rule is universal. The silhouette's PART B specifies WHERE on the shoe the hem rests (covering laces, mid-vamp, ankle bone, calf, boot shaft, etc.) and HOW the hem behaves there (clean break, soft cascade, stacking, gathering); the layer-order rule above specifies that wherever PART B places the meeting point, the fabric is positioned ABOVE the shoe and falls down the outside, never tucked inside, never floating in the air above the shoe.`;

const APPEND = `

ACTUAL-FOOTWEAR OVERRIDE (read this CAREFULLY):
The silhouette description was authored once per garment by analyzing the fit-model photographs and writing a generic production translation. PART B may explicitly reference a specific shoe type (e.g., "sneakers", "boots", "+3cm of height") as a placeholder for the production rendering. The ACTUAL footwear in THIS render is {shoes_description} — those are the shoes drawn in the output. Apply the silhouette's INTENT for hem length and drape behavior (whether cascading to the floor, breaking at the ankle, cropped above the calf, etc.), but apply the LAYER-ORDER rule above using the geometry of the ACTUAL footwear, NOT the geometry of any placeholder footwear that PART B may mention.

Concretely:
- If PART B says "drape over and around sneakers, pool on ground" but the ACTUAL footwear is tall boots: the wide-leg fabric flows continuously down the OUTSIDE of the boot shaft from above the boot top, around and down its exterior, to the floor. The fabric does not gather, bunch, stack, or balloon at the boot opening — it flows past the opening smoothly. The boot shaft remains visible underneath the cascading fabric where the fabric falls outside it.
- If PART B says "rest on top of boots" but the ACTUAL footwear is low sneakers: the fabric drapes onto the sneaker upper from above, covering laces and tongue.
- If PART B says "above-ankle hem with shoe fully visible" but the ACTUAL footwear is knee-high boots: render the hem at the silhouette-specified height and let the boot shaft be visible above and below as appropriate, with the fabric cleanly hemmed (not breaking on the boot top).

The actual shoes (described in {shoes_description} and shown in the shoe reference image) are the source of truth for shoe shape, height, and opening geometry. PART B is the source of truth for where the hem sits and how it drapes. The rules above reconcile the two whenever they disagree.`;

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

  if (!content.includes(ANCHOR)) {
    console.error('ANCHOR (rev 49 universal-rule paragraph) not found — refusing to patch.');
    process.exit(2);
  }
  if (content.includes('ACTUAL-FOOTWEAR OVERRIDE')) {
    console.error('ACTUAL-FOOTWEAR OVERRIDE already present — refusing to duplicate.');
    process.exit(3);
  }

  const newContent = content.replace(ANCHOR, ANCHOR + APPEND);
  if (newContent === content) { console.error('replace produced no change'); process.exit(4); }

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
    uploadedBy: 'script:update-m04-rev50',
    uploadedAt: new Date(),
    parentRevision: oldRev,
    note: 'rev 50: ACTUAL-FOOTWEAR OVERRIDE — silhouette PART B footwear references are placeholders, layer-order applies to actual {shoes_description}. Reproduces fix for wide-leg + cowboy-boot regression (TLXfhGjJIrKh1IRYSPzH).',
  });
  await batch.commit();
  console.log(`✓ Activated M04 rev ${newRev} (${newRef.id})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
