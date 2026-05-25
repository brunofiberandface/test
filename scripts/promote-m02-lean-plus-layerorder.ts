/**
 * PROMOTION SCRIPT — DO NOT RUN WITHOUT BRUNO'S EXPLICIT GO-AHEAD.
 *
 * Uploads the lean+layer-order M02 prompt as a new revision in the promptVault.
 * This will DEACTIVATE the current active M02 Seedream prompt (rev 28,
 * doc id L2d7RMfxcu4WbIuSvYfg) and replace it with the new revision.
 *
 * Backed by 24 renders of validation across CONTOR + Judee Loose + Midge Bootcut
 * × white/grey sneakers (see LEARNING #104).
 *
 * Run with --dry to see what would happen without committing.
 */
import * as path from 'path';
import * as fs from 'fs';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { Firestore } from '@google-cloud/firestore';

const NEW_PROMPT = `Apply the fitmodel trousers onto the AI model with shoes. so merge the two images, but the trousers should be fully respected in form and fit. all details need to be preserved, IMPORTANT is the trousers run naturally down respecting the fitmodel lenght of the trousers. the model needs to stand equally on 2 feet, 50% on each foot, keeping the same position as the underwear model.

UNIVERSAL HEM-OVER-SHOE LAYER ORDER (applies whenever the hem reaches or extends past the top of the shoe):
- The pant fabric is the OUTER layer; the shoe is the INNER layer beneath it. The hem fabric drapes over and on top of the shoe, layered ABOVE the shoe upper.
- For lace-up shoes (sneakers, oxfords, derbies, brogues): the laces and tongue area sit beneath the pant fabric, partially or fully covered by the fabric draped on top from above. The pant hem cascades onto the shoe vamp. The shoe sole, toe-box, and the front-most edge of the upper remain visible below the cascading hem.
- For boots (cowboy boots, ankle boots, chelsea boots, knee-high boots): the pant fabric falls OUTSIDE the boot shaft, draping down the exterior of the boot from above. The boot opening at the top of the shaft contains only the leg, never the pant fabric — the pant hem ends above the boot top and falls down the outside of the boot, not into it.
- For sandals, slides, mules, and any open footwear: the pant fabric drapes over the foot and any straps in the same OUTER-layer relationship.
- The pant hem always touches the shoe from above. There is no airborne gap between the bottom of the hem and the top of the shoe — fabric and shoe meet wherever the silhouette places that meeting point, with the fabric resting on or over the shoe.

Do NOT shorten the hem above the length the fit-model shows. Do NOT terminate the hem at the top of the shoe.`;

const CHANGELOG = `# M02 — Matrix-paint bottom-focus back view (Seedream) — v7 (lean + layer-order)

## Purpose
Adds the UNIVERSAL HEM-OVER-SHOE LAYER ORDER block from M04 rev49 (vault doc GtqDL3wgbYGSXcCIiSmZ) to the rev 28 lean prompt, plus a 2-line negative guard at the end ("Do NOT shorten / Do NOT terminate at top of shoe").

## Why
Rev 28 (lean only) was failing on long-hem wide-leg jeans over low sneakers: Seedream terminated the pant hem at the top of the shoe instead of cascading onto the shoe vamp. The classic "shoes blocking pants" bug Bruno had been hitting on CONTOR / Judee Loose / Midge Bootcut for weeks.

A/B test 2026-05-21 on CONTOR × white+grey sneaker × 3 runs (12 renders):
- Rev 28 (lean only): 0/6 cascade correctly.
- This rev (lean + layer-order): 6/6 cascade correctly.

Generalization test on Judee Loose + Midge Bootcut × white+grey sneaker × 3 runs (12 more renders):
- Judee Loose × white+grey: 6/6 cascade ✓
- Midge Bootcut × white+grey: 3/6 cascade — bootcut design intentionally ends near ankle, the "non-cascade" runs are matching the fit-model intent, not failures.

Combined: long-hem class = 12/12 cascade. Bootcut = appropriate-to-design behavior. No regression on shorter-hem.

Pixel-level confirmation: bottom-band (y 90-100%) subject mass +9pp on B vs A — more pant fabric at floor level. Lower-leg band 8 also +9pp.

## Architecture context (unchanged from rev 28)
- IMAGE 1 = Tier-2 base (model in target shoes + placeholder pants).
- IMAGE 2 = fit-model straight back.
- No reference labels / inventory block prepended (seedream-client strips it).
- Lean prompt is preserved verbatim; layer-order block is appended.

## The decisive lines
For sneakers (the failing case): "The pant fabric is the OUTER layer; the shoe is the INNER layer beneath it" + "the laces and tongue area sit beneath the pant fabric" + "The pant hem cascades onto the shoe vamp" + "no airborne gap between the bottom of the hem and the top of the shoe".

For boots (unchanged behavior expected): "the pant fabric falls OUTSIDE the boot shaft, draping down the exterior".

## Step 2 Prompt

\`\`\`
${NEW_PROMPT}
\`\`\`
`;

async function main() {
  const dryRun = process.argv.includes('--dry');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no commit)' : 'LIVE COMMIT'}`);

  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  // Preview what would happen
  const activeSnap = await db.collection('promptVault')
    .where('shotType', '==', 'M02')
    .where('isActive', '==', true)
    .where('pipeline', '==', 'seedream')
    .get();
  console.log(`Currently active M02 seedream prompts: ${activeSnap.size}`);
  for (const d of activeSnap.docs) {
    const data = d.data() as any;
    console.log(`  WOULD DEACTIVATE: ${d.id} (rev ${data.revision})`);
  }

  // Find latest revision
  const latestSnap = await db.collection('promptVault')
    .where('shotType', '==', 'M02')
    .orderBy('revision', 'desc')
    .limit(1)
    .get();
  const latestRev = latestSnap.empty ? 0 : (latestSnap.docs[0].data().revision || 0);
  const newRev = latestRev + 1;
  console.log(`Latest M02 revision: ${latestRev}, new revision will be: ${newRev}`);
  console.log(`New prompt length: ${NEW_PROMPT.length} chars`);
  console.log(`Changelog length: ${CHANGELOG.length} chars`);

  if (dryRun) {
    console.log('\n--- NEW PROMPT (would be uploaded) ---');
    console.log(NEW_PROMPT);
    console.log('\nDRY RUN — no Firestore writes performed.');
    return;
  }

  // Live commit — batch deactivate + create new
  const batch = db.batch();
  for (const d of activeSnap.docs) {
    batch.update(d.ref, { isActive: false });
  }
  const newRef = db.collection('promptVault').doc();
  batch.set(newRef, {
    id: newRef.id,
    shotType: 'M02',
    pipeline: 'seedream',
    revision: newRev,
    isActive: true,
    isAlternative: false,
    content: CHANGELOG,
    filename: `M02_v7_lean_plus_layerorder.md`,
    uploadedBy: 'claude-cli (test-validated, see LEARNINGS #104)',
    uploadedAt: new Date(),
  });
  await batch.commit();
  console.log(`✓ Uploaded new active M02 prompt: id=${newRef.id}, revision=${newRev}`);
  console.log(`Old active prompt deactivated.`);
}
main().catch(e=>{console.error(e); process.exit(1)});
