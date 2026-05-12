/**
 * Patch the active M04 prompt: tighten Hem & Footwear section to enforce
 * "hem drapes OVER shoe / outside boot shaft", never tucked in, never floating.
 *
 * Bruno 2026-05-07: persistent regression — back shots were producing pants
 * that hovered above sneakers (visible gap between hem and shoe top) or got
 * tucked INTO boot shafts (wide-leg balloon clustered behind the boot opening).
 *
 * Strategy: keep the silhouette-driven Hem block from rev 43 (don't reintroduce
 * the FLOOR PRINCIPLE) but ADD a universal physics rule that the hem layer
 * sits ABOVE the shoe layer in 3D, not below or inside it. Phrased positively
 * per LEARNINGS #55 (anti-X anti-pattern).
 *
 * Creates a new revision (rev 49 from current 48) and marks it active.
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

const OLD_HEM_BLOCK = `### Hem & Footwear
Render the garment hem exactly as the silhouette description specifies — its finished length (whether floor-length, cropped, cuffed, mid-calf, above-ankle, or otherwise), opening width, fabric drape behavior, and how the hem interacts with the footwear.

The silhouette's PART A describes what the garment looks like in the fit-model photos (typically on bare feet); the silhouette's PART B describes the production rendering with the actual shoes for this shot. Follow PART B exactly for length and shoe interaction. Where PART B describes drape over the shoe (full-length garments), fabric falls naturally over and around the shape of the shoes, draping softly to cover whatever the silhouette says it covers. Where PART B describes a cropped, cuffed, or above-ankle hem, render the hem at exactly that height with the corresponding portion of the foot or shoe visible below.

Footwear is the {shoes_description}, matching the shoes reference imagery exactly. Do NOT extend the hem beyond the length the silhouette specifies. Do NOT shorten the hem above the length the silhouette specifies. Do NOT invent stacking, breaking, pooling, or cuffing behavior that the silhouette does not describe.`;

const NEW_HEM_BLOCK = `### Hem & Footwear
Render the garment hem exactly as the silhouette description specifies — its finished length (whether floor-length, cropped, cuffed, mid-calf, above-ankle, or otherwise), opening width, fabric drape behavior, and how the hem interacts with the footwear.

The silhouette's PART A describes what the garment looks like in the fit-model photos (typically on bare feet); the silhouette's PART B describes the production rendering with the actual shoes for this shot. Follow PART B exactly for length and shoe interaction. Where PART B describes drape over the shoe (full-length garments), fabric falls naturally over and around the shape of the shoes, draping softly to cover whatever the silhouette says it covers. Where PART B describes a cropped, cuffed, or above-ankle hem, render the hem at exactly that height with the corresponding portion of the foot or shoe visible below.

Footwear is the {shoes_description}, matching the shoes reference imagery exactly. Do NOT extend the hem beyond the length the silhouette specifies. Do NOT shorten the hem above the length the silhouette specifies. Do NOT invent stacking, breaking, pooling, or cuffing behavior that the silhouette does not describe.

UNIVERSAL HEM-OVER-SHOE LAYER ORDER (applies whenever the hem reaches or extends past the top of the shoe):
- The pant fabric is the OUTER layer; the shoe is the INNER layer beneath it. The hem fabric drapes over and on top of the shoe, layered ABOVE the shoe upper.
- For lace-up shoes (sneakers, oxfords, derbies, brogues): the laces and tongue area sit beneath the pant fabric, partially or fully covered by the fabric draped on top from above. The pant hem cascades onto the shoe vamp. The shoe sole, toe-box, and the front-most edge of the upper remain visible below the cascading hem.
- For boots (cowboy boots, ankle boots, chelsea boots, knee-high boots): the pant fabric falls OUTSIDE the boot shaft, draping down the exterior of the boot from above. The boot opening at the top of the shaft contains only the leg, never the pant fabric — the pant hem ends above the boot top and falls down the outside of the boot, not into it.
- For sandals, slides, mules, and any open footwear: the pant fabric drapes over the foot and any straps in the same OUTER-layer relationship.
- The pant hem always touches the shoe from above. There is no airborne gap between the bottom of the hem and the top of the shoe — fabric and shoe meet wherever the silhouette places that meeting point, with the fabric resting on or over the shoe.

The above layer-order rule is universal. The silhouette's PART B specifies WHERE on the shoe the hem rests (covering laces, mid-vamp, ankle bone, calf, boot shaft, etc.) and HOW the hem behaves there (clean break, soft cascade, stacking, gathering); the layer-order rule above specifies that wherever PART B places the meeting point, the fabric is positioned ABOVE the shoe and falls down the outside, never tucked inside, never floating in the air above the shoe.`;

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });
  const col = db.collection('promptVault');

  // Load current active M04
  const snap = await col.where('shotType', '==', 'M04').where('isActive', '==', true).limit(1).get();
  if (snap.empty) { console.error('no active M04 prompt found'); process.exit(1); }
  const cur = snap.docs[0];
  const data = cur.data() as any;
  const oldRev = data.revision || 0;
  const content = data.content as string;

  if (!content.includes(OLD_HEM_BLOCK)) {
    console.error('Could not find expected OLD_HEM_BLOCK in active M04 content. Refusing to patch.');
    console.error('First 200 chars of content:\n', content.substring(0, 200));
    process.exit(2);
  }

  const newContent = content.replace(OLD_HEM_BLOCK, NEW_HEM_BLOCK);
  if (newContent === content) {
    console.error('Patch produced no change — aborting.');
    process.exit(3);
  }

  const newRev = oldRev + 1;
  console.log(`Patching M04: rev ${oldRev} → rev ${newRev}`);
  console.log(`  content: ${content.length} → ${newContent.length} chars (+${newContent.length - content.length})`);

  // Deactivate current
  const batch = db.batch();
  batch.update(cur.ref, { isActive: false });

  // Create new revision
  const newRef = col.doc();
  batch.set(newRef, {
    id: newRef.id,
    shotType: 'M04',
    pipeline: data.pipeline || 'seedream',
    revision: newRev,
    isActive: true,
    content: newContent,
    filename: data.filename || 'M04_GENERATION_GUIDE.md',
    uploadedBy: 'script:update-m04-hem-over-shoes',
    uploadedAt: new Date(),
    parentRevision: oldRev,
    note: 'rev 49: add UNIVERSAL HEM-OVER-SHOE LAYER ORDER block to Hem & Footwear (Bruno 2026-05-07: persistent regression on back shots — pants floating above sneakers OR tucked into boot shafts).',
  });

  await batch.commit();
  console.log(`✓ Activated M04 rev ${newRev} (${newRef.id})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
