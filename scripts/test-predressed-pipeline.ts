/**
 * Local test: pre-dressed → Seedream pipeline (Bruno's architectural flip).
 *
 * The hypothesis: instead of letting Seedream render model + sports-bra
 * placeholder + jeans + shoes in one shot (low-fidelity body) and then
 * having Gemini tee-edit paint the real top over the bra, FLIP the order:
 *
 *   Pass 1 — Gemini-3-pro-image-preview generates the model wearing the
 *            REAL top tucked into a BLACK HOT PANTS placeholder, plus the
 *            real shoes. Gemini does this beautifully: high-fidelity
 *            top, strong identity preservation via MODEL CARD + head
 *            crop refs, and the tuck is STRUCTURAL (the top really sits
 *            inside the hot pants waistband, not painted to look tucked).
 *
 *   Pass 2 — Seedream takes the pre-dressed image as the primary anchor
 *            + the focus jeans flat + fit-model angles, and renders the
 *            same scene with the hot pants REPLACED by the jeans. The
 *            top's tuck transfers naturally because the source image
 *            already shows it tucked at the hipbone (where the jeans
 *            waistband will sit).
 *
 * Usage:
 *   npx tsx scripts/test-predressed-pipeline.ts <jobId>
 *
 * Outputs land in test_outputs/predressed/<jobId>/:
 *   - 1_predressed.png       (Gemini Pass 1 — model + top + hot pants + shoes)
 *   - 2_seedream_with_jeans.png (Seedream Pass 2 — jeans painted over hot pants)
 *   - reference_m03.png      (existing M03 from the job, for visual comparison)
 *
 * Costs: ~$0.04 (Gemini Pass 1) + ~$0.04 (Seedream Pass 2) per job.
 *
 * NOT integrated into the production pipeline yet — this is a feasibility
 * test on one job. If the output is clearly better than the existing M03,
 * we wire it in afterward.
 */
import * as fs from 'fs';
import * as path from 'path';

// ── Bootstrap env + creds (mirrors scripts/replay-m05.ts pattern) ───────────
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
import { generateImage, type ReferenceImage } from '../src/lib/vertex';
import { generateSeedreamImage, type SeedreamReferenceImage } from '../src/lib/pipeline/seedream-client';
import { ensureSeedreamSafeUrl } from '../src/lib/pipeline/seedream-image-safe';
import { buildIdentityHeadCrop } from '../src/lib/pipeline/identity-head-crop';

const jobId = process.argv[2];
if (!jobId) {
  console.error('Usage: npx tsx scripts/test-predressed-pipeline.ts <jobId>');
  process.exit(1);
}

const OUT_DIR = path.join(projectRoot, 'test_outputs', 'predressed', jobId);
fs.mkdirSync(OUT_DIR, { recursive: true });

const STUDIO_BACKDROP_URL = 'https://storage.googleapis.com/gstar-ai-studio-assets/backdrops/clean-studio-grey.jpg';

async function fetchBuf(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  return { buffer: Buffer.from(await r.arrayBuffer()), mimeType: r.headers.get('content-type') || 'image/jpeg' };
}

interface JobLike {
  jobId: string;
  wardrobe: Record<string, { itemId: string; isFocus?: boolean }>;
  modelId: string;
}

interface WardrobeItemLike {
  flatFrontUrl?: string;
  flatBackUrl?: string;
  fitModels?: Record<string, string>;
  fitModelUrls?: string[];
  name?: string;
  topDescription?: string;
  shoesDescription?: string;
  description?: string;
}

interface ModelLike {
  referenceImageUrl?: string;
  cardImageUrl?: string;
  backReferenceImageUrl?: string;
  gender?: string;
  description?: string;
}

