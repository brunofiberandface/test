/**
 * OFFLINE END-TO-END TEST — M02 rev 32 architecture (ByteDance v1 audit
 * pattern restored: Tier-2 + per-garment ECOM layering + per-ref OUT-scoping
 * labels + silent anti-twin anchor + positional composite on strip-paint).
 *
 * Runs the FULL pipeline locally without going through Cloud Run:
 *   1. Resolve job + wardrobe + Tier-2 cell from the live API + Firestore
 *   2. Seedream paint with rev-31 5-ref structure (no slot-6 anchor)
 *   3. paintTeeHemStrip — pre-blurs pant region, Gemini paints tee in upper,
 *      positionally composites with Seedream's pant below (single call, no
 *      separate composite stage).
 *
 * Saves TWO stages per run:
 *   run{N}_1_seedream.png — raw Seedream paint (no tee, crisp pant)
 *   run{N}_2_final.png    — post strip-paint (Gemini tee above the cut +
 *                           Seedream pant below, by construction)
 *
 * The architecture means:
 *   - Pocket-bleed onto tee is impossible (Gemini sees only blurred pant)
 *   - Pant pixels below the cut are byte-identical to Seedream (positional)
 *   - Cropped/tucked/untucked modes use different cutFractions internally
 *
 * Usage:
 *   npx tsx scripts/test-m02-tier2-arch.ts <jobId> [--runs=3]
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
import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';
import { paintTeeHemStrip } from '../src/lib/pipeline/matrix-paint';
import { detectTwinDiptych } from '../src/lib/pipeline/composite-back';

const jobId = process.argv[2];
if (!jobId) {
  console.error('Usage: npx tsx scripts/test-m02-tier2-arch.ts <jobId> [--runs=3]');
  process.exit(1);
}
const runsArg = process.argv.find(a => a.startsWith('--runs='));
const RUNS = runsArg ? parseInt(runsArg.split('=')[1], 10) : 3;

const OUT_DIR = path.join(projectRoot, `test_outputs/m02-tier2-arch/${jobId}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

/**
 * REV 32 PROMPT. Must stay in sync with scripts/promote-m02-v32.ts and the
 * vault entry. Changes vs rev 31:
 *   - GLOBAL_RULES block at the top (TIER PRIORITY / MODEL LOCK / EDIT ZONE
 *     LOCK / NO DUPLICATES) — ByteDance v1 audit pattern restored.
 *   - Slot-6 silent anchor RE-ADDED in the refs array (matrix-paint.ts
 *     companion change). Empty label keeps it anonymous to text encoder.
 *   - Per-ref OUT-scoping labels delivered via forceInventory: true on the
 *     generateSeedreamImage call (LEARNING #89 Path B).
 */
