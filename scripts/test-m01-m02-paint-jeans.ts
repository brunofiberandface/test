/**
 * Step 2 of native M01/M02 at 4K: Seedream paints the focus jeans over the
 * hot pants placeholder from Step 1, preserving everything else (identity,
 * skin tone, shoes, pose, feet direction).
 *
 * Requires Step 1 outputs to already exist locally:
 *   test_outputs/m01-m02-native/<jobId>/m01_step1_model_shoes.png
 *   test_outputs/m01-m02-native/<jobId>/m02_step1_model_shoes.png
 *
 * Ref hierarchy (per lessons from V2-V3 predressed pipeline iteration):
 *   slot 1 — GARMENT FLAT FRONT/BACK    (strongest jeans signal)
 *   slot 2-4 — FIT MODEL angles          (silhouette / fit profile authority)
 *   slot 5 — PRIMARY REFERENCE (Step 1)  (upper preservation only)
 *
 * Usage: npx tsx scripts/test-m01-m02-paint-jeans.ts <jobId>
 *
 * Outputs in test_outputs/m01-m02-native/<jobId>/:
 *   m01_step2_with_jeans.png — M01 with focus jeans painted (final candidate)
 *   m02_step2_with_jeans.png — M02 with focus jeans painted (final candidate)
 *
 * Cost: ~$0.08 per run (2 × Seedream calls at 4K).
 */
import * as fs from 'fs';
import * as path from 'path';

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
import { generateSeedreamImage, type SeedreamReferenceImage } from '../src/lib/pipeline/seedream-client';
import { ensureSeedreamSafeUrl } from '../src/lib/pipeline/seedream-image-safe';
import { uploadGeneratedImage } from '../src/lib/gcs';
import type { JobWardrobe } from '../src/types';
import * as crypto from 'crypto';

/**
 * Crop a fit-model image to just the leg region (vertical 25%-95%) so
 * Seedream sees it as a garment-on-leg fragment, not a full subject. This
 * is the same trick production M05 uses (see cropAndCacheRef in
 * seedream-generate.ts) — multi-subject collage failure mode is reduced
 * when refs don't show full bodies. Cached to GCS at a content-addressed
 * path so re-runs hit the cache.
 */
async function cropFitModelToLegs(sourceUrl: string): Promise<string> {
  const sharp = (await import('sharp')).default;
  const { Storage } = await import('@google-cloud/storage');
  const clean = sourceUrl.split('?')[0];
  const fromPct = 0.25, toPct = 0.95;  // upper thigh to ankle
  const key = crypto.createHash('sha1').update(`${clean}|${fromPct}|${toPct}|legs`).digest('hex');
  const gcsPath = `cropped-refs/${key}.jpg`;
  const publicUrl = `https://storage.googleapis.com/gstar-ai-studio-assets/${gcsPath}`;
  const storage = new Storage();
  const bucket = storage.bucket('gstar-ai-studio-assets');
  const file = bucket.file(gcsPath);
  const [exists] = await file.exists();
  if (exists) return publicUrl;
  const resp = await fetch(clean);
  if (!resp.ok) throw new Error(`fetch ${clean} → ${resp.status}`);
  const srcBuf = Buffer.from(await resp.arrayBuffer());
  const img = sharp(srcBuf);
  const meta = await img.metadata();
  const w = meta.width!, h = meta.height!;
  const top = Math.round(h * fromPct);
  const cropH = Math.round(h * (toPct - fromPct));
  const croppedBuf = await img
    .extract({ left: 0, top, width: w, height: cropH })
    .jpeg({ quality: 90 })
    .toBuffer();
  await file.save(croppedBuf, {
    metadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
  });
  console.log(`  Cropped fit-model: ${w}x${h} → ${w}x${cropH} (legs only) → ${publicUrl}`);
  return publicUrl;
}

const jobId = process.argv[2];
if (!jobId) { console.error('Usage: npx tsx scripts/test-m01-m02-paint-jeans.ts <jobId>'); process.exit(1); }

const OUT_DIR = path.join(projectRoot, 'test_outputs', 'm01-m02-native', jobId);

interface WardrobeItemLike {
  name?: string;
  flatFrontUrl?: string;
  flatBackUrl?: string;
  fitModels?: Record<string, string>;
  bottomDescription?: string;
  description?: string;
}