async function main() {
  const db = new Firestore();

  // ── 1. Pull job data ──
  const jobSnap = await db.collection('jobs').doc(jobId).get();
  if (!jobSnap.exists) throw new Error(`Job ${jobId} not found`);
  const job = jobSnap.data() as JobLike;
  console.log(`Job ${jobId}: wardrobe=${Object.keys(job.wardrobe).join(',')} model=${job.modelId}`);

  // ── 2. Pull model ──
  const modelSnap = await db.collection('models').doc(job.modelId).get();
  if (!modelSnap.exists) throw new Error(`Model ${job.modelId} not found`);
  const model = modelSnap.data() as ModelLike;
  const modelRefUrl = model.referenceImageUrl || model.cardImageUrl;
  if (!modelRefUrl) throw new Error(`Model ${job.modelId} has no card image`);

  // ── 3. Pull wardrobe items (top + bottom + shoe) ──
  const topCfg = job.wardrobe['top'];
  const bottomCfg = job.wardrobe['bottom'];
  const shoeCfg = job.wardrobe['shoe'];
  if (!topCfg?.itemId) throw new Error(`Job ${jobId} has no top in wardrobe`);
  if (!bottomCfg?.itemId) throw new Error(`Job ${jobId} has no bottom in wardrobe`);

  const [topSnap, bottomSnap, shoeSnap] = await Promise.all([
    db.collection('wardrobe').doc(topCfg.itemId).get(),
    db.collection('wardrobe').doc(bottomCfg.itemId).get(),
    shoeCfg?.itemId ? db.collection('wardrobe').doc(shoeCfg.itemId).get() : Promise.resolve(null),
  ]);
  const top = topSnap.data() as WardrobeItemLike;
  const bottom = bottomSnap.data() as WardrobeItemLike;
  const shoe = shoeSnap?.data() as WardrobeItemLike | undefined;

  const topFitAngles = [
    top.fitModels?.front,
    top.fitModels?.front45Left,
    top.fitModels?.front45Right,
  ].filter((u): u is string => typeof u === 'string' && u.length > 0).slice(0, 3);

  const bottomFitAngles = [
    bottom.fitModels?.front,
    bottom.fitModels?.front45Left,
    bottom.fitModels?.front45Right,
  ].filter((u): u is string => typeof u === 'string' && u.length > 0).slice(0, 3);

  console.log(`Top: ${top.name} (${top.flatFrontUrl ? 'flat ✓' : 'flat ✗'}, ${topFitAngles.length} angles)`);
  console.log(`Bottom: ${bottom.name} (${bottom.flatFrontUrl ? 'flat ✓' : 'flat ✗'}, ${bottomFitAngles.length} angles)`);
  console.log(`Shoe: ${shoe?.name || '(none)'} (${shoe?.flatFrontUrl ? 'flat ✓' : 'flat ✗'})`);

  // ── 4. Fetch existing M03 from this job for visual comparison ──
  const shotsSnap = await db.collection('shots')
    .where('jobId', '==', jobId)
    .where('shotType', '==', 'M03')
    .get();
  const m03Doc = shotsSnap.docs[0];
  if (m03Doc) {
    const m03 = m03Doc.data() as { imageUrl?: string };
    if (m03.imageUrl) {
      const buf = await fetchBuf(m03.imageUrl);
      fs.writeFileSync(path.join(OUT_DIR, 'reference_m03.png'), buf.buffer);
      console.log(`✓ Saved reference M03 (${(buf.buffer.length / 1024).toFixed(0)} KB)`);
    }
  }

  // Shared vars used by BOTH Pass 1 (when fresh) and Pass 2 (always). Hoisted
  // here so the cache branch can skip Pass 1's body without leaving these
  // undefined for Pass 2's prompt.
  const modelGender = model.gender || 'female';

  // ─────────────────────────────────────────────────────────────────────────
  // PASS 1: Gemini pre-dresses the model
  // ─────────────────────────────────────────────────────────────────────────
  // Idempotent: if test_outputs/predressed/<jobId>/1_predressed.png already
  // exists locally, reuse it (re-upload to GCS and skip the Gemini call).
  // Lets Bruno iterate on Pass 2 prompts without re-paying the 130s + $0.04
  // for Pass 1 each time. Delete the local file to force a fresh Pass 1.
  const pass1LocalPath = path.join(OUT_DIR, '1_predressed.png');
  let pass1Url: string;
  if (fs.existsSync(pass1LocalPath)) {
    console.log('\n=== PASS 1: REUSING existing 1_predressed.png (delete to regenerate) ===');
    const cachedBuf = fs.readFileSync(pass1LocalPath);
    console.log(`✓ Loaded ${(cachedBuf.length / 1024 / 1024).toFixed(1)} MB from local cache`);
    const { uploadGeneratedImage: uploadCached } = await import('../src/lib/gcs');
    pass1Url = await uploadCached(
      `_test/predressed/${jobId}`,
      `1_predressed_${Date.now()}.png`,
      cachedBuf,
    );
    console.log(`✓ Re-uploaded to GCS for Seedream: ${pass1Url}`);
  } else {
  console.log('\n=== PASS 1: Gemini pre-dress (model + top + hot pants + shoes) ===');
  const t1 = Date.now();

  const modelCardBuf = (await fetchBuf(modelRefUrl)).buffer;
  let identityHeadCropBuf: Buffer | null = null;
  try {
    identityHeadCropBuf = await buildIdentityHeadCrop(modelCardBuf);
  } catch (e) {
    console.warn(`Identity head crop failed (non-blocking):`, (e as Error).message);
  }

  const geminiRefs: ReferenceImage[] = [];

  // IMAGE 1: backdrop
  const backdropBuf = await fetchBuf(STUDIO_BACKDROP_URL);
  geminiRefs.push({
    buffer: backdropBuf.buffer,
    mimeType: backdropBuf.mimeType,
    label: 'IMAGE 1 — STUDIO BACKDROP. Clean light-grey studio sweep. Use for backdrop appearance only. NOT for pose, identity, or garments.',
  });

  // IMAGE 2: model card (full body identity)
  geminiRefs.push({
    buffer: modelCardBuf,
    mimeType: 'image/jpeg',
    label: 'IMAGE 2 — MODEL IDENTITY (full body). The rendered model is the SAME PERSON as in IMAGE 2 — exact same skin tone, hair, facial features, body proportions. The pose, garments, and background in this image are NOT used for the render.',
  });

  // IMAGE 2B: identity head crop (face/skin anchor)
  if (identityHeadCropBuf) {
    geminiRefs.push({
      buffer: identityHeadCropBuf,
      mimeType: 'image/png',
      label: 'IMAGE 2B — IDENTITY ANCHOR (head + shoulders crop). Same person as IMAGE 2 — face, hair, skin tone must match exactly.',
    });
  }

  // IMAGE 3: top flat front
  if (top.flatFrontUrl) {
    const topFlatBuf = await fetchBuf(top.flatFrontUrl);
    geminiRefs.push({
      buffer: topFlatBuf.buffer,
      mimeType: topFlatBuf.mimeType,
      label: `IMAGE 3 — TOP FLAT (FRONT) — the HERO TOP the rendered model wears. Match this top EXACTLY: color, fabric, neckline/collar, sleeves, hem position, hardware, branding details.`,
    });
  }

  // IMAGE 4+: top fit model angles
  for (let i = 0; i < topFitAngles.length; i++) {
    const a = await fetchBuf(topFitAngles[i]);
    geminiRefs.push({
      buffer: a.buffer,
      mimeType: a.mimeType,
      label: `IMAGE ${4 + i} — TOP FIT MODEL ANGLE ${i + 1}. Source for the top's fit, drape, shoulder fit, sleeve length on body. Pose, identity, bottoms, shoes are NOT used.`,
    });
  }

  // IMAGE for shoes
  let shoeRefIndex = 4 + topFitAngles.length;
  if (shoe?.flatFrontUrl) {
    const shoeBuf = await fetchBuf(shoe.flatFrontUrl);
    geminiRefs.push({
      buffer: shoeBuf.buffer,
      mimeType: shoeBuf.mimeType,
      label: `IMAGE ${shoeRefIndex} — SHOE REFERENCE. The footwear the rendered model wears. Match shape, color, material, sole construction exactly.`,
    });
    shoeRefIndex++;
  }

  const topDescription = top.topDescription || top.description || top.name || 'top';
  const shoeDescription = shoe?.shoesDescription || shoe?.description || shoe?.name || 'simple low-heel shoes';
  const modelDesc = (model.description || '').split('\n')[0].slice(0, 280);

  const PRE_DRESS_PROMPT = `Photorealistic studio e-commerce photograph, 9:16 aspect, full body FRONT view. ${modelGender === 'male' ? 'Male' : 'Female'} fashion model standing on a clean light-grey studio backdrop. Soft diffused 5500K studio lighting. Sharp focus, ultra-high detail.

═══ FRAMING ═══
FULL BODY head-to-toe. Top of head ~8-12% from frame top edge with clear background above. Heels ~5-8% from frame bottom edge with clear floor below. Subject centered horizontally.

═══ IDENTITY (from IMAGE 2 + IMAGE 2B only) ═══
The rendered model is the SAME PERSON as in IMAGE 2 and IMAGE 2B — a ${modelGender} model${modelDesc ? ` with: ${modelDesc}` : ''}. Exact same skin tone with undertone, complexion, hair color and length and texture, facial features (eye shape/color, nose, mouth, brow), body proportions, height. Render the model identically — do NOT modify facial features, do NOT change hair, do NOT shift skin tone.

═══ POSE ═══
Bilaterally symmetric. Body squared to camera. Both feet flat on floor at shoulder-width stance with approximately ONE FOOT-WIDTH of clear space between the inner edges of the feet (~10cm gap). Weight 50/50 across both feet. Both legs drop straight down from hip to floor. Arms hang relaxed at the sides with a small natural gap from the torso. Hands relaxed, fingers soft. NO hip tilt, NO contrapposto.

═══ TOP — THE HERO GARMENT (from IMAGE 3 + IMAGE 4+) ═══
The model's UPPER BODY wears the TOP shown in IMAGE 3 (FLAT FRONT) and IMAGE 4+ (FIT MODEL ANGLES). Render with MAXIMUM fidelity.

Top description (reinforcement): ${topDescription}

Match exactly: color, fabric, neckline/collar, sleeves, hem position on body, fit profile, hardware (buttons/zippers), any branding.

CRITICAL — TUCK behavior: the bottom hem of the top is TUCKED INTO the BLACK HOT PANTS waistband below. The front of the top sits smooth and flat against the body with the hem passing UNDER the hot pants waistband — there is NO loose untucked overhang, NO bunching at the front, NO drape below the waistband. From the side and back the same tuck applies. The top is genuinely tucked inside the hot pants, not painted to look tucked.

═══ BOTTOM — PLACEHOLDER (hot pants — will be replaced) ═══
The model wears plain MATTE BLACK HIGH-WAISTED HOT PANTS (booty shorts). The waistband sits at the hipbone, ~3-5cm below the navel. Plain flat 2cm waistband, plain leg openings just above the upper thigh. NO logos, NO mesh, NO piping, NO sheen, NO color other than matte black, NO denim wash — this is a smooth clean cotton-jersey hot pant.

These hot pants are a placeholder — in a downstream step they will be replaced with full-length jeans. Render them cleanly so the waistband line is unambiguous (where the top tucks IN, and where the future jeans waistband will sit).

═══ FOOTWEAR (from SHOE REFERENCE) ═══
${shoe?.flatFrontUrl ? `Match SHOE REFERENCE (IMAGE ${shoeRefIndex - 1}) exactly — shape, color, material, sole construction.` : `Plain simple low-heel shoes: matte black, clean construction, no logos.`}
Shoe description: ${shoeDescription}.

═══ STUDIO ═══
Clean light-grey studio sweep, no scuffs, no texture. Soft contact shadow under the feet. Soft diffused 5500K lighting, even illumination.

═══ FAILURE MODES — ABSOLUTELY WRONG ═══
- WRONG: a different model identity than IMAGE 2 + IMAGE 2B (any face/skin/hair mismatch).
- WRONG: the top NOT tucked, hanging loose over the waistband.
- WRONG: hot pants with logos, mesh, color, or any pattern other than matte black.
- WRONG: rendering jeans / pants / shorts instead of hot pants (these are a clean tucking placeholder).
- WRONG: any garment between the hot pants and shoes (bare legs from hot pants down to ankles).
- WRONG: head, feet, or any body part cropped at the frame edges.`;

  console.log(`Calling Gemini-3-pro-image-preview with ${geminiRefs.length} refs...`);
  const pass1 = await generateImage({
    prompt: PRE_DRESS_PROMPT,
    referenceImages: geminiRefs,
    aspectRatio: '9:16',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  console.log(`✓ Pass 1 done in ${((Date.now() - t1) / 1000).toFixed(1)}s (${pass1.imageData.length} bytes)`);
  const pass1Path = path.join(OUT_DIR, '1_predressed.png');
  fs.writeFileSync(pass1Path, pass1.imageData);

  // Upload Pass 1 to GCS so Seedream can reference it by URL (BytePlus accepts
  // URLs only, not raw buffers). Use a temp/debug path.
  console.log('\nUploading Pass 1 to GCS so Seedream can reference it...');
  const { uploadGeneratedImage } = await import('../src/lib/gcs');
  pass1Url = await uploadGeneratedImage(
    `_test/predressed/${jobId}`,
    `1_predressed_${Date.now()}.png`,
    pass1.imageData,
  );
  console.log(`✓ Pass 1 uploaded: ${pass1Url}`);
  } // end of fresh-Pass-1 else branch

  // ─────────────────────────────────────────────────────────────────────────
  // PASS 2: Seedream paints the focus jeans over the hot pants
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== PASS 2: Seedream paint jeans over hot pants ===');
  const t2 = Date.now();

  const seedreamRefs: SeedreamReferenceImage[] = [];

  // V2 ref order: GARMENT FLAT FRONT first (strongest visual signal for jeans
  // in Seedream's slot-1 position), then FIT MODEL angles, then PRIMARY
  // REFERENCE LAST. This counters the slot-1-dominance issue we saw in V1
  // (Seedream anchored too heavily on the pre-dressed image's hot pants
  // instead of the actual jeans).
  if (bottom.flatFrontUrl) {
    seedreamRefs.push({
      url: await ensureSeedreamSafeUrl(bottom.flatFrontUrl.split('?')[0]),
      label: 'GARMENT FLAT FRONT (slot 1 — primary jeans authority) — the EXCLUSIVE source of truth for the jeans rendered in the output. Match this flat pixel-for-pixel: exact color, wash, fading pattern, fabric weave, hardware (button fly vs zip, rivet count and placement, coin pocket presence), brand patches, hem treatment, pocket geometry, stitch color. The jeans in the rendered output are EXACTLY this garment — nothing else, no other denim. The PRIMARY REFERENCE in slot 5 shows BLACK HOT PANTS in the bottom half; those are a placeholder and are NOT the jeans to render.',
    });
  }
  for (let i = 0; i < bottomFitAngles.length; i++) {
    seedreamRefs.push({
      url: await ensureSeedreamSafeUrl(bottomFitAngles[i].split('?')[0]),
      label: `FIT MODEL FRONT ANGLE ${i + 1} (slot ${2 + i} — jeans on a body) — focus jeans worn by a fit model. Source for: jeans fit profile (slim/straight/relaxed/barrel), leg silhouette, drape, hem-to-floor interaction, length on body, how the jeans sit at the waistband. SKIN TONE, IDENTITY, FACE, HAIR, BACKDROP, POSE, TOP, SHOES are NOT taken from this image — those come from the PRIMARY REFERENCE in slot ${seedreamRefs.length + bottomFitAngles.length - i + 1}.`,
    });
  }

  // LAST: PRE-DRESSED MODEL (PRIMARY REFERENCE) — explicitly scoped to upper
  // body + identity + tuck behaviour. Below the waistband Seedream must
  // IGNORE this and use slots 1-N (GARMENT FLAT + FIT MODEL) instead.
  seedreamRefs.push({
    url: await ensureSeedreamSafeUrl(pass1Url.split('?')[0]),
    label: `PRE-DRESSED MODEL (PRIMARY REFERENCE, last slot — UPPER BODY ONLY) — authoritative source for: MODEL IDENTITY (face, skin tone with undertone, hair color/length/texture, body proportions), TOP GARMENT (color, fabric, neckline, sleeves, hem position, exact TUCK BEHAVIOUR at the waist — the top is genuinely tucked in this image, preserve that tuck in the output), SHOES (shape, color, material, sole), BACKDROP, LIGHTING, POSE / STANCE. CRITICAL — the BOTTOM HALF of this image (the BLACK HOT PANTS and the bare legs between hot pant hem and shoes) is NOT the rendered output. The output's bottom half (everything BELOW the waistband, including the waistband line itself) comes EXCLUSIVELY from the GARMENT FLAT FRONT (slot 1) and FIT MODEL FRONT ANGLES (slots 2-${1 + bottomFitAngles.length}). DO NOT render hot pants. DO NOT render bare legs between any hem and the shoes. The waistband in this image marks WHERE the jeans waistband will sit and WHERE the top tucks in — replace the visible hot pants with FULL-LENGTH JEANS from the GARMENT FLAT.`,
  });

  const SEEDREAM_PROMPT = `Photorealistic studio e-commerce photograph, 9:16 aspect, full body front view of a ${modelGender} fashion model on a clean light-grey studio backdrop. Soft diffused 5500K lighting.

═══ SOURCE OF TRUTH — STRICT SCOPING ═══
This render has TWO ref groups with NO overlap. CRITICAL: certain regions of PRIMARY
REFERENCE are PLACEHOLDER (hot pants + bare legs) and must be ENTIRELY IGNORED.

  GROUP A — JEANS (slots 1-${1 + bottomFitAngles.length}, GARMENT FLAT FRONT + FIT MODEL angles):
    EXCLUSIVE source of truth for everything BELOW the waistband — the waistband line itself,
    the jeans fabric and wash, hardware (fly, rivets, coin pocket, brand patches), pocket
    geometry, FIT PROFILE, LEG WIDTH, LEG SILHOUETTE, hem treatment, fabric drape, and length
    on body. If the FIT MODEL angles show a BARREL-LEG cut, render BARREL-LEG jeans. If they
    show WIDE-LEG, render WIDE-LEG. If they show SLIM, render SLIM. The bare legs visible in
    PRIMARY REFERENCE are NOT a hint about leg width — they are placeholder skin to be
    completely covered by the jeans.

  GROUP B — UPPER BODY (slot ${1 + bottomFitAngles.length + 1}, PRIMARY REFERENCE / pre-dressed model):
    EXCLUSIVE source of truth for everything ABOVE the waistband: model identity, face,
    skin tone, hair, the TOP GARMENT and its tuck behaviour. Plus the SHOES (visible below
    the placeholder), the studio backdrop, lighting, and the model's overall pose / stance.
    The hot pants and bare legs in this image are NOT used as references — they're masked
    out for the rendered output.

═══ TOP — PRESERVE TUCK EXACTLY FROM GROUP B ═══
The TOP in PRIMARY REFERENCE is fully TUCKED INTO the hot-pants waistband — the hem of
the top disappears under the waistband, no untucked overhang, the front of the top sits
smooth and flat against the body. PRESERVE THIS TUCK PIXEL-FAITHFULLY in the output:
- DO NOT untuck the top.
- DO NOT add untucked overhang at the front, sides, or back.
- DO NOT re-render the top — copy it as-is from PRIMARY REFERENCE.
- DO NOT change the top's drape, hem position, sleeves, neckline, color, or fabric.
- The top's hem disappears under the JEANS waistband in the output in exactly the same way
  it disappears under the hot-pants waistband in PRIMARY REFERENCE.

═══ JEANS — RENDER FROM GROUP A ONLY ═══
The jeans in the output are EXACTLY the garment shown in the GARMENT FLAT FRONT (slot 1):
- COLOR / WASH: match the flat exactly. NO sheen, NO satin, NO magenta or pink cast.
  Matte cotton denim.
- FIT PROFILE / SILHOUETTE / LEG WIDTH: match the FIT MODEL FRONT ANGLES EXACTLY. The leg
  silhouette in the rendered output is the silhouette shown in the FIT MODEL angles, NOT
  the slim bare-leg shape of the model in PRIMARY REFERENCE. If FIT MODEL shows wide /
  barrel / flared / relaxed legs, render that EXACT leg width — do not narrow to match
  the bare-leg shape in PRIMARY REFERENCE.
- HARDWARE: button fly vs zip fly, rivet count and placement, coin-pocket presence,
  back-pocket shape, brand patches — all as shown in the flat.
- HEM TREATMENT: rolled / cuffed / raw / straight — match the flat + FIT MODEL angles.
- LENGTH: full-length from waistband to floor. Cover EVERYTHING that's bare-legged in
  PRIMARY REFERENCE.

═══ FAILURE MODES — ABSOLUTELY WRONG ═══
- WRONG: top untucked, with any hem visible hanging OVER or BELOW the waistband. The top
  is tucked exactly as in PRIMARY REFERENCE; only the jeans waistband replaces the hot
  pants. The top stays put.
- WRONG: jean silhouette matching the SLIM BARE-LEG shape from PRIMARY REFERENCE — jeans
  must match FIT MODEL FRONT ANGLES in leg width. If the FIT MODEL shows wide/barrel/
  flared and the rendered jeans come out slim/skinny, that is a CRITICAL FAILURE.
- WRONG: hot pants visible anywhere in the output (placeholder must be entirely replaced
  by full-length jeans).
- WRONG: any bare leg or bare skin between the waistband and the shoes.
- WRONG: jeans that don't match GARMENT FLAT FRONT in wash, hardware, or fit profile.
- WRONG: top, face, hair, skin, or shoes differing from PRIMARY REFERENCE.
- WRONG: changing the pose / stance from PRIMARY REFERENCE.`;

  console.log(`Calling Seedream with ${seedreamRefs.length} refs (PRIMARY + ${seedreamRefs.length - 1} jean refs)...`);
  const pass2 = await generateSeedreamImage({
    prompt: SEEDREAM_PROMPT,
    referenceImages: seedreamRefs,
    aspectRatio: '9:16',
  });
  console.log(`✓ Pass 2 done in ${((Date.now() - t2) / 1000).toFixed(1)}s (${pass2.imageData.length} bytes)`);
  const pass2Path = path.join(OUT_DIR, '2_seedream_with_jeans.png');
  fs.writeFileSync(pass2Path, pass2.imageData);

  console.log(`\n────────────────────────────────────────`);
  console.log(`DONE. Compare in: ${OUT_DIR}`);
  console.log(`  reference_m03.png            — current production M03 from this job`);
  console.log(`  1_predressed.png             — new Pass 1 (Gemini, model + top + hot pants + shoes)`);
  console.log(`  2_seedream_with_jeans.png    — new Pass 2 (Seedream, jeans replace hot pants, top preserved)`);
  console.log(`────────────────────────────────────────`);
}

main().catch(e => { console.error(e); process.exit(1); });
