/**
 * Upload the rev-30 M02 prompt as the new active vault entry.
 *
 * Rev 30 architecture (2026-05-24):
 *   - 5 named refs (IMAGES 1-5) + 1 silent anchor (slot 6, not in prompt text)
 *   - IMAGE 1 = Tier-2 (model × shoe) legsBack — model already wears shoes
 *   - IMAGES 2-4 = wardrobe fit-model back angles — trouser identity
 *   - IMAGE 5 = wardrobe.layeringRefBackUrl — per-garment ECOM back-view
 *               photo, exclusive authority for hem ↔ shoe geometry
 *   - Slot 6 = Tier-2 base repeated as silent anchor (twin-prevention)
 *
 * Replaces rev 29 v9 (Tier-1 barefoot base + 3 back angles + silent anchor)
 * which depended on a Gemini extend-hem-over-shoe post-step that was
 * unreliable across silhouette classes and softened pant texture (LEARNING #102).
 *
 * Run with `--dry` first to preview the writes. Run without `--dry` to commit:
 * the existing rev 29 (and any other active M02 entry) is set isActive=false,
 * a fresh document is created with isActive=true.
 */
import * as fs from 'fs';
import * as path from 'path';

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

const NEW_PROMPT = `Merge IMAGE 1 (AI model wearing the target shoes and a black underwear placeholder, waist-down back view) with IMAGES 2-4 (fitmodel wearing the target trousers, viewed from 3 back angles: straight back, back 45° left, back 45° right) and IMAGE 5 (G-Star ECOM back-view reference of the same trouser STYLE worn over shoes from behind — DIFFERENT fit model, possibly different wash colorway).

Output = IMAGE 1 with the underwear placeholder replaced by the target trousers.

Preserve the trousers' wash, color, fit, length, drape, hem behavior, width progression, and back-pocket construction exactly as in IMAGES 2-4 — use the 3 fitmodel angles to triangulate the true garment silhouette.

The trouser hem-to-shoe relationship matches IMAGE 5: the trouser fabric is the OUTER layer, the shoes are INNER, the hem-to-shoe position (covers shoes / rests on shoes / ends above shoes / rolled cuff above shoes) is rendered exactly as visible in IMAGE 5.

IMAGE 5 IS THE LAYERING AUTHORITY ONLY. Use it EXCLUSIVELY for the geometric relationship between trouser hem and shoe (where the hem meets the shoe, whether it cascades / rests / is cuffed above). Do NOT take from IMAGE 5: garment wash, color, fabric, fit, length, pocket construction (those come from IMAGES 2-4). Do NOT render the fit model shown in IMAGE 5 — IMAGE 5's person is a DIFFERENT individual whose body is NOT the rendered output. The rendered output contains the AI model from IMAGE 1 only.

Preserve IMAGE 1's model identity, pose, body proportions, both shoes (do not modify shoe position, style, or size), and backdrop. The top edge of the output frame is at the waistband level (exactly matching IMAGE 1's top edge). Frame above the waistband is not rendered.

Render exactly ONE model — never two, never multiple instances. The output frame contains a single AI model wearing the target trousers and the target shoes; no second person, no comparison shot, no multi-angle layout.`;

const CHANGELOG = `# M02 — Matrix-paint bottom-focus back view (Seedream) — v30 (Tier-2 + ECOM layering ref + composite-back)

## Purpose
Replaces M02 rev 29 v9 (Tier-1 barefoot base + Gemini extend-hem-over-shoe post-step) with a fundamentally different architecture.

## Architecture
- Base = Tier-2 (qaShoeMatrix) legsBack — model ALREADY wears the production shoes with a placeholder briefs / hot pants. No Gemini hem-extend step needed: Seedream paints the trouser in one pass with the hem geometry guided by IMAGE 5.
- 5 named refs sent to Seedream + 1 silent anchor:
  - IMAGE 1: Tier-2 (model × shoe) legsBack
  - IMAGE 2: wardrobe.fitModels.back
  - IMAGE 3: wardrobe.fitModels.back45Left (fallback to .back when missing)
  - IMAGE 4: wardrobe.fitModels.back45Right (fallback to .back)
  - IMAGE 5: wardrobe.layeringRefBackUrl (per-garment G-Star ECOM back-view)
  - Slot 6: Tier-2 (model × shoe) legsBack AGAIN — silent anchor (NOT in prompt text, twin-prevention)
- After Seedream: paintTeeHemStrip adds the tucked-tee strip at the top of the frame (existing Gemini call, unchanged).
- After strip-paint: compositeBackBySimilarity restores Seedream's crisp pant pixels wherever Gemini's strip-paint would have softened them (per LEARNING #102).

## Why
Rev 29 (Tier-1 + Gemini hem-extend) had two persistent issues:
1. Stability ~67% across silhouette classes — the Gemini hem-extend step failed ~1/3 of the time on cross-family substitute layering refs.
2. Pant-texture regression — Gemini regenerated the whole canvas during the hem-extend and strip-paint steps, softening denim weave, pocket stitching, leather patch detail.

The new architecture removes the hem-extend step entirely (Seedream gets the hem authority visually from IMAGE 5) and adds a composite-back utility that undoes Gemini's drift-on-preservation by content-aware pixel masking. The label composite step (homography warp) is also retired — Seedream renders the brand patch directly from the visual refs.

## Validation (2026-05-24 offline test)
- Kate Boyfriend × F3 × heels (direct-match layering ref): 5/6 single-model, rolled cuff at mid-ankle preserved
- CONTOR 3D WIDE × F3 (same-parent colorway substitute layering ref): 6/6 across all criteria
- Cargo × M2 × boots (cross-SKU substitute, ankle-jogger Rovic): 2/6 — substitute quality issue, not architecture; expected to land >5/6 after substitute swap to d25523 Cargo 3D Regular Tapered

## Step 2 Prompt
\`\`\`
${NEW_PROMPT}
\`\`\`
`;

async function main() {
  const dryRun = process.argv.includes('--dry');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE COMMIT'}`);

  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const activeSnap = await db.collection('promptVault')
    .where('shotType', '==', 'M02')
    .where('isActive', '==', true)
    .where('pipeline', '==', 'seedream')
    .get();
  console.log(`Currently active M02 seedream prompts: ${activeSnap.size}`);
  for (const d of activeSnap.docs) {
    const data = d.data() as { revision?: number };
    console.log(`  WOULD DEACTIVATE: ${d.id} (rev ${data.revision})`);
  }

  const latestSnap = await db.collection('promptVault')
    .where('shotType', '==', 'M02')
    .orderBy('revision', 'desc')
    .limit(1)
    .get();
  const latestRev = latestSnap.empty ? 0 : (latestSnap.docs[0].data().revision || 0);
  const newRev = latestRev + 1;
  console.log(`Latest M02 revision: ${latestRev}, new revision will be: ${newRev}`);
  console.log(`New prompt length: ${NEW_PROMPT.length} chars`);

  if (dryRun) {
    console.log('\n--- NEW PROMPT (would be uploaded) ---');
    console.log(NEW_PROMPT);
    console.log('\nDRY RUN — no Firestore writes performed.');
    return;
  }

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
    filename: `M02_v30_tier2_ecom_layering_compositeback.md`,
    uploadedBy: 'claude-cli (session 2026-05-24, rev 30 architecture pivot)',
    uploadedAt: new Date(),
  });
  await batch.commit();
  console.log(`✓ Uploaded new active M02 prompt: id=${newRef.id}, revision=${newRev}`);
  console.log(`Old active prompt (rev ${latestRev}) deactivated.`);
}

main().catch(e => { console.error(e); process.exit(1); });