async function paintJeans(
  view: 'front' | 'back',
  step1LocalPath: string,
  bottom: WardrobeItemLike,
  outName: string,
): Promise<void> {
  console.log(`\n=== ${view.toUpperCase()} — Step 2: Seedream generates M01/M02 with focus jeans ===`);
  const t0 = Date.now();

  // Upload Step 1 base to GCS so Seedream can reference it by URL.
  const step1Buf = fs.readFileSync(step1LocalPath);
  console.log(`  Step 1 base: ${(step1Buf.length / 1024 / 1024).toFixed(1)} MB`);
  const step1Url = await uploadGeneratedImage(
    `_test/m01-m02-paint-jeans/${jobId}`,
    `step1_${view}_${Date.now()}.png`,
    step1Buf,
  );
  console.log(`  Step 1 uploaded: ${step1Url}`);

  // Pull jeans refs for this view
  const flatUrl = view === 'front'
    ? (bottom.flatFrontUrl || bottom.flatBackUrl)
    : (bottom.flatBackUrl || bottom.flatFrontUrl);
  if (!flatUrl) throw new Error(`No bottom flat for view=${view}`);

  // Use 1 fit-model angle (head-on view) — multi-fit-model refs in v1+v2
  // caused Seedream to render multiple subjects in a side-by-side collage.
  // Even with 2 angles + strong "ONE MODEL" prompt language, the collage
  // persisted. v3 fix: cropping the fit-model to legs-only (no head, no
  // upper body) makes the ref look like a "pants-on-leg" fragment instead
  // of a full subject candidate. Same technique production M05 uses for
  // its fit-model refs.
  const angleKey = view === 'front' ? 'front' : 'back';
  const rawFitAngle = bottom.fitModels?.[angleKey];
  const fitAngles: string[] = [];
  if (rawFitAngle) {
    const croppedUrl = await cropFitModelToLegs(rawFitAngle);
    fitAngles.push(croppedUrl);
  }
  console.log(`  Jeans refs: flat ${flatUrl ? '✓' : '✗'} + ${fitAngles.length} cropped fit angle`);

  const bottomDesc = bottom.bottomDescription || bottom.description || bottom.name || 'jeans';

  // Refs ordered for Seedream's "fresh generation with anchors" pattern (same
  // as production M03 / M04): identity-anchor first, then garment refs.
  //
  // Key shift from v1: Step 1 base now acts as a "WAIST-DOWN MODEL CARD" — an
  // identity + stance + shoes anchor (same role MODEL CARD plays in production
  // M03). We're NOT asking Seedream to edit Step 1; we're asking it to
  // generate a fresh M01/M02 using Step 1 as the identity/stance anchor and
  // the jeans refs as garment authority. Same pattern that works in M03.
  const refs: SeedreamReferenceImage[] = [];

  refs.push({
    url: await ensureSeedreamSafeUrl(step1Url.split('?')[0]),
    label: `WAIST-DOWN ANCHOR (slot 1 — exclusive source for identity, stance, shoes, framing) — this image shows the EXACT model identity (skin tone, body, arms, hands) and EXACT pose / stance (bilateral, both feet pointing straight ahead parallel to camera axis, ~one foot-width gap between feet, weight 50/50, hands hanging at sides visible at top of frame near waistband) and EXACT shoes (preserve precisely — same shape, color, material, ${view === 'front' ? 'toe shape and any strap details' : 'heel and back details'}) and EXACT 1:1 waist-down framing. The HOT PANTS visible here are a placeholder — replace them in the output with the focus jeans from slot 2 + fit model angles. Everything ELSE in this image is the canonical render target.`,
  });

  refs.push({
    url: await ensureSeedreamSafeUrl(flatUrl.split('?')[0]),
    label: `GARMENT FLAT ${view.toUpperCase()} (slot 2 — exclusive jeans authority) — the focus jeans the model wears in the output. Match this flat EXACTLY: color, wash, fading pattern, fabric weave, hardware (button fly vs zip, rivet count and placement, coin pocket presence, brand patches), pocket geometry, hem treatment, stitch color.`,
  });

  for (let i = 0; i < fitAngles.length; i++) {
    refs.push({
      url: await ensureSeedreamSafeUrl(fitAngles[i].split('?')[0]),
      label: `JEANS-ON-LEGS FRAGMENT (slot ${3 + i} — leg-only crop, NOT a subject) — this is a CROPPED LEG-ONLY image showing the focus jeans worn on a leg fragment (head and upper body removed). It is NOT a person to render in the output — it is a garment-fit fragment used solely for measuring the jeans' fit profile and leg width. Source for: jeans leg silhouette, leg WIDTH (match this width precisely — do NOT narrow), drape, hem-to-floor interaction. The body and skin in this fragment is irrelevant — the rendered output uses the WAIST-DOWN ANCHOR (slot 1) for identity, skin, and body. DO NOT add this fragment as a second subject to the output.`,
    });
  }

  console.log(`  Built ${refs.length} refs`);

  const PROMPT = `Photorealistic studio e-commerce photograph, 1:1 SQUARE crop, ${view.toUpperCase()} VIEW. Waist-down crop of the fashion model shown in WAIST-DOWN ANCHOR (slot 1), wearing the focus jeans from GARMENT FLAT (slot 2) + FIT MODEL angles. Clean light-grey studio backdrop. Soft diffused 5500K lighting. Sharp focus, ultra-high detail.

═══ ONE MODEL ONLY, ONE VIEW ONLY — STRICT ═══
The output is a SINGLE rendered image of ONE model in ONE pose, ${view === 'front' ? 'facing the camera (front view)' : 'facing away from the camera (back view)'}. Do NOT render multiple models side-by-side. Do NOT render multiple poses. Do NOT collage the references — they are references, not subjects.

═══ FRAMING — IDENTICAL TO SLOT 1 ANCHOR ═══
Match the 1:1 square waist-down framing shown in WAIST-DOWN ANCHOR exactly:
- TOP of frame: ~5-10% above the hipbone — thin band of bare midriff + top edge of waistband + hands at sides visible.
- BOTTOM of frame: floor with shoes fully visible + small floor margin below heels.
- NO head, NO shoulders, NO upper body.
- Subject centered horizontally.

═══ IDENTITY + POSE + SHOES — FROM WAIST-DOWN ANCHOR (slot 1) ONLY ═══
- SKIN TONE: render the model's exact complexion as shown in WAIST-DOWN ANCHOR — the visible midriff sliver at top of frame, hands, and arms have the SAME skin tone as in slot 1. If the anchor shows dark / deep / brown skin, render dark / deep / brown skin. Do NOT shift toward generic "fashion model" complexion.
- HANDS + ARMS: hanging straight at the sides of the body, hands visible at the top edge of the frame near the waistband (same position as in WAIST-DOWN ANCHOR). Wrists relaxed, fingers loose.
- POSE: bilateral. Both legs drop STRAIGHT DOWN from hip to floor — NO outward angle, NO splay, NO V-shape. Weight 50/50 across both feet. Hips centered and level. No hip tilt, no contrapposto.
- FEET DIRECTION: both feet point STRAIGHT AHEAD in the same direction — parallel to the camera axis (${view === 'front' ? 'toes toward the camera' : 'heels toward the camera'}). NO outward V-shape, NO inward pigeon-toe. Both feet identical direction.
- GAP between feet: approximately ONE FOOT-WIDTH (~10cm) — the gap equals the WIDTH of one shoe, NOT the length.
- SHOES: render the EXACT footwear shown in WAIST-DOWN ANCHOR. Same shape, color, material, sole construction, ${view === 'front' ? 'toe shape, any strap or slingback details' : 'heel shape, back-of-shoe details'}. Do not invent buckles, do not change toe shape, do not alter heel height.
- BACKDROP / LIGHTING: clean light-grey studio sweep (#D9DAD2). Soft diffused 5500K. Soft contact shadow under the feet.

═══ JEANS — FROM SLOT 2 + FIT MODEL ANGLES ONLY ═══
The model wears the focus jeans shown in GARMENT FLAT (slot 2) and the FIT MODEL angles:
- COLOR / WASH: match the flat exactly. NO sheen, NO satin, NO magenta or pink cast. Matte cotton denim.
- FIT PROFILE / SILHOUETTE / LEG WIDTH: match the FIT MODEL angles EXACTLY. If they show wide / barrel / flared / relaxed legs, render that EXACT width. Do NOT narrow the jeans to match a slim bare-leg silhouette — the jeans have their own silhouette from the FIT MODEL refs.
- HARDWARE: button fly vs zip fly, rivet count and placement, coin-pocket, brand patches — all as shown in the flat.
- HEM TREATMENT: rolled / cuffed / raw / straight — match the flat exactly.
- LENGTH: full-length from waistband to floor (covering the legs that were bare in WAIST-DOWN ANCHOR).
- WAISTBAND: sits at the same hipbone position as the hot pants in WAIST-DOWN ANCHOR.

Jeans description (reinforcement): ${bottomDesc}.

═══ FAILURE MODES — ABSOLUTELY WRONG ═══
- WRONG: multiple models in the output (no side-by-side collage, no double-rendering of front+back). ONE model, ONE view, ${view === 'front' ? 'FRONT' : 'BACK'} only.
- WRONG: hot pants visible anywhere — placeholder must be entirely replaced by full-length jeans from waistband to floor.
- WRONG: bare legs visible between the waistband and the shoes.
- WRONG: jean silhouette narrower than FIT MODEL angles show.
- WRONG: skin tone differing from WAIST-DOWN ANCHOR — keep exact complexion.
- WRONG: shoes differing from WAIST-DOWN ANCHOR.
- WRONG: hands re-rendered, repositioned, or cropped.
- WRONG: feet in V-shape or pigeon-toe. Both feet point straight ahead.
- WRONG: framing change — keep the 1:1 waist-down crop from the anchor.
- WRONG: ${view === 'front' ? 'BACK-pocket details visible (this is the FRONT view — show fly, front pockets, no back pockets)' : 'FRONT-of-jeans details visible (this is the BACK view — show back pockets, yoke, brand patch position; no fly)'}.`;

  const result = await generateSeedreamImage({
    prompt: PROMPT,
    referenceImages: refs,
    aspectRatio: '1:1',
  });
  console.log(`  ✓ ${view} done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.imageData.length} bytes`);
  fs.writeFileSync(path.join(OUT_DIR, outName), result.imageData);
}

