/**
 * OFFLINE TEST — fullBody architecture for both M01 (front) and M02 (back).
 *
 * No production wiring. Goal: produce both full-body views per Bruno's
 * 2026-05-25 direction:
 *   "lets fully create the top mapping with gemini. then we can see how we
 *    can merge seedream and gemini back to preserve the seedream quality.
 *    but first lets create the both views."
 *
 * Pipeline per view:
 *   1. Seedream pass-1 on fullBody Tier-2 base (model + sports-bra +
 *      placeholder pants + correct shoes) — paints the trouser in.
 *      Uses the same multi-ref + per-ref-label + silent-anchor + forceInventory
 *      structure proven 3/3 single-model at rev 32.
 *   2. Gemini pass-2 via `geminiPaintTop` — paints the wardrobe top onto
 *      the torso (replaces the sports-bra placeholder), hem in front of
 *      waistband per the top's fit-model evidence.
 *
 * Output per (run × view):
 *   {jobId}/run{N}_M01_1_seedream_fullbody.png
 *   {jobId}/run{N}_M01_2_gemini_full.png
 *   {jobId}/run{N}_M02_1_seedream_fullbody.png
 *   {jobId}/run{N}_M02_2_gemini_full.png
 *
 * Usage:
 *   npx tsx scripts/test-fullbody-gemini.ts <jobId> [--runs=3] [--views=M01,M02]
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
import { generateSeedreamImage, type SeedreamReferenceImage } from '../src/lib/pipeline/seedream-client';
import { geminiPaintTop } from '../src/lib/pipeline/gemini-toppaint';
import { buildBottomPaintPromptInline } from '../src/lib/pipeline/matrix-paint';
import { normalizeWardrobeItem } from '../src/lib/wardrobe-compat';

const jobId = process.argv[2];
if (!jobId) {
  console.error('Usage: npx tsx scripts/test-fullbody-gemini.ts <jobId> [--runs=3] [--views=M01,M02]');
  process.exit(1);
}
const runsArg = process.argv.find(a => a.startsWith('--runs='));
const RUNS = runsArg ? parseInt(runsArg.split('=')[1], 10) : 3;
const viewsArg = process.argv.find(a => a.startsWith('--views='));
const VIEWS: Array<'M01' | 'M02'> = viewsArg
  ? (viewsArg.split('=')[1].split(',').map(s => s.trim().toUpperCase()) as Array<'M01' | 'M02'>)
  : ['M01', 'M02'];

const OUT_DIR = path.join(projectRoot, `test_outputs/fullbody-gemini/${jobId}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

const cleanUrl = (u: string) => u.split('?')[0];

// Per-ref labels copied verbatim from matrix-paint.ts (ByteDance v1 restore).
const BASE_LABEL_M02_FULLBODY =
  'BASE (Tier-2 model × shoe, FULL-BODY back view). Authoritative source of truth for the rendered MODEL IDENTITY, head, hair, neck, torso silhouette, body, pose, stance, hands, footwear, backdrop, lighting, framing, contact shadow. EVERY PIXEL OF THIS IMAGE IS PRESERVED EXCEPT (a) the placeholder briefs / hot-pants area below the waistband, which is REPLACED by the target trouser per IMAGES 2-4, AND (b) the sports-bra / bare-torso area above the waistband, which a later pipeline stage will replace with the wardrobe top. The model in this image is THE ONE MODEL rendered in the output — no other body, no second instance.';
const BASE_LABEL_M01_FULLBODY =
  'BASE (Tier-2 model × shoe, FULL-BODY front view). Same construction rules as the M02 back fullBody: head + body + footwear + backdrop preserved; placeholder briefs REPLACED by the target trouser per the garment refs; sports-bra placeholder above the waistband stays for a later pipeline stage. ONE MODEL ONLY in the output.';
const GARMENT_LABEL_M02 =
  'GARMENT-ONLY REFERENCE (fit-model wearing the target trouser, back view angle). Authoritative source of truth for the trouser wash, base colour, fabric texture and finish, back-pocket construction, back-yoke / waistband construction, fly / closure visible on back, belt-loop spacing, hem treatment, overall silhouette shape and width progression. IGNORE this image\'s MODEL IDENTITY, SKIN, BODY PROPORTIONS, POSE, STANCE, LEGS, FEET, FOOTWEAR, BACKDROP, LIGHTING, and any garments above the waist. Those properties come from IMAGE 1 only.';
const GARMENT_LABEL_M01 =
  'GARMENT-ONLY REFERENCE (fit-model wearing the target trouser, front view angle). Authoritative source of truth for the trouser wash, base colour, fabric texture, fly / button / closure, front-pocket geometry, rise, hem treatment, overall silhouette shape and width progression. IGNORE this image\'s MODEL IDENTITY, SKIN, BODY PROPORTIONS, POSE, STANCE, LEGS, FEET, FOOTWEAR, BACKDROP, LIGHTING, and any garments above the waist. Those come from IMAGE 1 only.';
const FLAT_LABEL_M01 =
  'GARMENT FLAT (no body). Authoritative source for the trouser construction and graphic detail visible on a flat photo — wash variation, fly stitching, rivet placement, pocket bag visibility, hardware. IGNORE the orientation / fit / drape distortion of a flat layout; the body-on garment shape comes from the fit-model refs.';
const LAYERING_LABEL =
  'LAYERING REFERENCE (G-Star ECOM back-view photo, possibly different fit model + possibly different wash). Authoritative source of truth EXCLUSIVELY for the trouser-hem-to-shoe geometric relationship: where the hem meets the shoe (covers / rests on / ends above / rolled cuff above), pant-fabric-outside / shoe-inside layer order. IGNORE this image\'s MODEL IDENTITY, garment wash / colour / fabric / fit / length / pockets / any non-hem detail, BODY, POSE, LEGS, and BACKDROP. Use ONLY the hem-shoe geometry.';

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  // 1. Resolve job
  const jobSnap = await db.collection('jobs').doc(jobId).get();
  if (!jobSnap.exists) { console.error(`Job ${jobId} not found`); process.exit(1); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const job = jobSnap.data() as any;
  console.log(`Job: ${job.jobName} (model=${job.modelId})`);
  const wardrobe = job.wardrobe || {};
  const bottomId = wardrobe.bottom?.itemId;
  const shoeId = wardrobe.shoe?.itemId;
  const topId = wardrobe.top?.itemId;
  if (!bottomId || !shoeId) { console.error(`Job missing bottom (${bottomId}) or shoe (${shoeId})`); process.exit(1); }

  // 2. Bottom
  const bottomSnap = await db.collection('wardrobe').doc(bottomId).get();
  if (!bottomSnap.exists) { console.error(`Bottom ${bottomId} not found`); process.exit(1); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bottom = bottomSnap.data() as any;
  const normalized = normalizeWardrobeItem(bottom);
  if (!normalized) { console.error(`Bottom ${bottomId} has no usable images`); process.exit(1); }
  const fm = normalized.fitModels;
  const bottomName = (bottom.name as string) || 'bottom garment';
  const bottomDescription = (bottom.description as string) || bottomName;
  const layeringRefUrl = (bottom.layeringRefBackUrl as string | undefined);
  const layeringRefClean = layeringRefUrl ? cleanUrl(layeringRefUrl) : undefined;

  // 3. Shoe
  const shoeSnap = await db.collection('wardrobe').doc(shoeId).get();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shoe = shoeSnap.exists ? shoeSnap.data() as any : null;
  const shoeName = (shoe?.name as string) || 'footwear';
  const shoeDescription = (shoe?.description as string) || shoeName;

  // 4. Tier-2 fullBody cells (front + back)
  const cellId = `${shoeId}_${job.modelId}`;
  const cellSnap = await db.collection('qaShoeMatrix').doc(cellId).get();
  if (!cellSnap.exists) { console.error(`Tier-2 cell ${cellId} not found`); process.exit(1); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cell = cellSnap.data() as any;
  const fullBodyFront = cell.images?.fullBodyFront;
  const fullBodyBack = cell.images?.fullBodyBack;

  console.log(`\n=== Inputs ===`);
  console.log(`Job:                ${job.jobName}`);
  console.log(`Model:              ${job.modelId}`);
  console.log(`Bottom:             ${bottomName} (${bottomId})`);
  console.log(`Shoe:               ${shoeName} (${shoeId})`);
  console.log(`Top:                ${topId || '(none)'}`);
  console.log(`fullBodyFront URL:  ${fullBodyFront ? cleanUrl(fullBodyFront).slice(-80) : '(missing)'}`);
  console.log(`fullBodyBack URL:   ${fullBodyBack ? cleanUrl(fullBodyBack).slice(-80) : '(missing)'}`);
  console.log(`Layering ref:       ${layeringRefClean ? layeringRefClean.slice(-60) : '(none)'}`);
  console.log(`Views:              ${VIEWS.join(', ')}`);
  console.log(`Runs:               ${RUNS}`);
  console.log(`Output dir:         ${OUT_DIR}`);

  fs.writeFileSync(
    path.join(OUT_DIR, 'inputs.json'),
    JSON.stringify({
      jobId, jobName: job.jobName, modelId: job.modelId,
      bottomId, bottomName, shoeId, shoeName, topId: topId || null,
      fullBodyFront: fullBodyFront ? cleanUrl(fullBodyFront) : null,
      fullBodyBack: fullBodyBack ? cleanUrl(fullBodyBack) : null,
      layeringRef: layeringRefClean || null,
      views: VIEWS, runs: RUNS, timestamp: new Date().toISOString(),
    }, null, 2),
  );

  for (let i = 1; i <= RUNS; i++) {
    console.log(`\n=========================  run ${i}/${RUNS}  =========================`);

    for (const view of VIEWS) {
      const isBack = view === 'M02';
      const tier2Url = isBack ? fullBodyBack : fullBodyFront;
      if (!tier2Url) {
        console.warn(`  [${view}] no fullBody Tier-2 cell — skip`);
        continue;
      }

      // Build refs (mirrors matrix-paint.ts ByteDance v1 pattern)
      const refs: SeedreamReferenceImage[] = [];
      if (isBack) {
        if (!fm.back) { console.warn(`  [${view}] no fm.back — skip`); continue; }
        const back45L = fm.back45Left || fm.back;
        const back45R = fm.back45Right || fm.back;
        refs.push({ url: cleanUrl(tier2Url),       label: BASE_LABEL_M02_FULLBODY });
        refs.push({ url: cleanUrl(fm.back),        label: GARMENT_LABEL_M02 });
        refs.push({ url: cleanUrl(back45L),        label: GARMENT_LABEL_M02 });
        refs.push({ url: cleanUrl(back45R),        label: GARMENT_LABEL_M02 });
        if (layeringRefClean) refs.push({ url: layeringRefClean, label: LAYERING_LABEL });
        refs.push({ url: cleanUrl(tier2Url),       label: '' }); // silent anchor
      } else {
        if (!fm.front) { console.warn(`  [${view}] no fm.front — skip`); continue; }
        if (!normalized.flatFrontUrl) { console.warn(`  [${view}] no flatFrontUrl — skip`); continue; }
        const front45L = fm.front45Left || fm.front;
        const front45R = fm.front45Right || fm.front;
        refs.push({ url: cleanUrl(tier2Url),                  label: BASE_LABEL_M01_FULLBODY });
        refs.push({ url: cleanUrl(fm.front),                  label: GARMENT_LABEL_M01 });
        refs.push({ url: cleanUrl(front45L),                  label: GARMENT_LABEL_M01 });
        refs.push({ url: cleanUrl(front45R),                  label: GARMENT_LABEL_M01 });
        refs.push({ url: cleanUrl(normalized.flatFrontUrl),   label: FLAT_LABEL_M01 });
        refs.push({ url: cleanUrl(tier2Url),                  label: '' }); // silent anchor
      }

      // Build prompt — inline-builder, isFullBody=true (this is the prompt used by the
      // existing top-focus path; handles full-body framing + sports-bra preservation).
      const bottomSilhouette = isBack
        ? ((bottom.silhouetteBack as string) || (bottom.silhouetteFront as string) || '')
        : ((bottom.silhouetteFront as string) || (bottom.silhouetteBack as string) || '');
      const promptText = buildBottomPaintPromptInline(
        view as 'M01' | 'M02',
        true, // isFullBody
        bottomName,
        bottomDescription,
        bottomSilhouette,
        shoeName,
        shoeDescription,
      );

      // ── Stage 1: Seedream paints pants on fullBody base
      try {
        const t1 = Date.now();
        const seedreamResult = await generateSeedreamImage({
          prompt: promptText,
          referenceImages: refs,
          aspectRatio: '1:1',
          forceInventory: true,
        });
        const seedreamBuf = seedreamResult.imageData;
        const dt1 = ((Date.now() - t1) / 1000).toFixed(1);
        const seedreamPath = path.join(OUT_DIR, `run${i}_${view}_1_seedream_fullbody.png`);
        fs.writeFileSync(seedreamPath, seedreamBuf);
        console.log(`  [${view}] seedream  ${dt1}s — ${(seedreamBuf.length / 1024).toFixed(0)}KB → run${i}_${view}_1_seedream_fullbody.png`);

        // ── Stage 2: Gemini paints top
        if (!topId) {
          console.log(`  [${view}] gemini SKIPPED — no top in wardrobe`);
          continue;
        }
        const t2 = Date.now();
        const geminiResult = await geminiPaintTop({
          pass1Buffer: seedreamBuf,
          wardrobe,
          shotType: view as 'M01' | 'M02',
        });
        const dt2 = ((Date.now() - t2) / 1000).toFixed(1);
        if (!geminiResult.edited) {
          console.warn(`  [${view}] gemini SKIPPED — ${geminiResult.error || 'unknown'}`);
          continue;
        }
        const geminiPath = path.join(OUT_DIR, `run${i}_${view}_2_gemini_full.png`);
        fs.writeFileSync(geminiPath, geminiResult.imageData);
        console.log(`  [${view}] gemini    ${dt2}s — ${(geminiResult.imageData.length / 1024).toFixed(0)}KB → run${i}_${view}_2_gemini_full.png`);
      } catch (e) {
        console.error(`  [${view}] FAIL: ${(e as Error).message}`);
      }
    }
  }

  console.log(`\n✓ Test complete. Open ${OUT_DIR}`);
  console.log(`\nFor each (run × view), compare:`);
  console.log(`  run{N}_{M01|M02}_1_seedream_fullbody.png — Seedream pass-1 (full body, sports bra + correct pants)`);
  console.log(`  run{N}_{M01|M02}_2_gemini_full.png       — Gemini pass-2 (sports bra REPLACED with the wardrobe top)`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
