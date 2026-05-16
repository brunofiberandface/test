/**
 * Generate the 4 high-resolution model assets at 1:1 4K square per model:
 *   - assets4K_fullBodyFront   — head-to-toe, facing camera
 *   - assets4K_fullBodyBack    — head-to-toe, facing away
 *   - assets4K_legsFront       — waist-down crop, front (M01-style base)
 *   - assets4K_legsBack        — waist-down crop, back (M02-style base)
 *
 * Outfit (neutral, replaceable downstream):
 *   - Top: matte-black sports bra (full-body only; out of frame in legs-only)
 *   - Bottom: matte-black high-waisted hot pants (waistband at hipbone)
 *   - Footwear: BAREFOOT (no shoes — shoes get added per-job in a separate
 *     (model × shoe) pre-cache tier so this tier is universal)
 *
 * Storage:
 *   GCS: model-assets/{modelId}/{view}.png
 *   Firestore: models/{modelId} doc gets the 4 URL fields
 *
 * Usage:
 *   npx tsx scripts/generate-model-assets.ts <modelId>
 *   npx tsx scripts/generate-model-assets.ts <modelId1> <modelId2> ...      # batch
 *   npx tsx scripts/generate-model-assets.ts --all                         # all active models
 *
 * Cost: ~$0.16 per model (4 × Gemini-3-pro-image-preview at 4K).
 * Idempotent: re-running overwrites existing assets.
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
import { uploadGeneratedImage } from '../src/lib/gcs';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npx tsx scripts/generate-model-assets.ts <modelId> [<modelId2> ...] OR --all');
  process.exit(1);
}

const STUDIO_BACKDROP_URL = 'https://storage.googleapis.com/gstar-ai-studio-assets/backdrops/clean-studio-grey.jpg';

interface ModelDoc {
  modelId?: string;
  referenceImageUrl?: string;
  cardImageUrl?: string;
  backReferenceImageUrl?: string;
  gender?: string;
  description?: string;
  active?: boolean;
}

type ViewKey = 'fullBodyFront' | 'fullBodyBack' | 'legsFront' | 'legsBack';

async function fetchBuf(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  return { buffer: Buffer.from(await r.arrayBuffer()), mimeType: r.headers.get('content-type') || 'image/jpeg' };
}

async function generateView(
  view: ViewKey,
  model: ModelDoc,
): Promise<Buffer> {
  const isBack = view === 'fullBodyBack' || view === 'legsBack';
  const isLegsOnly = view === 'legsFront' || view === 'legsBack';
  const modelGender = model.gender || 'female';
  const modelDesc = (model.description || '').split('\n')[0].slice(0, 280);

  // Pick the right model card for the view (back card if back view + available)
  const modelRefUrl = isBack
    ? (model.backReferenceImageUrl || model.referenceImageUrl || model.cardImageUrl)
    : (model.referenceImageUrl || model.cardImageUrl);
  if (!modelRefUrl) throw new Error(`Model has no card image`);
  const modelCardBuf = (await fetchBuf(modelRefUrl)).buffer;

  // Build refs: MODEL CARD slot 1, head crop slot 2, backdrop slot 3.
  const refs: ReferenceImage[] = [];
  refs.push({
    buffer: modelCardBuf,
    mimeType: 'image/jpeg',
    label: `IMAGE 1 — MODEL IDENTITY (${isBack ? 'back' : 'front'} reference, full body). The rendered model is the EXACT SAME PERSON in this image. SKIN TONE: match the precise complexion depth and undertone shown — if dark / deep / brown skin, render dark / deep / brown skin; if light, render light. Body proportions (hip width, shoulder line, leg length, calf shape, ankle), height, ${isBack ? 'hair color and back-of-head appearance,' : 'facial features (eye shape and color, nose, mouth, brow shape), facial expression, hair color/length/texture,'} freckle pattern — all match this reference precisely.`,
  });
  try {
    const headCropBuf = await buildIdentityHeadCrop(modelCardBuf);
    refs.push({
      buffer: headCropBuf,
      mimeType: 'image/png',
      label: 'IMAGE 1B — IDENTITY ANCHOR (head + shoulders crop, same person as IMAGE 1). Skin tone, undertone, freckle pattern, hair detail at face resolution — the rendered skin tone is locked to this image. Use this to verify melanin level and complexion depth.',
    });
  } catch (e) {
    console.warn(`  Head crop skipped: ${(e as Error).message}`);
  }
  const backdropBuf = await fetchBuf(STUDIO_BACKDROP_URL);
  refs.push({
    buffer: backdropBuf.buffer,
    mimeType: backdropBuf.mimeType,
    label: `IMAGE ${refs.length + 1} — STUDIO BACKDROP. Clean light-grey sweep (#D9DAD2). Backdrop appearance only. NOT a source for identity, skin tone, or pose.`,
  });

  // Framing prompt — depends on full-body vs legs-only
  const framingBlock = isLegsOnly
    ? `═══ FRAMING — 1:1 SQUARE WAIST-DOWN CROP ═══
1:1 square crop framed from the WAIST DOWN:
- TOP of frame: just above the hipbone — thin band of bare midriff + top edge of hot pants waistband visible. ~5-10% from top edge.
- BOTTOM of frame: floor with BARE FEET fully visible. Heels ~5-8% from bottom edge with small floor margin below.
- NO head, NO upper body, NO shoulders in frame.
- The model's lower body fills the central frame: hot-pants waistband at top, bare legs in the middle, bare feet at the bottom.
- Subject centered horizontally.`
    : `═══ FRAMING — 1:1 SQUARE FULL BODY (HEAD-TO-TOE WITH GENEROUS HEADROOM) ═══
1:1 square crop showing the model HEAD-TO-TOE:
- TOP of frame: AT LEAST 10-15% clear background ABOVE the top of the head (or top of hair, hairstyle volume, ponytail, bun, or any hair extension). The top of the head MUST NOT touch or come within 8% of the top edge of the frame.
- BOTTOM of frame: floor with BARE FEET visible, heels ~3-5% from bottom edge with small floor margin below.
- The ENTIRE model is visible inside the frame, head to toe — absolutely no cropping at the top edge (no scalp / hair / forehead / top-of-head clipped) and no cropping at the bottom edge (no feet / heels / toes clipped).
- Subject centered horizontally with roughly equal background on left and right (~15-20% margin on each side).
- If a tall model or one with voluminous hair would not fit naturally, ZOOM OUT — make the model SMALLER in the frame rather than crop any part of the body or hair.
- ABSOLUTELY CRITICAL: any clipping of the head, hair, scalp, forehead, hairstyle volume at the top edge of the frame is a hard failure. Always include the FULL hairstyle silhouette with clear margin above.`;

  // Arms block — visible at top of frame for legs-only, hanging at sides for full body
  const armsBlock = isLegsOnly
    ? `═══ ARMS — VISIBLE AT TOP OF FRAME ═══
Arms hang relaxed and STRAIGHT DOWN at the sides of the body. The lower forearms and HANDS are visible at the TOP edge of the frame near the hot-pants waistband (hands at hip level, fingers loose). Arms NOT crossed, NOT in pockets, NOT raised, NOT on hips.`
    : `═══ ARMS ═══
Arms hang relaxed at the sides of the body with a small natural gap from the torso (~5cm at the upper arm). Hands hang at hip level, palms facing slightly inward, fingers loose and natural. Arms NOT crossed, NOT in pockets, NOT raised, NOT on hips.`;

  // Top description — only relevant for full-body views (in legs-only, top is out of frame)
  const topBlock = isLegsOnly
    ? '' // top is out of frame
    : `═══ TOP — PLAIN MATTE-BLACK SPORTS BRA ═══
The model wears a plain MATTE BLACK SPORTS BRA on the upper body (basic athletic style):
- Color: matte black throughout. NO logos, NO patterns, NO color variation, NO sheen.
- Style: thin spaghetti straps over the shoulders, scoop neckline at the front, flat 2cm band at the bottom hem sitting just under the bust.
- Bare arms (skin showing from shoulder to wrist), bare midriff between the sports bra band and the hot pants waistband.
- This is a neutral placeholder top — it will be replaced with the production garment downstream.`;

  // Pose direction
  const poseDirection = isBack
    ? `Body facing AWAY from the camera (back view) — viewer sees the back of the body, the back of the${isLegsOnly ? ' hot pants' : ' sports bra and the back of the hot pants'}, and the heels of the shoes.`
    : `Body facing the camera (front view) — viewer sees the front of the body, the front of the${isLegsOnly ? ' hot-pants waistband' : ' sports bra, midriff, hot-pants waistband'}, and the toes/tops of the shoes.`;

  const PROMPT = `Photorealistic studio e-commerce photograph, 1:1 SQUARE crop, ${isBack ? 'BACK' : 'FRONT'} VIEW, ${isLegsOnly ? 'waist-down' : 'full body head-to-toe'}. ${modelGender === 'male' ? 'Male' : 'Female'} fashion model standing on a clean light-grey studio backdrop (#D9DAD2). Soft diffused 5500K studio lighting. Sharp focus, ultra-high detail.

${framingBlock}

═══ IDENTITY (from IMAGE 1 + IMAGE 1B) — SKIN TONE LOCKED ═══
The rendered model is the SAME PERSON as in IMAGE 1 + IMAGE 1B — a ${modelGender} model${modelDesc ? ` with these EXACT specific attributes (do not deviate): ${modelDesc}` : ''}.

CRITICAL SKIN TONE INSTRUCTION:
- Look at IMAGE 1 + IMAGE 1B carefully. Identify the model's exact complexion.
- If the model has DARK / DEEP / BROWN / melanin-rich skin, render DARK / DEEP / BROWN skin on every visible body part (legs, arms, midriff${isLegsOnly ? '' : ', neck, shoulders, face'}). The rendered body parts have the SAME complexion as IMAGE 1 + IMAGE 1B.
- If LIGHT, render LIGHT. Match precisely — do NOT default to a generic "fashion-stock-model" complexion.

Body proportions (hip width, leg length, calf shape, ankle thickness), height, leg muscle structure: match IMAGE 1 exactly.

═══ POSE — MANDATORY BILATERAL ═══
Both legs drop STRAIGHT DOWN vertically from the hip to the floor. Feet planted flat, parallel to each other with approximately ONE FOOT-WIDTH of clear space between the inner edges of the two feet (~10cm gap — the gap equals the WIDTH of one shoe, NOT the length). Weight 50/50. Hips centered and level — NO tilt, NO contrapposto, NO weight shift to one leg.

FEET DIRECTION — STRICTLY FORWARD: ${isBack
    ? 'Both feet point STRAIGHT AHEAD in the same direction the body faces (away from camera). NOT V-shape outward, NOT pigeon-toe inward.'
    : 'Both feet point STRAIGHT AHEAD toward the camera — toes pointing directly at the viewer, parallel to the camera axis. NOT V-shape outward, NOT pigeon-toe inward.'}

${poseDirection}

${armsBlock}

${topBlock}

═══ BOTTOM — PLAIN MATTE-BLACK HOT PANTS ═══
Plain MATTE BLACK HIGH-WAISTED HOT PANTS (booty shorts) at the hipbone, ~3-5cm below the navel. Flat 2cm waistband at the top, plain leg openings just above the upper thigh. NO logos, NO mesh, NO piping, NO sheen, NO color other than matte black, NO denim wash, NO patterns. Clean smooth cotton-jersey hot pant. The waistband line is unambiguous — this is a neutral placeholder bottom that will be replaced with the production garment downstream.

═══ FOOTWEAR — BAREFOOT (no shoes) ═══
The model stands BAREFOOT on the studio floor. Bare feet visible at the bottom of the frame:
- Both feet flat on the floor, soles fully in contact with the surface.
- Bare skin from the ankle down — NO shoes, NO socks, NO sandals, NO straps, NO accessories.
- Ankles, heels, toes naturally visible. Toes splayed naturally.
- Skin tone on the feet matches the rest of the model's body (same complexion as IMAGE 1 + IMAGE 1B).
- Faint soft contact shadow under each foot from the studio lighting.
- The feet are NOT cropped at the bottom edge — heels touching the floor are fully in frame with a small floor margin (~3-5% of frame height) below them.

(Shoes will be added in a separate downstream step per-job, paired with the specific shoe selected for the job. This model asset is intentionally barefoot so it's reusable across all jobs regardless of shoe choice.)

═══ STUDIO ═══
Clean light-grey studio sweep (#D9DAD2), no scuffs / texture / marks. Floor: continuous extension of the backdrop with a faint soft contact shadow under the feet. Soft diffused 5500K lighting, even illumination, no harsh shadows.

═══ FAILURE MODES — ABSOLUTELY WRONG ═══
- WRONG: skin tone differing from IMAGE 1 + IMAGE 1B. The #1 critical failure — match the reference precisely (every visible body part — face, neck, shoulders, arms, midriff, legs, feet — matches the complexion of the reference).
- WRONG: ${isLegsOnly
    ? 'head / shoulders / upper body in frame (this is a waist-down crop)'
    : 'ANY clipping at the top edge — head, hair, scalp, forehead, hairstyle volume must have 10-15% clear background above with NO cropping. Zoom out if needed.'}.
- WRONG: feet / heels / toes clipped at the bottom edge. Feet are fully in frame with a small floor margin below.
- WRONG: pose not bilateral (hip tilt, crossed legs, weight on one leg, contrapposto).
- WRONG: feet in V-shape outward or pigeon-toe inward. Both feet point straight ahead.
- WRONG: arms in pockets, crossed, raised, on hips, or out of view${isLegsOnly ? ' (hands must be visible at top of frame near waistband)' : ''}.
- WRONG: any garment other than the plain matte-black ${isLegsOnly ? 'hot pants' : 'sports bra + hot pants'}. NO logos, NO patterns, NO mesh, NO color variation.
- WRONG: rendering any footwear — model is BAREFOOT, no shoes / socks / sandals / straps on the feet.`;

  console.log(`  Generating ${view}…`);
  const t0 = Date.now();
  const result = await generateImage({
    prompt: PROMPT,
    referenceImages: refs,
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  console.log(`  ✓ ${view} done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${(result.imageData.length / 1024 / 1024).toFixed(1)} MB`);
  return result.imageData;
}

async function processModel(db: Firestore, modelId: string): Promise<void> {
  console.log(`\n════════ ${modelId} ════════`);
  const snap = await db.collection('models').doc(modelId).get();
  if (!snap.exists) { console.error(`  Model ${modelId} not found`); return; }
  const model = snap.data() as ModelDoc;
  console.log(`  Gender: ${model.gender}, has front=${!!model.referenceImageUrl}, has back=${!!model.backReferenceImageUrl}`);

  // Generate all 4 views in parallel (each is independent)
  const views: ViewKey[] = ['fullBodyFront', 'fullBodyBack', 'legsFront', 'legsBack'];
  const results = await Promise.all(views.map(async v => {
    try {
      const buf = await generateView(v, model);
      return { view: v, buf, ok: true as const };
    } catch (e) {
      console.error(`  ✗ ${v} failed:`, e instanceof Error ? e.message : e);
      return { view: v, ok: false as const, error: e };
    }
  }));

  // Upload successful renders + update Firestore
  const update: Record<string, string> = {};
  for (const r of results) {
    if (!r.ok) continue;
    const filename = `${r.view}.png`;
    const gcsPath = `model-assets/${modelId}/${filename}`;
    const url = await uploadGeneratedImage(`model-assets/${modelId}`, filename, r.buf);
    update[`assets4K_${r.view}`] = url;
    console.log(`  ✓ Uploaded → ${url}`);
  }

  if (Object.keys(update).length > 0) {
    update['assets4K_updatedAt'] = new Date().toISOString();
    await db.collection('models').doc(modelId).update(update);
    console.log(`  ✓ Firestore updated with ${Object.keys(update).length - 1} asset URLs`);
  }
}

async function main() {
  const db = new Firestore();
  let modelIds: string[];
  if (args[0] === '--all') {
    const snap = await db.collection('models').where('active', '==', true).get();
    modelIds = snap.docs.map(d => d.id);
    console.log(`Found ${modelIds.length} active models`);
  } else {
    modelIds = args;
  }
  // Process models sequentially (each model fires 4 parallel Gemini calls,
  // so doing models in parallel would hit rate limits / token budgets).
  for (const id of modelIds) {
    await processModel(db, id);
  }
  console.log(`\n════════ DONE: ${modelIds.length} model(s) processed ════════`);
}

main().catch(e => { console.error(e); process.exit(1); });
