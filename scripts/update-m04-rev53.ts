/**
 * M04 rev 53: explicit PANT LENGTH compensation for tall footwear.
 *
 * The remaining failure mode after rev 52: fabric is outside the boot but
 * terminates at boot-opening height (because Seedream renders the pant at
 * the same length the fit-model photos show, which was relative to bare
 * feet). Adding tall boots pushes the floor-meeting point ~15cm higher,
 * but the pant length stayed the same → hem floats at boot-opening level.
 *
 * Strategy: prepend a PANT LENGTH RECOMPUTATION rule that explicitly tells
 * the renderer to LENGTHEN the pant beyond fit-model proportions to reach
 * the new floor (boot sole) level.
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

// Anchor: the start of the rev-50 ACTUAL-FOOTWEAR OVERRIDE block. We prepend
// the new PANT LENGTH RECOMPUTATION rule immediately before it.
const ANCHOR = `ACTUAL-FOOTWEAR OVERRIDE (read this CAREFULLY):`;

const PREPEND = `PANT LENGTH RECOMPUTATION FOR TALL FOOTWEAR (CRITICAL — read before ACTUAL-FOOTWEAR OVERRIDE below):

The fit-model reference photos in the input show this garment worn on a model in BARE FEET or low shoes. In those photos, the pant's hem reaches the floor (or near-floor / pool-on-ground) at the model's natural barefoot foot-floor contact point.

In THIS production render the model wears {shoes_description}. If the actual shoes have noticeable HEEL HEIGHT or SHAFT HEIGHT (e.g., cowboy boots, ankle boots, knee-high boots, heeled sandals, platform shoes — anything that adds height between the foot and the floor compared to bare feet), the floor surface is the SAME as in the fit-model photos but the model's foot-to-floor contact point is now LOWER on the boot (specifically: at the boot's SOLE, where it meets the ground, not at the model's natural ankle).

Therefore, you MUST RENDER THE PANT AT AN EXTENDED LENGTH compared to the fit-model proportion. The pant's waist-to-hem distance in the rendered output is LONGER than in the fit-model photos by approximately the height of the footwear. The hem reaches the FLOOR SURFACE (i.e., the same floor the boot sole rests on), NOT the model's natural ankle height, NOT the boot's opening, NOT the boot's mid-shaft.

Visualize this as: the same garment, owned by a person who chooses to wear it with tall boots, gets RE-HEMMED LONGER so it still pools on the floor. The pant in this render is that re-hemmed longer version. The hem is at floor level. The boot is INSIDE the pant tube and is largely hidden.

The fit-model photos show garment FIT, FABRIC, CONSTRUCTION, COLOR, AND SILHOUETTE — but NOT the final hem position relative to the floor when paired with tall footwear. The hem's vertical position in the output is determined by THIS rule, not by measuring the fit-model photos pixel-for-pixel.

────────────────────────────────────────────────────

${ANCHOR}`;

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
    console.error('ANCHOR not found — refusing to patch.');
    process.exit(2);
  }
  if (content.includes('PANT LENGTH RECOMPUTATION')) {
    console.error('PANT LENGTH RECOMPUTATION already present — refusing to duplicate.');
    process.exit(3);
  }

  const newContent = content.replace(ANCHOR, PREPEND);
  if (newContent === content) { console.error('no change'); process.exit(4); }

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
    uploadedBy: 'script:update-m04-rev53',
    uploadedAt: new Date(),
    parentRevision: oldRev,
    note: 'rev 53: PANT LENGTH RECOMPUTATION block prepended to ACTUAL-FOOTWEAR OVERRIDE — explicit instruction to extend pant length beyond fit-model proportions to reach floor over tall footwear.',
  });
  await batch.commit();
  console.log(`✓ Activated M04 rev ${newRev} (${newRef.id})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
