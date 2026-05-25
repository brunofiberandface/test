/**
 * Upload M01 v2 prompt as new active rev in promptVault (deactivates rev 23).
 *
 * v2 prompt: mirrors the proven M02 v9 architecture (framing lock + body
 * orientation + arms + single model) but front-view, with Tier-2 matrix base
 * (model wearing shoes) and 4 garment refs (front canonical + front45L +
 * front45R + flat front).
 *
 * Validated 2026-05-22 (3/3 single+arms+framing+Judee front-construction+
 * shoes preserved on F9 × Judee × black loafer). v3 (simplified angle
 * labels) regressed to 2/3 framing — reverted to v2.
 *
 * Code change for 5-ref M01 is already in matrix-paint.ts, pending next deploy.
 *
 * Run with --dry first. Run without --dry to commit.
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

const NEW_PROMPT = `Merge IMAGE 1 (AI model wearing shoes and black placeholder underwear, waist-down) with IMAGES 2-4 (fitmodel wearing the target trousers, viewed from 3 front angles: straight front, front 45° left, front 45° right) and IMAGE 5 (the garment flat-front product photo — supplementary reference for color, wash, and front-panel construction). Output = IMAGE 1 with the placeholder replaced by the trousers from IMAGES 2-5. Preserve the trousers' wash, color, fit, length, drape, hem behavior, width progression, and front-panel construction (button fly, rivets, fly stitching, front-pocket shapes, belt loops) exactly as in IMAGES 2-5 — use the multiple angles plus the flat to triangulate the true garment silhouette. Preserve IMAGE 1's exact crop: the top edge of the output frame is at the waistband level (exactly matching IMAGE 1's top edge), model centered horizontally, bottom edge just below the feet. Frame above the waistband is not rendered. Preserve model identity, anatomical body orientation (entire front of body facing the camera as in IMAGE 1), arms hanging naturally at both sides of the body (visible from the shoulders down past the hips, as in IMAGE 1), and the shoes from IMAGE 1. Render exactly ONE model.`;

const CHANGELOG = `# M01 — Matrix-paint bottom-focus front view (Seedream) — v2 (5 refs)

## Purpose
Replaces M01 rev 23 (lean 60-word "merge the two images") with the proven M02 v9 architecture, adapted for front view.

## Refs (5)
- IMAGE 1: Tier-2 matrix base (model × shoe legsFront — model wearing shoes + placeholder underwear)
- IMAGE 2: fit-model front canonical
- IMAGE 3: fit-model front45 left
- IMAGE 4: fit-model front45 right
- IMAGE 5: garment flat-front product photo

## Why
Bruno 2026-05-22: M01 had only 2 refs (matrix base + fit-front). Adding front45L + front45R + flat front gives Seedream more visual data to triangulate garment shape. Front-view inputs are now 4K (separate backfill task).

## Validation
- v2 (with angle labels): 3/3 clean (single model + arms + framing + Judee front construction + shoes preserved) on F9 × Judee × black loafer
- v3 (simplified angle labels): 2/3 (1/3 zoom-in failure) — reverted to v2

## No Gemini shoe step on M01
Front view doesn't have the back-view pant-over-shoe layering problem
(toes-toward-camera renders cleanly). Shoes are preserved from the
Tier-2 matrix base directly.

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
    .where('shotType', '==', 'M01')
    .where('isActive', '==', true)
    .where('pipeline', '==', 'seedream')
    .get();
  console.log(`Currently active M01 seedream prompts: ${activeSnap.size}`);
  for (const d of activeSnap.docs) {
    const data = d.data() as any;
    console.log(`  WOULD DEACTIVATE: ${d.id} (rev ${data.revision})`);
  }

  const latestSnap = await db.collection('promptVault')
    .where('shotType', '==', 'M01')
    .orderBy('revision', 'desc')
    .limit(1)
    .get();
  const latestRev = latestSnap.empty ? 0 : (latestSnap.docs[0].data().revision || 0);
  const newRev = latestRev + 1;
  console.log(`Latest M01 revision: ${latestRev}, new revision will be: ${newRev}`);
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
    shotType: 'M01',
    pipeline: 'seedream',
    revision: newRev,
    isActive: true,
    isAlternative: false,
    content: CHANGELOG,
    filename: `M01_v2_5refs.md`,
    uploadedBy: 'claude-cli (session 2026-05-22, M01 v2 validated 3/3)',
    uploadedAt: new Date(),
  });
  await batch.commit();
  console.log(`✓ Uploaded new active M01 prompt: id=${newRef.id}, revision=${newRev}`);
  console.log(`Old active prompt (rev ${latestRev}) deactivated.`);
}
main().catch(e => { console.error(e); process.exit(1); });
