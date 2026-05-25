/**
 * Test the M01/M02 native-4K pipeline across multiple wardrobe bottoms,
 * with a fixed model + shoe. Generates 4 images per bottom for PDF assembly:
 *
 *   fit_model_front.jpg  — wardrobe fit-model ref (what the jeans look like on a body)
 *   fit_model_back.jpg   — wardrobe fit-model ref, back angle
 *   m01_generated.png    — pipeline output, front M01
 *   m02_generated.png    — pipeline output, back M02
 *
 * Fixed test variables (so we isolate the variable = jeans cut):
 *   model    F9   (deep-skin reference, validates skin-tone fidelity)
 *   shoe     PiLqQo7ObRvPrwBvbwZS   (Black leather slingback loafers)
 *
 * Usage:
 *   npx tsx scripts/test-wardrobe-jeans-fit.ts <bottomId1> <bottomId2> <bottomId3> ...
 *
 * Output: test_outputs/3-jeans-comparison/<bottomId>/
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
import { generateSeedreamImage, type SeedreamReferenceImage } from '../src/lib/pipeline/seedream-client';
import { ensureSeedreamSafeUrl } from '../src/lib/pipeline/seedream-image-safe';
import { uploadGeneratedImage } from '../src/lib/gcs';
import { buildIdentityHeadCrop } from '../src/lib/pipeline/identity-head-crop';

const MODEL_ID = 'F9';
const SHOE_ID = 'PiLqQo7ObRvPrwBvbwZS';
const STUDIO_BACKDROP_URL = 'https://storage.googleapis.com/gstar-ai-studio-assets/backdrops/clean-studio-grey.jpg';

const bottomIds = process.argv.slice(2);
if (bottomIds.length === 0) { console.error('Usage: npx tsx scripts/test-wardrobe-jeans-fit.ts <bottomId1> [<bottomId2> ...]'); process.exit(1); }

const OUT_ROOT = path.join(projectRoot, 'test_outputs', '3-jeans-comparison');
fs.mkdirSync(OUT_ROOT, { recursive: true });

interface WardrobeItemLike {
  name?: string;
  flatFrontUrl?: string;
  flatBackUrl?: string;
  fitModels?: Record<string, string>;
  bottomDescription?: string;
  shoesDescription?: string;
  description?: string;
  designNumber?: string;
}
interface ModelLike {
  referenceImageUrl?: string;
  cardImageUrl?: string;
  backReferenceImageUrl?: string;
  gender?: string;
  description?: string;
}

async function fetchBuf(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  return { buffer: Buffer.from(await r.arrayBuffer()), mimeType: r.headers.get('content-type') || 'image/jpeg' };
}

// ── Step 1: Gemini-renders model + shoes + hot pants placeholder (waist-down 1:1 4K) ──
async function renderStep1(
  view: 'front' | 'back',
  model: ModelLike,
  shoe: WardrobeItemLike,
  outPath: string,
): Promise<void> {
  const refs: ReferenceImage[] = [];

  // slot 1 — MODEL CARD (identity is dominant for skin-tone preservation)
  const modelRefUrl = view === 'back'
    ? (model.backReferenceImageUrl || model.referenceImageUrl || model.cardImageUrl)
    : (model.referenceImageUrl || model.cardImageUrl);
  if (!modelRefUrl) throw new Error('No model card');
  const modelCardBuf = (await fetchBuf(modelRefUrl)).buffer;
  refs.push({
    buffer: modelCardBuf,
    mimeType: 'image/jpeg',
    label: `IMAGE 1 — MODEL IDENTITY (${view} view). The rendered model is the EXACT SAME PERSON. SKIN TONE: match precisely — same complexion depth, same undertone, same melanin level. If this image shows dark / deep / brown skin, render dark / deep / brown skin. Body proportions, height, leg muscle structure all match this reference. ${view === 'back' ? 'Hair color and back-of-head appearance must match.' : 'Face will not be visible at this crop (waist-down).'}`,
  });

  // slot 2 — head-crop identity anchor
  try {
    const headCropBuf = await buildIdentityHeadCrop(modelCardBuf);
    refs.push({
      buffer: headCropBuf,
      mimeType: 'image/png',
      label: 'IMAGE 1B — IDENTITY ANCHOR (head + shoulders crop, same person as IMAGE 1). Skin tone in this crop is the absolute authority — match the exact complexion depth shown here in every rendered body part (arms, midriff, legs). The head will NOT be in the rendered frame (waist-down crop) but use this image to lock skin tone, undertone, freckle pattern, hair color.',
    });
  } catch (e) {
    console.warn('  Head crop skipped:', (e as Error).message);
  }

  // slot 3 — shoe
  if (shoe.flatFrontUrl) {
    const shoeBuf = await fetchBuf(shoe.flatFrontUrl);
    refs.push({
      buffer: shoeBuf.buffer,
      mimeType: shoeBuf.mimeType,
      label: 'IMAGE 2 — SHOE REFERENCE. The exact footwear the rendered model wears. Match shape, color, material, sole construction, heel height. Render at correct anatomical foot proportions.',
    });
  }

  // slot 4 — backdrop
  const backdropBuf = await fetchBuf(STUDIO_BACKDROP_URL);
  refs.push({
    buffer: backdropBuf.buffer,
    mimeType: backdropBuf.mimeType,
    label: `IMAGE ${refs.length + 1} — STUDIO BACKDROP. Clean light-grey sweep. Backdrop appearance only. NOT a source for identity, skin tone, or pose.`,
  });

  const modelGender = model.gender || 'female';
  const modelDesc = (model.description || '').split('\n')[0].slice(0, 280);
  const shoeDesc = shoe.shoesDescription || shoe.description || shoe.name || 'plain simple low-heel shoes';

  const PROMPT = `Photorealistic studio e-commerce photograph, 1:1 SQUARE crop, ${view.toUpperCase()} VIEW. Waist-down crop of a ${modelGender} fashion model${modelDesc ? ` (specific attributes: ${modelDesc})` : ''} standing on a clean light-grey studio backdrop (#D9DAD2). Soft diffused 5500K studio lighting. Sharp focus, ultra-high detail.

═══ FRAMING — WAIST-DOWN, 1:1 SQUARE ═══
1:1 square crop framed from the WAIST DOWN. TOP of frame: just above the hipbone — thin band of bare midriff + top of hot pants waistband. ~5-10% from top. BOTTOM of frame: floor with shoes fully visible, heels ~5-8% from bottom with floor margin below. NO head, NO upper body, NO shoulders. Subject centered horizontally.

═══ POSE — MANDATORY BILATERAL ═══
Both legs drop STRAIGHT DOWN vertically. Feet flat, parallel, ONE FOOT-WIDTH gap between inner edges (~10cm). Weight 50/50. Hips centered, NO tilt, NO contrapposto.

FEET DIRECTION — STRICTLY FORWARD: ${view === 'front'
  ? 'Both feet point STRAIGHT AHEAD toward the camera — toes pointing directly at the viewer, parallel to camera axis. NOT V-shape, NOT pigeon-toe. Both feet identical direction.'
  : 'Both feet point STRAIGHT AHEAD in the same direction the body faces (away from the camera) — toes pointing directly away from the viewer, parallel to camera axis. NOT outward, NOT inward.'}

${view === 'back' ? 'Body facing AWAY from the camera.' : 'Body facing the camera.'}

═══ ARMS — VISIBLE AT TOP OF FRAME ═══
Arms hang relaxed and STRAIGHT DOWN at the sides. Lower forearms and HANDS visible at the TOP of the frame near the hot-pants waistband. Arms NOT crossed, NOT in pockets, NOT raised.

═══ IDENTITY (from IMAGE 1 + IMAGE 1B) — SKIN TONE LOCKED ═══
Render the same person as IMAGE 1 + IMAGE 1B. ${modelDesc ? `Attributes: ${modelDesc}` : ''} If the reference shows dark / deep / brown skin, render DARK skin on legs, arms, midriff. Do NOT default to "fashion-stock-model" light complexion. This is a CRITICAL identity failure when violated.

═══ HOT PANTS — PLACEHOLDER ═══
Plain MATTE BLACK HIGH-WAISTED HOT PANTS at the hipbone. Flat 2cm waistband. Plain leg openings just above upper thigh. NO logos, NO mesh, NO patterns, NO sheen, NO color other than matte black. These are a temporary placeholder.

═══ FOOTWEAR — THE EXACT SHOE FROM IMAGE 2 ═══
${shoe.flatFrontUrl
  ? `The model wears the EXACT footwear shown in IMAGE 2 (SHOE REFERENCE). Description: ${shoeDesc}. Match IMAGE 2 EXACTLY for toe shape, heel, strap/slingback, color, material, hardware. Do NOT invent variations.`
  : `The model wears: ${shoeDesc}. Render at correct foot proportions.`}

═══ FAILURE MODES ═══
- WRONG: skin tone differing from IMAGE 1 + IMAGE 1B. If reference shows dark/deep skin, render the same.
- WRONG: shoes differing from IMAGE 2 in any detail.
- WRONG: head/upper-body in frame. Waist-down only.
- WRONG: V-shape or pigeon-toe feet. Both feet point straight ahead.
- WRONG: hands not visible at top of frame.
- WRONG: hot pants with anything other than matte black material.
- WRONG: shoes cropped at bottom edge.`;

  const result = await generateImage({
    prompt: PROMPT,
    referenceImages: refs,
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  fs.writeFileSync(outPath, result.imageData);
}

// ── Step 2: Seedream paints the focus jeans over Step 1 base ──
async function paintJeans(
  view: 'front' | 'back',
  step1LocalPath: string,
  bottom: WardrobeItemLike,
  bottomId: string,
  outPath: string,
): Promise<void> {
  const step1Buf = fs.readFileSync(step1LocalPath);
  const step1Url = await uploadGeneratedImage(
    `_test/wardrobe-jeans-fit/${bottomId}`,
    `step1_${view}_${Date.now()}.png`,
    step1Buf,
  );

  const flatUrl = view === 'front' ? (bottom.flatFrontUrl || bottom.flatBackUrl) : (bottom.flatBackUrl || bottom.flatFrontUrl);
  if (!flatUrl) throw new Error(`No bottom flat for view=${view}`);
  const angleKey = view === 'front' ? 'front' : 'back';
  const rawFitAngle = bottom.fitModels?.[angleKey];

  const bottomDesc = bottom.bottomDescription || bottom.description || bottom.name || 'jeans';
  const refs: SeedreamReferenceImage[] = [];

  refs.push({
    url: await ensureSeedreamSafeUrl(step1Url.split('?')[0]),
    label: `WAIST-DOWN ANCHOR (slot 1 — identity, stance, shoes, framing) — exclusive source for the model's identity (skin tone, body, arms, hands), pose / stance (bilateral, feet straight ahead, weight 50/50, ~one foot-width gap, hands at sides), shoes at bottom of frame, 1:1 waist-down framing. The HOT PANTS visible here are a placeholder — replace them with focus jeans from slot 2+.`,
  });

  refs.push({
    url: await ensureSeedreamSafeUrl(flatUrl.split('?')[0]),
    label: `GARMENT FLAT ${view.toUpperCase()} (slot 2 — exclusive jeans authority) — match this flat EXACTLY: color, wash, fading, fabric weave, hardware (fly, rivets, coin pocket, brand patches), pocket geometry, hem treatment, stitch color.`,
  });

  if (rawFitAngle) {
    refs.push({
      url: await ensureSeedreamSafeUrl(rawFitAngle.split('?')[0]),
      label: `JEANS-ON-LEGS REFERENCE (slot 3 — fit profile / leg width only, NOT a subject) — focus jeans worn on a fit-model body. Use ONLY for: jeans fit profile (slim / straight / relaxed / barrel / wide-leg / flared / skinny), leg silhouette, EXACT leg width (match precisely), drape, length on body. IDENTITY, SKIN, BACKDROP, POSE, STANCE, SHOES, FRAMING are NOT used — those come from the WAIST-DOWN ANCHOR (slot 1). DO NOT add this as a second subject to the output.`,
    });
  }

  const PROMPT = `Photorealistic studio e-commerce photograph, 1:1 SQUARE crop, ${view.toUpperCase()} VIEW. Waist-down crop of the model shown in WAIST-DOWN ANCHOR (slot 1), wearing the focus jeans from GARMENT FLAT (slot 2) + fit reference. Clean light-grey studio backdrop. Soft 5500K lighting.

═══ ONE MODEL ONLY, ONE VIEW ONLY ═══
SINGLE rendered image of ONE model in ONE pose, ${view === 'front' ? 'facing the camera' : 'facing away from the camera'}. Do NOT render multiple models, no side-by-side collage, no double-rendering.

═══ FRAMING — IDENTICAL TO SLOT 1 ANCHOR ═══
1:1 square waist-down crop. Top of frame: ~5-10% above hipbone, hands at sides + midriff sliver visible. Bottom of frame: floor with shoes visible + small margin. NO head, NO upper body. Subject centered.

═══ IDENTITY + POSE + SHOES — FROM SLOT 1 ONLY ═══
- SKIN TONE: same as WAIST-DOWN ANCHOR. If dark/deep, render dark/deep on midriff, hands, arms.
- HANDS: hanging at sides, visible at top of frame near waistband.
- POSE: bilateral, legs straight down, weight 50/50, no hip tilt, no V-shape feet.
- FEET DIRECTION: both feet point STRAIGHT AHEAD parallel to camera axis (${view === 'front' ? 'toes toward camera' : 'heels toward camera'}). NO outward V, NO pigeon-toe.
- SHOES: EXACT footwear from anchor — same shape, color, material, ${view === 'front' ? 'toe shape and strap details' : 'heel and back details'}.

═══ JEANS — FROM SLOT 2 + JEANS-ON-LEGS REFERENCE ═══
EXACT garment from GARMENT FLAT:
- Color/wash: match flat exactly. Matte cotton denim. NO sheen / NO magenta or pink cast.
- FIT PROFILE / LEG WIDTH: match the jeans-on-legs reference EXACTLY. If skinny — render skinny. If wide — render wide. If flare — render the flare. Do NOT narrow.
- Hardware, hem treatment, fit, length — from flat + jeans-on-legs ref.
- Waistband: same hipbone position as the hot pants in the anchor.

Jeans description: ${bottomDesc}.

═══ FAILURE MODES ═══
- WRONG: multiple models in output.
- WRONG: hot pants still visible.
- WRONG: bare legs visible between waistband and shoes.
- WRONG: jean silhouette differing from the jeans-on-legs reference (skinny/wide/flare must match).
- WRONG: skin tone shifted from anchor.
- WRONG: shoes differing from anchor.
- WRONG: hands repositioned or cropped.
- WRONG: feet V-shape.
- WRONG: ${view === 'front' ? 'back-pocket details visible (this is FRONT — show fly and front pockets, NOT back pockets)' : 'front-of-jeans details visible (this is BACK — show back pockets and yoke, NOT fly)'}.`;

  const result = await generateSeedreamImage({
    prompt: PROMPT,
    referenceImages: refs,
    aspectRatio: '1:1',
  });
  fs.writeFileSync(outPath, result.imageData);
}

async function processBottom(db: Firestore, model: ModelLike, shoe: WardrobeItemLike, bottomId: string): Promise<void> {
  console.log(`\n════════ ${bottomId} ════════`);
  const itemSnap = await db.collection('wardrobe').doc(bottomId).get();
  if (!itemSnap.exists) { console.error(`  Bottom ${bottomId} not found`); return; }
  const bottom = itemSnap.data() as WardrobeItemLike;
  console.log(`  Item: ${bottom.name} (${bottom.designNumber || 'no design#'})`);

  const dir = path.join(OUT_ROOT, bottomId);
  fs.mkdirSync(dir, { recursive: true });

  // Save fit-model refs locally
  for (const [angleKey, outName] of [['front', 'fit_model_front.jpg'], ['back', 'fit_model_back.jpg']] as const) {
    const url = bottom.fitModels?.[angleKey];
    if (url) {
      try {
        const buf = (await fetchBuf(url)).buffer;
        fs.writeFileSync(path.join(dir, outName), buf);
        console.log(`  ✓ Saved ${outName}`);
      } catch (e) { console.warn(`  ✗ ${outName} fetch failed:`, (e as Error).message); }
    }
  }

  // Step 1 (front + back) in parallel
  console.log(`  Step 1: rendering Gemini base for front + back…`);
  const t1 = Date.now();
  const m01Step1Path = path.join(dir, 'step1_front.png');
  const m02Step1Path = path.join(dir, 'step1_back.png');
  await Promise.all([
    renderStep1('front', model, shoe, m01Step1Path),
    renderStep1('back', model, shoe, m02Step1Path),
  ]);
  console.log(`  ✓ Step 1 done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  // Step 2 (front + back) in parallel
  console.log(`  Step 2: Seedream paints jeans for front + back…`);
  const t2 = Date.now();
  await Promise.all([
    paintJeans('front', m01Step1Path, bottom, bottomId, path.join(dir, 'm01_generated.png')),
    paintJeans('back', m02Step1Path, bottom, bottomId, path.join(dir, 'm02_generated.png')),
  ]);
  console.log(`  ✓ Step 2 done in ${((Date.now() - t2) / 1000).toFixed(1)}s`);

  console.log(`  ✓ ${bottomId} complete → ${dir}`);
}

async function main() {
  const db = new Firestore();

  // Load fixed model + shoe once
  const modelSnap = await db.collection('models').doc(MODEL_ID).get();
  if (!modelSnap.exists) throw new Error(`Model ${MODEL_ID} not found`);
  const model = modelSnap.data() as ModelLike;
  console.log(`Model: ${MODEL_ID}`);

  const shoeSnap = await db.collection('wardrobe').doc(SHOE_ID).get();
  if (!shoeSnap.exists) throw new Error(`Shoe ${SHOE_ID} not found`);
  const shoe = shoeSnap.data() as WardrobeItemLike;
  console.log(`Shoe: ${shoe.name}`);

  // Process all bottoms in parallel (each handles its own front+back internally)
  await Promise.all(bottomIds.map(id => processBottom(db, model, shoe, id)));

  console.log(`\n════════ ALL DONE ════════`);
  console.log(`Outputs in: ${OUT_ROOT}`);
  bottomIds.forEach(id => console.log(`  ${id}/`));
}

main().catch(e => { console.error(e); process.exit(1); });
