/**
 * Step 1 of native M01/M02 at 4K: render JUST the model + shoes + hot pants
 * placeholder at the M01/M02 crop framing (waist-down, 1:1 aspect, 4K).
 *
 * This is the "pre-dressed M01/M02 base" — establishes the lower body,
 * shoes, waistband, and bare-leg geometry that a future Pass 2 will then
 * have the focus jeans painted onto (replacing the hot pants placeholder).
 *
 * Step 1 here = front + back lower body bases. Step 2 (separate script
 * later, after Bruno approves Step 1) = paint jeans over hot pants.
 *
 * Usage: npx tsx scripts/test-m01-m02-native.ts <jobId>
 *
 * Outputs in test_outputs/m01-m02-native/<jobId>/:
 *   m01_step1_model_shoes.png — front waist-down, model + hot pants + shoes
 *   m02_step1_model_shoes.png — back waist-down, model + hot pants + shoes
 *   m01_2k_reference.png      — current production M01 (cropped from M03)
 *   m02_2k_reference.png      — current production M02 (cropped from M04)
 *
 * Cost: ~$0.08 per run (2 × Gemini-3-pro-image-preview at 4K).
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
import { generateImage, type ReferenceImage } from '../src/lib/vertex';
import { buildIdentityHeadCrop } from '../src/lib/pipeline/identity-head-crop';
import type { JobWardrobe } from '../src/types';

const jobId = process.argv[2];
if (!jobId) { console.error('Usage: npx tsx scripts/test-m01-m02-native.ts <jobId>'); process.exit(1); }

const OUT_DIR = path.join(projectRoot, 'test_outputs', 'm01-m02-native', jobId);
fs.mkdirSync(OUT_DIR, { recursive: true });

const STUDIO_BACKDROP_URL = 'https://storage.googleapis.com/gstar-ai-studio-assets/backdrops/clean-studio-grey.jpg';

async function fetchBuf(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  return { buffer: Buffer.from(await r.arrayBuffer()), mimeType: r.headers.get('content-type') || 'image/jpeg' };
}

interface ShotData { imageUrl?: string }

async function saveReference(db: Firestore, shotType: 'M01' | 'M02', outName: string): Promise<void> {
  const shotsSnap = await db.collection('shots')
    .where('jobId', '==', jobId)
    .where('shotType', '==', shotType)
    .get();
  if (shotsSnap.docs.length > 0) {
    const ref = shotsSnap.docs[0].data() as ShotData;
    if (ref.imageUrl) {
      const buf = (await fetchBuf(ref.imageUrl)).buffer;
      fs.writeFileSync(path.join(OUT_DIR, outName), buf);
      console.log(`✓ Saved ${shotType} reference (${(buf.length / 1024).toFixed(0)} KB)`);
    }
  }
}

interface WardrobeItemLike {
  name?: string;
  flatFrontUrl?: string;
  flatBackUrl?: string;
  fitModels?: Record<string, string>;
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

async function renderStep1(
  view: 'front' | 'back',
  model: ModelLike,
  shoe: WardrobeItemLike | undefined,
  outName: string,
): Promise<void> {
  console.log(`\n=== ${view.toUpperCase()} — Step 1: model + hot pants + shoes (waist-down, 1:1, 4K) ===`);
  const t0 = Date.now();

  const refs: ReferenceImage[] = [];

  // IMAGE 1: MODEL IDENTITY (full card) — promoted to slot 1 for max visual
  // weight. Previously was in slot 2 (after backdrop) and Gemini's "fashion
  // model" prior overrode it on front-view renders for non-default-complexion
  // models (caught on F9 M01 — dark-skinned model rendered as light-skinned).
  const modelRefUrl = view === 'back'
    ? (model.backReferenceImageUrl || model.referenceImageUrl || model.cardImageUrl)
    : (model.referenceImageUrl || model.cardImageUrl);
  if (!modelRefUrl) throw new Error('No model card');
  const modelCardBuf = (await fetchBuf(modelRefUrl)).buffer;
  refs.push({
    buffer: modelCardBuf,
    mimeType: 'image/jpeg',
    label: `IMAGE 1 — MODEL IDENTITY (${view} view, full body). The rendered model is the EXACT SAME PERSON in this image. SKIN TONE: match precisely — same complexion depth, same undertone, same melanin level. If this image shows dark / deep / brown skin, render dark / deep / brown skin. If light, render light. Body proportions (hip width, leg length, calf shape, ankle), height, leg muscle structure all match this reference. ${view === 'back' ? 'Hair color and back-of-head appearance must match.' : 'Face will not be visible at this crop (waist-down).'}`,
  });

  // IMAGE 1B: head/shoulders crop for identity anchoring (now slot 2 — face
  // resolution where Gemini fuses identity strongest).
  try {
    const headCropBuf = await buildIdentityHeadCrop(modelCardBuf);
    refs.push({
      buffer: headCropBuf,
      mimeType: 'image/png',
      label: 'IMAGE 1B — IDENTITY ANCHOR (head + shoulders crop, same person as IMAGE 1). Skin tone in this crop is the absolute authority — match the exact complexion depth shown here in every rendered body part (arms, midriff, legs). The head will NOT be in the rendered frame (waist-down crop) but use this image to lock skin tone, undertone, freckle pattern, hair color.',
    });
  } catch (e) {
    console.warn('Identity head crop skipped:', (e as Error).message);
  }

  // IMAGE 2: shoe ref (if present) — promoted before backdrop because it's a
  // garment ref that Gemini needs strong visual weight for.
  if (shoe?.flatFrontUrl) {
    const shoeBuf = await fetchBuf(shoe.flatFrontUrl);
    refs.push({
      buffer: shoeBuf.buffer,
      mimeType: shoeBuf.mimeType,
      label: 'IMAGE 2 — SHOE REFERENCE. The exact footwear the rendered model wears. Match shape, color, material, sole construction, heel height. Render at correct anatomical foot proportions.',
    });
  }

  // IMAGE 3: backdrop — demoted to last slot. Background appearance doesn't
  // need slot-1 weight; identity does.
  const backdropBuf = await fetchBuf(STUDIO_BACKDROP_URL);
  refs.push({
    buffer: backdropBuf.buffer,
    mimeType: backdropBuf.mimeType,
    label: `IMAGE ${refs.length + 1} — STUDIO BACKDROP. Clean light-grey sweep. Use for backdrop appearance only. NOT a source for model identity, skin tone, or pose.`,
  });

  const modelGender = model.gender || 'female';
  const modelDesc = (model.description || '').split('\n')[0].slice(0, 280);
  const shoeDesc = shoe?.shoesDescription || shoe?.description || shoe?.name || 'plain simple low-heel shoes';
  console.log(`  ${view} model.description: "${modelDesc || '(empty)'}"`);

  const PROMPT = `Photorealistic studio e-commerce photograph, 1:1 SQUARE crop, ${view.toUpperCase()} VIEW. Waist-down crop of a ${modelGender} fashion model${modelDesc ? ` (specific attributes: ${modelDesc})` : ''} standing on a clean light-grey studio backdrop (#D9DAD2). Soft diffused 5500K studio lighting. Sharp focus, ultra-high detail.

═══ FRAMING — WAIST-DOWN, 1:1 SQUARE ═══
1:1 square crop framed from the WAIST DOWN:
- TOP of frame: just above the hipbone — a thin band of bare midriff and the top edge of the hot pants waistband is visible. ~5-10% from the top edge of the frame.
- BOTTOM of frame: the floor with the shoes fully visible. Heels touching the floor at ~5-8% from the bottom edge with a small floor margin below them.
- The model's lower body fills the central frame: hot-pant waistband at top, bare legs in the middle, shoes at the bottom.
- NO head, NO upper body, NO shoulders in frame.
- Subject centered horizontally.

═══ POSE — MANDATORY BILATERAL ═══
Both legs drop STRAIGHT DOWN vertically from the hip to the floor (no outward angle, no splay). Feet planted flat on the floor parallel to each other with approximately ONE FOOT-WIDTH of clear space between the inner edges of the two feet (~10cm gap — the gap equals the WIDTH of one shoe, NOT the length). Weight 50/50 across both feet. Hips centered and level — NO hip tilt, NO contrapposto.

FEET DIRECTION — STRICTLY FORWARD: ${view === 'front'
  ? 'Both feet point STRAIGHT AHEAD toward the camera — toes pointing directly at the viewer, parallel to the camera axis. The toes are NOT angled outward (no V-shape ballet stance), NOT angled inward (no pigeon-toe), NOT one foot pointing differently from the other. Both shoes face the camera head-on with the toe boxes directed at the lens, side seams of the shoes aligned with the camera axis.'
  : 'Both feet point STRAIGHT AHEAD in the same direction the body faces (away from the camera) — toes pointing directly away from the viewer, parallel to the camera axis. The viewer sees the heels of the shoes from behind. NO outward angle, NO inward angle, both feet aligned identically.'}

${view === 'back'
  ? 'Body facing AWAY from the camera (back view) — viewer sees the backs of the legs, the back of the hot pants, and the heels of the shoes.'
  : 'Body facing the camera (front view) — viewer sees the fronts of the legs, the front of the hot pants waistband, and the toes/tops of the shoes.'}

═══ ARMS — VISIBLE AT TOP OF FRAME ═══
Arms hang relaxed and STRAIGHT DOWN at the sides of the body, with a small natural gap from the torso (~5cm at the upper arm). The lower forearms and HANDS are visible at the TOP of the frame near the hot pants waistband (hands at hip level, fingers loose). The arms are NOT crossed, NOT in pockets, NOT raised, NOT placed on hips — they fall straight down from the shoulder (above the frame) past the waistband visible in frame. Wrists and hands should be IN the frame at the top edge.

═══ IDENTITY (from IMAGE 1 + IMAGE 1B) — SKIN TONE IS LOCKED, DO NOT DRIFT ═══
The rendered body is the SAME PERSON as in IMAGE 1 + IMAGE 1B — a ${modelGender} model${modelDesc ? ` with these EXACT specific attributes (do not deviate): ${modelDesc}` : ''}.

CRITICAL SKIN TONE INSTRUCTION (read this twice):
- Look at IMAGE 1 + IMAGE 1B carefully. Identify the model's exact skin tone.
- If the model has DARK skin (deep brown, rich brown, dark-skinned, melanin-rich), render DARK skin on every body part visible: arms, hands, midriff sliver at top, full leg length, ankles. The legs in the output are DARK SKIN if IMAGE 1 + IMAGE 1B show DARK SKIN.
- If the model has LIGHT skin, render LIGHT skin.
- DO NOT default to a generic "fashion-stock-model" light-skinned complexion. This is a CRITICAL identity failure when the reference shows dark/deep skin.
- The reference (IMAGE 1 + IMAGE 1B) is the ABSOLUTE authority for complexion depth, undertone, and melanin level.

Body proportions (hip width, leg length, calf shape, ankle thickness), height, leg muscle structure: match IMAGE 1 exactly. ${view === 'back' ? 'The back of the head, hair color/length/texture must match IMAGE 1 if any hair is visible at the top edge.' : 'Face is OUT of frame (above the top edge of this waist-down crop).'}

═══ HOT PANTS — PLACEHOLDER (will be replaced with jeans later) ═══
The model wears plain MATTE BLACK HIGH-WAISTED HOT PANTS at the hipbone, ~3-5cm below the navel. Flat 2cm waistband at the top, plain straight-cut leg openings just above the upper thigh. NO logos, NO mesh, NO piping, NO sheen, NO color other than matte black, NO denim wash, NO patterns.

These hot pants are a temporary placeholder that marks where the jeans waistband will go in a downstream step. Render them cleanly with the waistband line UNAMBIGUOUS.

═══ FOOTWEAR — THE EXACT SHOE FROM IMAGE 2 + DESCRIPTION ═══
${shoe?.flatFrontUrl
  ? `The model wears the EXACT footwear shown in IMAGE 2 (SHOE REFERENCE). Description (reinforcement, authoritative): ${shoeDesc}.

Match IMAGE 2 EXACTLY for every detail:
- Material and finish: ${shoeDesc.toLowerCase().includes('leather') ? 'leather as shown — same grain, same sheen' : 'fabric/material exactly as shown'}
- Color: same exact color as IMAGE 2, no shift toward black-default
- Toe shape: copy the toe geometry from IMAGE 2 (pointed / square / round / almond) — do NOT invent a different toe shape
- Heel: same height, same shape, same color as IMAGE 2 — do NOT invent stiletto if the ref shows flat, do NOT invent flat if the ref shows heel
- Sole construction: same as IMAGE 2 — same edge profile, same stack height, same finish
- Strap / slingback / lacing: copy EXACTLY from IMAGE 2. If the ref shows a slingback (strap behind heel), the rendered shoe has that exact slingback strap. If the ref has no strap, the rendered shoe has no strap.
- Hardware: ONLY render hardware (buckles, studs, chains) that is visible in IMAGE 2. Do NOT invent new hardware.
- Branding: only the branding visible in IMAGE 2.

The footwear is rendered at correct anatomical foot proportions for the model — a normal adult ${modelGender} shoe footprint.`
  : `The model wears: ${shoeDesc}. Render at correct anatomical foot proportions.`}

═══ STUDIO ═══
Clean light-grey studio sweep (#D9DAD2), no scuffs, no texture, no marks. Floor: continuous extension of the backdrop with a faint soft contact shadow under the feet. Soft diffused 5500K lighting, even illumination.

═══ FAILURE MODES — ABSOLUTELY WRONG ═══
- WRONG: skin tone differing from IMAGE 1 + IMAGE 1B in ANY way. If the reference shows dark / deep / brown / melanin-rich skin tone, the rendered legs, arms, and midriff MUST be the SAME dark / deep / brown / melanin-rich skin tone. Do not lighten. Do not shift toward generic "fashion-stock-model" or "European" complexion. This is the #1 CRITICAL identity failure for this render.
- WRONG: shoes that differ from IMAGE 2 in ANY design detail — wrong toe shape, wrong heel height, invented buckles, invented straps, missing slingback strap (if ref shows one), changed material/color, added hardware not in the ref. The shoe in IMAGE 2 is the EXACT shoe — do NOT invent variations.
- WRONG: arms not visible at the top of the frame. Both arms hang at the sides with the lower forearms and hands visible at the top edge of the frame near the hot pants waistband.
- WRONG: head, shoulders, or any upper body in frame.
- WRONG: model not in bilateral standing pose (hip tilt, crossed legs, weight shifted to one leg).
- WRONG: feet angled outward in a V-shape or angled inward (pigeon-toe). Both feet point STRAIGHT AHEAD — parallel to each other and parallel to the camera axis (toes toward the camera for front view, heels toward the camera for back view).
- WRONG: hot pants with anything other than matte black flat material (no logos, no mesh, no patterns).
- WRONG: shoes cropped at the bottom edge — heels must have small floor margin below.
- WRONG: jeans / pants / shorts other than the plain matte-black hot pants placeholder.
- WRONG: bare feet — the model is wearing the SHOE REFERENCE footwear.
- WRONG: model not centered or not filling the central frame.`;

  console.log(`Calling Gemini-3-pro-image-preview with ${refs.length} refs at 1:1 4K…`);
  const result = await generateImage({
    prompt: PROMPT,
    referenceImages: refs,
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  console.log(`✓ ${view} done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.imageData.length} bytes`);
  fs.writeFileSync(path.join(OUT_DIR, outName), result.imageData);
}

async function main() {
  const db = new Firestore();
  const jobSnap = await db.collection('jobs').doc(jobId).get();
  if (!jobSnap.exists) throw new Error(`Job ${jobId} not found`);
  const job = jobSnap.data() as { wardrobe: JobWardrobe; modelId: string };
  console.log(`Job ${jobId}: model=${job.modelId}`);

  // Pull model
  const modelSnap = await db.collection('models').doc(job.modelId).get();
  if (!modelSnap.exists) throw new Error(`Model ${job.modelId} not found`);
  const model = modelSnap.data() as ModelLike;
  console.log(`Model: ${job.modelId} — front=${!!model.referenceImageUrl} back=${!!model.backReferenceImageUrl}`);

  // Pull shoe
  const shoeCfg = job.wardrobe['shoe'];
  let shoe: WardrobeItemLike | undefined;
  if (shoeCfg?.itemId) {
    const shoeSnap = await db.collection('wardrobe').doc(shoeCfg.itemId).get();
    shoe = shoeSnap.data() as WardrobeItemLike;
    console.log(`Shoe: ${shoe.name} (flat ${shoe.flatFrontUrl ? '✓' : '✗'})`);
  } else {
    console.log('Shoe: (none in wardrobe)');
  }

  // Pull existing M01 + M02 references for visual comparison
  await saveReference(db, 'M01', 'm01_2k_reference.png');
  await saveReference(db, 'M02', 'm02_2k_reference.png');

  // Run M01 + M02 Step 1 in parallel (independent calls)
  await Promise.all([
    renderStep1('front', model, shoe, 'm01_step1_model_shoes.png'),
    renderStep1('back', model, shoe, 'm02_step1_model_shoes.png'),
  ]);

  console.log(`\n────────────────────────────────────────`);
  console.log(`DONE. Compare in: ${OUT_DIR}`);
  console.log(`  m01_2k_reference.png       — current production M01 (cropped from M03)`);
  console.log(`  m01_step1_model_shoes.png  — NEW: native 4K M01 base (model + hot pants + shoes)`);
  console.log(`  m02_2k_reference.png       — current production M02 (cropped from M04)`);
  console.log(`  m02_step1_model_shoes.png  — NEW: native 4K M02 base (model + hot pants + shoes)`);
  console.log(`────────────────────────────────────────`);
  console.log(`If the framing + lower body looks right, Step 2 will paint the focus jeans`);
  console.log(`over the hot pants (replacing the placeholder, preserving the rest).`);
}

main().catch(e => { console.error(e); process.exit(1); });
