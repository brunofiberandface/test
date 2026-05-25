/**
 * Upload the rev-31 M02 prompt as the new active vault entry.
 *
 * Rev 31 changes vs rev 30:
 *   - Anti-twin language moved to the TOP of the prompt (most-weighted position)
 *     with stronger geometric hard constraint: "EXACTLY ONE PERSON IN THE
 *     OUTPUT. The output IS NOT a comparison grid, IS NOT a diptych, IS NOT
 *     a multi-angle layout."
 *   - Dropped slot-6 silent Tier-2 anchor (was 5+1 refs in rev 30, now 5 refs).
 *     Validation on Kate Boyfriend showed 33% twin rate WITH the silent
 *     anchor — language-based hard constraint at prompt head is the new
 *     twin-prevention mechanism.
 *
 * Run with `--dry` first. Run without `--dry` to commit.
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

const NEW_PROMPT = `═══ HARD CONSTRAINT — EXACTLY ONE PERSON ═══
The output contains EXACTLY ONE person — ONE body, ONE pose, ONE pair of legs, ONE pair of shoes. The output IS NOT a diptych, comparison grid, side-by-side, before/after, or multi-angle layout. If the reference images suggest multiple bodies could be rendered, IGNORE that suggestion — you are rendering ONLY the AI model from IMAGE 1. No second person on the left, no second person on the right, no mirrored duplicate, no ghosted overlay. Single body, centred in frame. THIS RULE OVERRIDES ANY OTHER INSTRUCTION.

═══ TASK ═══
Merge IMAGE 1 (AI model wearing the target shoes and a black underwear placeholder, waist-down back view) with IMAGES 2-4 (fitmodel wearing the target trousers, viewed from 3 back angles: straight back, back 45° left, back 45° right) and IMAGE 5 (G-Star ECOM back-view reference of the same trouser STYLE worn over shoes from behind — DIFFERENT fit model, possibly different wash colorway).

Output = IMAGE 1 with the underwear placeholder replaced by the target trousers.

Preserve the trousers' wash, color, fit, length, drape, hem behavior, width progression, and back-pocket construction exactly as in IMAGES 2-4 — use the 3 fitmodel angles to triangulate the true garment silhouette.

The trouser hem-to-shoe relationship matches IMAGE 5: the trouser fabric is the OUTER layer, the shoes are INNER, the hem-to-shoe position (covers shoes / rests on shoes / ends above shoes / rolled cuff above shoes) is rendered exactly as visible in IMAGE 5.

IMAGE 5 IS THE LAYERING AUTHORITY ONLY. Use it EXCLUSIVELY for the geometric relationship between trouser hem and shoe (where the hem meets the shoe, whether it cascades / rests / is cuffed above). Do NOT take from IMAGE 5: garment wash, color, fabric, fit, length, pocket construction (those come from IMAGES 2-4). Do NOT render the fit model shown in IMAGE 5 — IMAGE 5's person is a DIFFERENT individual whose body is NOT the rendered output. The rendered output contains the AI model from IMAGE 1 ONLY.

Preserve IMAGE 1's model identity, pose, body proportions, both shoes (do not modify shoe position, style, or size), and backdrop. The top edge of the output frame is at the waistband level (exactly matching IMAGE 1's top edge). Frame above the waistband is not rendered.

═══ REPEAT — SINGLE PERSON ENFORCEMENT ═══
The output is a single-subject product photo. ONE model, centred. Never two. Never side-by-side. Never mirrored. Never ghosted. If you find yourself about to render a second body, STOP and re-render with only the first.`;

const CHANGELOG = `# M02 — Matrix-paint bottom-focus back view (Seedream) — v31 (anti-twin language + drop slot-6 anchor)

## Purpose
Tighten the twin-rendering failure mode observed on Kate Boyfriend × F3 testing 2026-05-24 (1/3 runs produced a diptych in the Seedream stage). The silent slot-6 Tier-2 anchor was supposed to bias Seedream toward single-model output by duplicating the canonical pose; in practice Seedream still went diptych on run 3.

## Architecture (changes from rev 30)
- 5 named refs sent to Seedream (NO slot-6 silent anchor):
  - IMAGE 1: Tier-2 (model × shoe) legsBack
  - IMAGE 2: wardrobe.fitModels.back
  - IMAGE 3: wardrobe.fitModels.back45Left (fallback to .back when missing)
  - IMAGE 4: wardrobe.fitModels.back45Right (fallback to .back)
  - IMAGE 5: wardrobe.layeringRefBackUrl (per-garment G-Star ECOM back-view)
- Anti-twin enforcement moved from ref-array duplication (rev 30, soft) to
  language-based hard constraint at the TOP of the prompt (rev 31, hard).
  The prompt now opens with "EXACTLY ONE PERSON" + repeats the rule at the
  end, sandwiching the substantive task between two single-subject enforcements.

## Companion changes (matrix-paint.ts, 2026-05-25)
- paintTeeHemStrip now pre-blurs the pant region in Gemini's input + uses
  positional (positional, not similarity-based) compositing on output.
  Prevents pocket-bleed artifacts on the tee body.
- compositeBackBySimilarity is no longer called from the M02 main path
  (replaced by positional composite inside paintTeeHemStrip).

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
    filename: `M02_v31_antitwin_drop_slot6.md`,
    uploadedBy: 'claude-cli (session 2026-05-25, rev 31 anti-twin pivot)',
    uploadedAt: new Date(),
  });
  await batch.commit();
  console.log(`✓ Uploaded new active M02 prompt: id=${newRef.id}, revision=${newRev}`);
  console.log(`Old active prompt (rev ${latestRev}) deactivated.`);
}

main().catch(e => { console.error(e); process.exit(1); });