async function main() {
  // Verify Step 1 outputs exist
  const m01Step1Path = path.join(OUT_DIR, 'm01_step1_model_shoes.png');
  const m02Step1Path = path.join(OUT_DIR, 'm02_step1_model_shoes.png');
  if (!fs.existsSync(m01Step1Path)) throw new Error(`Step 1 M01 missing: ${m01Step1Path}\nRun scripts/test-m01-m02-native.ts first.`);
  if (!fs.existsSync(m02Step1Path)) throw new Error(`Step 1 M02 missing: ${m02Step1Path}\nRun scripts/test-m01-m02-native.ts first.`);

  // Pull job + bottom item
  const db = new Firestore();
  const jobSnap = await db.collection('jobs').doc(jobId).get();
  if (!jobSnap.exists) throw new Error(`Job ${jobId} not found`);
  const job = jobSnap.data() as { wardrobe: JobWardrobe; modelId: string };
  const bottomCfg = job.wardrobe['bottom'];
  if (!bottomCfg?.itemId) throw new Error(`Job ${jobId} has no bottom in wardrobe`);
  const bottomSnap = await db.collection('wardrobe').doc(bottomCfg.itemId).get();
  const bottom = bottomSnap.data() as WardrobeItemLike;
  console.log(`Bottom: ${bottom.name}`);

  // Run M01 + M02 jeans painting in parallel
  await Promise.all([
    paintJeans('front', m01Step1Path, bottom, 'm01_step2_with_jeans.png'),
    paintJeans('back', m02Step1Path, bottom, 'm02_step2_with_jeans.png'),
  ]);

  console.log(`\n────────────────────────────────────────`);
  console.log(`DONE. Compare in: ${OUT_DIR}`);
  console.log(`  m01_step1_model_shoes.png   — Step 1 base (model + hot pants + shoes)`);
  console.log(`  m01_step2_with_jeans.png    — Step 2: jeans painted (final M01 candidate)`);
  console.log(`  m02_step1_model_shoes.png   — Step 1 base (back view)`);
  console.log(`  m02_step2_with_jeans.png    — Step 2: jeans painted (final M02 candidate)`);
  console.log(`  m01_2k_reference.png        — current production M01 (for visual comparison)`);
  console.log(`  m02_2k_reference.png        — current production M02 (for visual comparison)`);
  console.log(`────────────────────────────────────────`);
}

main().catch(e => { console.error(e); process.exit(1); });
