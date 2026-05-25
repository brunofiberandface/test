/**
 * Upload the rev-32 M02 prompt as the new active vault entry.
 *
 * Rev 32 = ByteDance v1 audit pattern restored on the rev-30/31 architecture.
 *
 * Changes vs rev 31:
 *   - GLOBAL_RULES block re-introduced at the head of the prompt body:
 *       TIER PRIORITY / MODEL LOCK / EDIT ZONE LOCK / NO DUPLICATES.
 *     This is the third leg of the historical anti-twin tripod (the other two
 *     are the silent slot-6 anchor + the per-ref OUT-scoping labels, both
 *     reinstated in matrix-paint.ts on the same date).
 *   - Sandwich enforcement kept: GLOBAL_RULES at the top + single-person
 *     repeat at the end of the prompt.
 *   - Task body wording matches rev 31 (no functional change — Seedream still
 *     paints the trouser onto the Tier-2 base, IMAGE 5 = layering authority).
 *
 * Per LEARNING #88 / #89 / #101 / DEPLOYMENT_LOG.md line 212 — this pattern
 * delivered 3/3 single-model output on the M01 twin-bug regression test.
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

const NEW_PROMPT = `═══ GLOBAL RULES — APPLY TO EVERY REFERENCE IMAGE ═══
1. TIER PRIORITY. IMAGE 1 is authoritative for the rendered body, pose, stance, footwear, backdrop, and contact shadow. IMAGES 2-4 are authoritative for the trouser identity (wash, colour, fabric, pockets, construction, silhouette). IMAGE 5 is authoritative ONLY for the trouser-hem-to-shoe geometric relationship (does the hem cover, rest on, end above, or cuff above the shoe). No reference contributes outside its assigned domain.
2. MODEL LOCK. The output contains the SAME AI MODEL that appears in IMAGE 1 — same identity, same skin tone, same body, same hands at the same position, same stance and foot placement. No other model is rendered. The fit-model bodies visible in IMAGES 2-4 and IMAGE 5 are GARMENT MANNEQUINS for reference only; their bodies are NOT in the output.
3. EDIT ZONE LOCK. The only region of IMAGE 1 that may change is the placeholder briefs / hot-pants area below the waistband. Skin (above and at the waistband edge), shoes, backdrop, lighting, and contact shadow are byte-preserved from IMAGE 1.
4. NO DUPLICATES. The output is ONE single-subject product photo. It is NEVER a diptych, side-by-side, before/after, multi-angle composition, or comparison grid. There is exactly ONE person in the frame, centred.

═══ TASK ═══
Merge IMAGE 1 (AI model wearing the target shoes and a black underwear placeholder, waist-down back view) with IMAGES 2-4 (fitmodel wearing the target trousers, viewed from 3 back angles: straight back, back 45° left, back 45° right) and IMAGE 5 (G-Star ECOM back-view reference of the same trouser STYLE worn over shoes from behind — DIFFERENT fit model, possibly different wash colorway).

Output = IMAGE 1 with the underwear placeholder replaced by the target trousers.

Preserve the trousers' wash, color, fit, length, drape, hem behavior, width progression, and back-pocket construction exactly as in IMAGES 2-4 — use the 3 fitmodel angles to triangulate the true garment silhouette.

The trouser hem-to-shoe relationship matches IMAGE 5: the trouser fabric is the OUTER layer, the shoes are INNER, the hem-to-shoe position (covers shoes / rests on shoes / ends above shoes / rolled cuff above shoes) is rendered exactly as visible in IMAGE 5.

IMAGE 5 IS THE LAYERING AUTHORITY ONLY (per GLOBAL RULE 1). Use it EXCLUSIVELY for the geometric relationship between trouser hem and shoe. Do NOT take from IMAGE 5: garment wash, color, fabric, fit, length, pocket construction (those come from IMAGES 2-4). Do NOT render the fit model shown in IMAGE 5 — that person is a DIFFERENT individual whose body is NOT the rendered output (per GLOBAL RULE 2).

Preserve IMAGE 1's model identity, pose, body proportions, both shoes (do not modify shoe position, style, or size), and backdrop (per GLOBAL RULE 3). The top edge of the output frame is at the waistband level (exactly matching IMAGE 1's top edge). Frame above the waistband is not rendered.

═══ SINGLE-PERSON ENFORCEMENT ═══
The output is a single-subject product photo with the SAME body as IMAGE 1. ONE model, centred (per GLOBAL RULE 4). Never two. Never side-by-side. Never mirrored. Never ghosted. If you find yourself about to render a second body — for instance because IMAGES 2-5 each show a body — STOP. Those bodies are garment mannequins, not output subjects. The output contains exactly ONE person, the one from IMAGE 1.`;

const CHANGELOG = `# M02 — Matrix-paint bottom-focus back view (Seedream) — v32 (ByteDance v1 audit pattern restored)

## Purpose
Restore the documented anti-twin defenses (LEARNING #88, #89, #101). The rev 30/31 lean-prompt experiment regressed on twin/diptych output when M02 expanded to 5 named refs. The fix is not new prompt text — it's restoring the proven 2026-05-18 ByteDance v1 audit pattern.

## Three-layer restoration (all committed together)

### Layer 1 — GLOBAL_RULES block (this vault entry, prompt body)
Four numbered rules at the head of the prompt: TIER PRIORITY / MODEL LOCK / EDIT ZONE LOCK / NO DUPLICATES. Mirrors the v1 GLOBAL_RULES that was deployed at rev 00591-5hh on 2026-05-18 and validated 3/3 single-model on M01 + M02 silhouette sweep.

### Layer 2 — Per-ref OUT-scoping labels (matrix-paint.ts)
Every garment ref carries a label specifying "GARMENT-ONLY REFERENCE — IGNORE this image's MODEL IDENTITY, SKIN, BODY, POSE, LEGS, FEET, FOOTWEAR, BACKDROP". The Tier-2 BASE ref carries the inverse: "Authoritative source for body/pose/shoes/backdrop, REPLACE only the placeholder briefs". IMAGE 5 layering ref is scoped exclusively to hem-shoe geometry.

### Layer 3 — Silent anti-twin anchor (matrix-paint.ts)
The Tier-2 BASE ref appears AGAIN at the last slot with an EMPTY label. Empty label keeps it out of the REFERENCE IMAGE INVENTORY listing, so the text encoder doesn't see "two BASE refs" — but the visual encoder sees the same body twice, reinforcing the single-model output (LEARNING #88).

### Plumbing — \`forceInventory\` flag (seedream-client.ts)
The "REFERENCE IMAGE INVENTORY" block that delivers labels to Seedream's text encoder was disabled globally on 2026-05-18 (LEARNING #89 Path B was rolled back along with the lean refs). Re-enabled conditionally via a \`forceInventory: true\` flag on the generateSeedreamImage call. M01/M02 set it to true. M05/M06 unaffected (continue lean).

## Ref structure (6 refs for M02 back-view)
- IMAGE 1: Tier-2 (model × shoe) legsBack — BASE label
- IMAGE 2-4: 3 back fit-model angles — GARMENT-ONLY label
- IMAGE 5: wardrobe.layeringRefBackUrl — LAYERING label
- Slot 6: Tier-2 legsBack AGAIN — empty label (silent anchor)

## Why language alone wasn't enough (rev 31 lesson)
Rev 31 tried "anti-twin language at top of prompt" without restoring the silent anchor or the OUT-scoping labels. BUGS_AND_FIXES.md line 10 already documented this: "Seedream's interpretation of multiple garment refs as 'compare these images' is hard to fully override at prompt level." Language is a contributor, not a substitute, for the ref-level defenses. Rev 32 stacks all three.

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
    filename: `M02_v32_bytedance_v1_audit_restored.md`,
    uploadedBy: 'claude-cli (session 2026-05-25, rev 32 ByteDance v1 restore)',
    uploadedAt: new Date(),
  });
  await batch.commit();
  console.log(`✓ Uploaded new active M02 prompt: id=${newRef.id}, revision=${newRev}`);
  console.log(`Old active prompt (rev ${latestRev}) deactivated.`);
}

main().catch(e => { console.error(e); process.exit(1); });