const PROMPT_REV_32 = `═══ GLOBAL RULES — APPLY TO EVERY REFERENCE IMAGE ═══
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

const BASE_LABEL =
  'BASE (Tier-2 model × shoe, back view). Authoritative source of truth for the rendered MODEL IDENTITY, body, pose, stance, hands, footwear, backdrop, lighting, framing, contact shadow. EVERY PIXEL OF THIS IMAGE IS PRESERVED EXCEPT the placeholder briefs / hot-pants area, which is REPLACED by the target trouser per IMAGES 2-4. The model in this image is THE ONE MODEL rendered in the output — no other body, no second instance.';
const GARMENT_LABEL =
  'GARMENT-ONLY REFERENCE (fit-model wearing the target trouser, back view angle). Authoritative source of truth for the trouser wash, base colour, fabric texture and finish, back-pocket construction, back-yoke / waistband construction, fly / closure visible on back, belt-loop spacing, hem treatment, overall silhouette shape and width progression. IGNORE this image\'s MODEL IDENTITY, SKIN, BODY PROPORTIONS, POSE, STANCE, LEGS, FEET, FOOTWEAR, BACKDROP, LIGHTING, and any garments above the waist. Those properties come from IMAGE 1 only.';
const LAYERING_LABEL =
  'LAYERING REFERENCE (G-Star ECOM back-view photo, possibly different fit model + possibly different wash). Authoritative source of truth EXCLUSIVELY for the trouser-hem-to-shoe geometric relationship: where the hem meets the shoe (covers / rests on / ends above / rolled cuff above), pant-fabric-outside / shoe-inside layer order. IGNORE this image\'s MODEL IDENTITY, garment wash / colour / fabric / fit / length / pockets / any non-hem detail, BODY, POSE, LEGS, and BACKDROP. Use ONLY the hem-shoe geometry.';

const cleanUrl = (u: string) => u.split('?')[0];

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  // 1. Resolve job
  const jobSnap = await db.collection('jobs').doc(jobId).get();
  if (!jobSnap.exists) {
    console.error(`Job ${jobId} not found`);
    process.exit(1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const job = jobSnap.data() as any;
  console.log(`Job: ${job.jobName} (model=${job.modelId})`);
  const wardrobe = job.wardrobe || {};
  const bottomId = wardrobe.bottom?.itemId;
  const shoeId = wardrobe.shoe?.itemId;
  // --topId=<id> override lets us swap the top into a fixed job without
  // mutating Firestore. Useful for "same Kate render, paint Brown tshirt"
  // type tests.
  const topIdArg = process.argv.find(a => a.startsWith('--topId='));
  const topId = topIdArg ? topIdArg.split('=')[1] : wardrobe.top?.itemId;
  if (topIdArg) {
    console.log(`[override] using --topId=${topId} (job's wardrobe.top.itemId=${wardrobe.top?.itemId || '(none)'})`);
  }
  if (!bottomId || !shoeId) {
    console.error(`Job missing bottom (${bottomId}) or shoe (${shoeId})`);
    process.exit(1);
  }

  // 2. Resolve bottom wardrobe item (fit-model back angles + layering ref)
  const bottomSnap = await db.collection('wardrobe').doc(bottomId).get();
  if (!bottomSnap.exists) {
    console.error(`Bottom item ${bottomId} not found`);
    process.exit(1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bottom = bottomSnap.data() as any;
  const fm = bottom.fitModels || {};
  if (!fm.back) {
    console.error(`Bottom ${bottomId} has no fitModels.back`);
    process.exit(1);
  }
  const fitBack = fm.back;
  const fitBack45L = fm.back45Left || fm.back;
  const fitBack45R = fm.back45Right || fm.back;
  const layeringRef = bottom.layeringRefBackUrl;
  if (!layeringRef) {
    console.error(`Bottom ${bottomId} has no layeringRefBackUrl — run scripts/backfill-layering-refs.ts first`);
    process.exit(1);
  }

  // 3. Resolve Tier-2 (qaShoeMatrix) legsBack
  const cellId = `${shoeId}_${job.modelId}`;
  const cellSnap = await db.collection('qaShoeMatrix').doc(cellId).get();
  if (!cellSnap.exists) {
    console.error(`Tier-2 cell ${cellId} not found in qaShoeMatrix`);
    process.exit(1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cell = cellSnap.data() as any;
  const tier2LegsBack = cell.images?.legsBack;
  if (!tier2LegsBack) {
    console.error(`Tier-2 cell ${cellId} has no images.legsBack`);
    process.exit(1);
  }

  // 4. Resolve top wardrobe item (for strip-paint)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let top: any = null;
  let topRefUrl: string | undefined;
  let topDescription = '';
  let topRenderingHint: string | undefined;
  if (topId) {
    const topSnap = await db.collection('wardrobe').doc(topId).get();
    if (topSnap.exists) {
      top = topSnap.data();
      const topFm = top.fitModels || {};
      const nonEmpty = (s: string | undefined | null) =>
        (typeof s === 'string' && s.length > 0) ? s : undefined;
      // For M02 (back view): prefer back flat → front flat → fit-model back → fit-model front
      topRefUrl = nonEmpty(top.flatBackUrl)
        || nonEmpty(top.flatFrontUrl)
        || nonEmpty(top.flatImageUrl)
        || nonEmpty(topFm.back)
        || nonEmpty(topFm.front);
      topDescription = top.topDescription || top.description || top.name || 'fitted top';
      topRenderingHint = top.topRenderingHint || undefined;
    }
  }

  // 5. Echo plan
  console.log(`\n=== Inputs ===`);
  console.log(`Tier-2 base:    ${cleanUrl(tier2LegsBack)}`);
  console.log(`Fit back:       ${cleanUrl(fitBack)}`);
  console.log(`Fit back45L:    ${cleanUrl(fitBack45L)}`);
  console.log(`Fit back45R:    ${cleanUrl(fitBack45R)}`);
  console.log(`Layering ref:   ${cleanUrl(layeringRef)}`);
  console.log(`Top ref:        ${topRefUrl ? cleanUrl(topRefUrl) : '(none — strip-paint will skip)'}`);
  console.log(`Top desc:       ${topDescription.slice(0, 80)}${topDescription.length > 80 ? '...' : ''}`);
  console.log(`Top hint:       ${topRenderingHint || '(none — defaults to tucked)'}`);
  console.log(`Prompt length:  ${PROMPT_REV_32.length} chars`);
  console.log(`Runs:           ${RUNS}`);
  console.log(`Output dir:     ${OUT_DIR}`);

  fs.writeFileSync(
    path.join(OUT_DIR, 'inputs.json'),
    JSON.stringify({
      jobId, jobName: job.jobName, modelId: job.modelId, bottomId, bottomName: bottom.name,
      shoeId, topId, tier2LegsBack: cleanUrl(tier2LegsBack), fitBack: cleanUrl(fitBack),
      fitBack45L: cleanUrl(fitBack45L), fitBack45R: cleanUrl(fitBack45R),
      layeringRef: cleanUrl(layeringRef), topRefUrl: topRefUrl ? cleanUrl(topRefUrl) : null,
      topDescription, topRenderingHint: topRenderingHint || null, promptRev: 32, runs: RUNS, timestamp: new Date().toISOString(),
    }, null, 2),
  );

  for (let i = 1; i <= RUNS; i++) {
    console.log(`\n=== run ${i}/${RUNS} ===`);
    try {
      // ── 1. Seedream paint (rev 32: 5 named refs + 1 silent anchor;
      //      per-ref labels delivered via forceInventory: true)
      // Seedream pass-1 with twin-detect + re-roll (matches matrixPaint prod path).
      const MAX_TWIN_ROLLS = 3;
      const t1 = Date.now();
      let seedreamBuf: Buffer | null = null;
      let twinAttempts = 0;
      for (let attempt = 1; attempt <= MAX_TWIN_ROLLS; attempt++) {
        const r = await generateSeedreamImage({
          prompt: PROMPT_REV_32,
          referenceImages: [
            { url: cleanUrl(tier2LegsBack),  label: BASE_LABEL },     // IMAGE 1
            { url: cleanUrl(fitBack),         label: GARMENT_LABEL },  // IMAGE 2
            { url: cleanUrl(fitBack45L),      label: GARMENT_LABEL },  // IMAGE 3
            { url: cleanUrl(fitBack45R),      label: GARMENT_LABEL },  // IMAGE 4
            { url: cleanUrl(layeringRef),     label: LAYERING_LABEL }, // IMAGE 5
            { url: cleanUrl(tier2LegsBack),   label: '' },             // silent anti-twin anchor
          ],
          aspectRatio: '1:1',
          forceInventory: true,
        });
        const det = await detectTwinDiptych(r.imageData);
        if (!det.isTwin) {
          seedreamBuf = r.imageData;
          if (attempt > 1) console.log(`    twin re-roll: passed on attempt ${attempt} (lum=${det.luminance.toFixed(0)}, blueDom=${det.blueDominance.toFixed(0)})`);
          break;
        }
        twinAttempts++;
        if (attempt < MAX_TWIN_ROLLS) {
          console.warn(`    twin DETECTED on attempt ${attempt}/${MAX_TWIN_ROLLS} (lum=${det.luminance.toFixed(0)}, blueDom=${det.blueDominance.toFixed(0)}) — re-rolling`);
        } else {
          console.error(`    twin DETECTED on final attempt ${attempt}/${MAX_TWIN_ROLLS} (lum=${det.luminance.toFixed(0)}, blueDom=${det.blueDominance.toFixed(0)}) — shipping anyway`);
          seedreamBuf = r.imageData;
        }
      }
      if (!seedreamBuf) throw new Error('Seedream produced no buffer');
      const dt1 = ((Date.now() - t1) / 1000).toFixed(1);
      const seedreamPath = path.join(OUT_DIR, `run${i}_1_seedream.png`);
      fs.writeFileSync(seedreamPath, seedreamBuf);
      console.log(`  [1/2] seedream  ${dt1}s — ${(seedreamBuf.length / 1024).toFixed(0)}KB  twinRetries=${twinAttempts} → run${i}_1_seedream.png`);

      // ── 2. Strip-paint (Gemini) — paintTeeHemStrip now pre-blurs the
      //    pant region in input + positionally composites on output, so
      //    its return value IS the final image. No separate composite step.
      if (topRefUrl) {
        const t2 = Date.now();
        const stripResult = await paintTeeHemStrip(
          seedreamBuf,
          topRefUrl,
          topDescription,
          'M02',
          undefined, // geminiApiKey — use env
          topRenderingHint,
        );
        const finalBuf = stripResult.imageData;
        const dt2 = ((Date.now() - t2) / 1000).toFixed(1);
        const finalPath = path.join(OUT_DIR, `run${i}_2_final.png`);
        fs.writeFileSync(finalPath, finalBuf);
        console.log(`  [2/2] strip+composite ${dt2}s — ${(finalBuf.length / 1024).toFixed(0)}KB → run${i}_2_final.png`);
      } else {
        console.log(`  [2/2] strip-paint SKIPPED — no top ref`);
      }
    } catch (e) {
      console.error(`FAIL run ${i}: ${(e as Error).message}`);
    }
  }

  console.log(`\n✓ Test complete. Review the 2 stages per run:`);
  console.log(`  open ${OUT_DIR}`);
  console.log(`\nFor each run N, compare:`);
  console.log(`  run${RUNS}_1_seedream.png — raw Seedream paint (crisp pant, no tee)`);
  console.log(`  run${RUNS}_2_final.png    — final: positional composite (Gemini tee above cut, Seedream pant below)`);
  console.log(`\nIf stage 2's pant is byte-identical to stage 1 below the cut AND has the tee above → architecture works.`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
