/**
 * Upload the v9 lean M02 Seedream prompt as a new active rev in the promptVault.
 *
 * Validated 2026-05-22 (Bruno confirmed v9 = 3/3 single+arms+framing+feet+garment
 * on F9 × Judee × loafer). Differs from rev 28 in TWO ways:
 *   1. Prompt body adds: SINGLE-MODEL line, framing lock (top edge at waistband,
 *      no bare back), anatomical-body-orientation, arms hanging at sides line.
 *   2. Ref structure changes from [Tier-2 base, fit-back] to
 *      [Tier-1 barefoot base, back, back45L, back45R, Tier-1 barefoot base (anchor)].
 *      (The ref-structure change is implemented in matrix-paint.ts; this file
 *      only handles the prompt text.)
 *
 * The Tier-1 base + extend-hem-over-shoe Gemini post-step replaces the old
 * Tier-2 (model × shoe) base — see matrix-paint.ts changes + gemini-shoe-step.ts.
 *
 * Run with --dry first to preview. Run without --dry to commit.
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

const NEW_PROMPT = `Merge IMAGE 1 (barefoot AI model in black placeholder underwear, waist-down) with IMAGES 2-4 (fitmodel wearing the target trousers, viewed from 3 back angles: straight back, back 45° left, back 45° right). Output = IMAGE 1 with the placeholder replaced by the trousers from IMAGES 2-4. Preserve the trousers' wash, color, fit, length, drape, hem behavior, width progression, and back-pocket construction exactly as in IMAGES 2-4 — use the 3 angles to triangulate the true garment silhouette. Preserve IMAGE 1's exact crop: the top edge of the output frame is at the waistband level (exactly matching IMAGE 1's top edge), model centered horizontally, bottom edge just below the feet. Frame above the waistband is not rendered. Preserve model identity, anatomical body orientation (entire back of body facing the camera as in IMAGE 1), arms hanging naturally at both sides of the body (visible from the shoulders down past the hips, as in IMAGE 1), and bare feet. Render exactly ONE model.`;

const CHANGELOG = `# M02 — Matrix-paint bottom-focus back view (Seedream) — v9 (Tier-1 + 3 back angles + anchor)

## Purpose
Replaces M02 rev 28 (lean ~60w with Tier-2 model×shoe base) with a fundamentally different architecture:
- Base = Tier-1 BAREFOOT model (model.assets4K_legsBack) — no shoes painted on yet
- 5 refs sent to Seedream: Tier-1 base (slot 0) + 3 back fit-model angles (back, back45L, back45R) + Tier-1 base AGAIN (slot 4 silent anchor)
- Prompt locks: single model, framing (top edge at waistband), anatomical body orientation, arms at sides, bare feet
- After Seedream, a NEW Gemini step (geminiExtendHemOverShoe in gemini-shoe-step.ts) adds shoes from wardrobe.shoe.flatBackUrl, extending the pant hem to cover them

## Why
Rev 28 (lean with Tier-2 shoe base) had a persistent bug: pant hem stopped at top of shoe in back-view renders. Months of Seedream-only iteration couldn't fix it (LEARNINGS #98, #101, #104, plus the rev 27 TIER framework that produced new bugs).

The architectural fix:
- Seedream paints jeans on a BAREFOOT base → no shoe-conflict, hem cascades naturally to floor
- Gemini-3-pro-image-preview adds shoes UNDER the extended hem in a post-step (validated LEARNING #104, 4/6 on AXEL ARIGATO low-tops; chunky loafer renders shoe-visible-below-hem which is acceptable per Bruno 2026-05-22)

## Validation (2026-05-22 session, Judee × F9 × black chunky platform loafer)
v9 evolution (12 versions iterated, see test_outputs/sole-mode/m02-lean-prompt-audit-v*):
- v1: lean ~70w no foot lock — 3/3 single+framing, 2/3 feet (1/3 toes)
- v2: + "heels facing" — 0/3 (stilettos rendered)
- v3: + "back of foot toward camera" — 1/3 catastrophic
- v4: + anatomical-body-orientation — 3/3 framing OK, missed arms
- v5: + 3 back refs — fit-models overwhelmed, 1/3 full bare back
- v6: + strengthened framing line — high variance
- v7: + matrix anchor at slot 4 — framing restored, still missed arms
- v8: + arms line + verbal "IMAGE 5" mention — 1/3 twin (comparison shot)
- v9: dropped verbal IMAGE 5 (silent anchor) + arms — 3/3 across all criteria ✓

## Architecture context
- IMAGE 1 = Tier-1 barefoot legsBack (model.assets4K_legsBack)
- IMAGE 2 = fit-model back (canonical)
- IMAGE 3 = fit-model back45 left
- IMAGE 4 = fit-model back45 right
- IMAGE 5 = Tier-1 barefoot legsBack AGAIN (silent anchor — not mentioned in prompt text)
- No reference labels prepended (seedream-client strips them)

## Pipeline order (M02 bottom-focus)
1. Seedream paint (this prompt) → barefoot painted M02
2. Gemini extend-hem-over-shoe (geminiExtendHemOverShoe) → adds shoes under hem
3. Gemini strip-paint tee (paintTeeHemStrip) — existing
4. Label composite, matte, deliverable — existing

## Step 2 Prompt

\`\`\`
${NEW_PROMPT}
\`\`\`
`;

async function main() {
  const dryRun = process.argv.includes('--dry');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE COMMIT'}`);

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
    const data = d.data() as any;
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
    filename: `M02_v9_tier1_3angles_anchor.md`,
    uploadedBy: 'claude-cli (session 2026-05-22, see LEARNINGS #104 + v1-v9 audit)',
    uploadedAt: new Date(),
  });
  await batch.commit();
  console.log(`✓ Uploaded new active M02 prompt: id=${newRef.id}, revision=${newRev}`);
  console.log(`Old active prompt (rev ${latestRev}) deactivated.`);
}
main().catch(e => { console.error(e); process.exit(1); });
