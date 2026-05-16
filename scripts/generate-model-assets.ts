/**
 * Generate the 4 high-resolution model assets at 1:1 4K square per model:
 *   - assets4K_fullBodyFront   — head-to-toe, facing camera
 *   - assets4K_fullBodyBack    — head-to-toe, facing away
 *   - assets4K_legsFront       — waist-down crop, front (M01-style base)
 *   - assets4K_legsBack        — waist-down crop, back (M02-style base)
 *
 * Outfit (neutral, replaceable downstream) — GENDER-CONDITIONAL:
 *   FEMALE:
 *     - Top: matte-black sports bra (full-body only; out of frame in legs-only)
 *     - Bottom: matte-black high-waisted hot pants (waistband at hipbone)
 *   MALE:
 *     - Top: BARE CHEST (full-body only; out of frame in legs-only)
 *     - Bottom: matte-black boxer briefs (waistband at hipbone)
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

// CLI args parsing: positional = model IDs (or '--all'), `--views v1,v2,...`
// optionally limits which views are regenerated for each model.
const rawArgs = process.argv.slice(2);
let viewFilter: Set<string> | null = null;
const positional: string[] = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--views' && rawArgs[i + 1]) {
    viewFilter = new Set(rawArgs[i + 1].split(',').map(s => s.trim()));
    i++;
  } else {
    positional.push(rawArgs[i]);
  }
}
const args = positional;
if (args.length === 0) {
  console.error('Usage: npx tsx scripts/generate-model-assets.ts <modelId> [<modelId2> ...] OR --all [--views fullBodyFront,fullBodyBack,legsFront,legsBack]');
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
  const modelGender = (model.gender || 'female').toLowerCase();
  const isMale = modelGender === 'male' || modelGender === 'm';
  const modelDesc = (model.description || '').split('\n')[0].slice(0, 280);

  // GENDER-CONDITIONAL placeholder garment naming. Used consistently
  // across framing, arms, top, bottom, pose direction, and failure-mode blocks
  // so there is no leak between male and female outfits.
  const bottomName = isMale ? 'boxer briefs' : 'hot pants';
  const bottomHyphen = isMale ? 'boxer-brief' : 'hot-pants';

  // Pick the right model card for the view (back card if back view + available)
  const modelRefUrl = isBack
    ? (model.backReferenceImageUrl || model.referenceImageUrl || model.cardImageUrl)
    : (model.referenceImageUrl || model.cardImageUrl);
  if (!modelRefUrl) throw new Error(`Model has no card image`);
  const rawModelCardBuf = (await fetchBuf(modelRefUrl)).buffer;

  // For LEGS-ONLY views: pre-crop the model card to the bottom 60% before
  // passing as IMAGE 1. Without this, Gemini sees the full-body card as a
  // composition reference and renders a miniature full-body inside the 1:1
  // frame regardless of the textual "waist-down" instruction. Visual priors
  // beat text instructions. Pre-cropping aligns the visual prior with the
  // requested framing.
  //
  // Bottom 60% is a robust default for centered full-body model cards
  // (hipbone is usually around y=0.45–0.50, feet are at y=1.0). The crop
  // includes a small margin of midriff above the waist for context, and the
  // entire lower half plus floor.
  const sharp = (await import('sharp')).default;
  let modelCardBuf = rawModelCardBuf;
  if (isLegsOnly) {
    const meta = await sharp(rawModelCardBuf).metadata();
    const fullH = meta.height || 0;
    if (fullH > 0) {
      const cropTop = Math.round(fullH * 0.40);   // start at 40% from top
      const cropHeight = fullH - cropTop;          // bottom 60%
      modelCardBuf = await sharp(rawModelCardBuf)
        .extract({ left: 0, top: cropTop, width: meta.width || 0, height: cropHeight })
        .png()
        .toBuffer();
    }
  }

  // Build refs: MODEL CARD slot 1, head crop slot 2 (full-body only), backdrop slot 3.
  // For legs-only views, IMAGE 1 is pre-cropped to waist-down and the
  // head-crop ref is skipped (no face is visible in legs-only).
  const refs: ReferenceImage[] = [];
  refs.push({
    buffer: modelCardBuf,
    mimeType: isLegsOnly ? 'image/png' : 'image/jpeg',
    label: isLegsOnly
      ? `IMAGE 1 — PRE-CROPPED WAIST-DOWN REFERENCE. This image has already been cropped to show ONLY the lower body of the model (from above the hipbone down to the feet, with floor). The framing of THIS image IS the framing of the output. Match this image's composition: waist at the top, legs in the middle, feet at the bottom, no head, no upper body. Use this ref for the model's identity (skin tone, body proportions, leg shape) and for the exact framing.`
      : `IMAGE 1 — MODEL IDENTITY (${isBack ? 'back' : 'front'} reference, full body). USE THIS REFERENCE ONLY FOR: face / skin tone / undertone / freckle pattern / hair color and texture / body proportions (hip width, shoulder line, leg length, calf shape, ankle) / height / ${isBack ? 'back-of-head appearance' : 'facial features (eye shape and color, nose, mouth, brow shape) and facial expression'}. DO NOT USE THIS REFERENCE FOR OUTFIT, CLOTHING, POSE, OR STANCE — those are specified separately in the prompt text below. The clothing visible in this image is IRRELEVANT and must NOT be reproduced in the rendered output; the rendered outfit is described in the OUTFIT block of the prompt, and the rendered pose is described in the POSE block. Identity-only reference.`,
  });
  // Head crop ref is only useful for views where the face is visible
  // (full-body shots). For legs-only views, the head isn't in the frame,
  // so a head-crop ref would just confuse Gemini's framing prior.
  if (!isLegsOnly) {
    try {
      const headCropBuf = await buildIdentityHeadCrop(rawModelCardBuf);
      refs.push({
        buffer: headCropBuf,
        mimeType: 'image/png',
        label: 'IMAGE 1B — IDENTITY ANCHOR (head + shoulders crop, same person as IMAGE 1). USE THIS REFERENCE ONLY FOR: skin tone, undertone, freckle pattern, hair detail at face resolution. The rendered skin tone is locked to this image. DO NOT USE for outfit, clothing, pose, or stance — those come from the prompt text. Identity-only reference.',
      });
    } catch (e) {
      console.warn(`  Head crop skipped: ${(e as Error).message}`);
    }
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
- TOP of frame: just above the hipbone — thin band of bare midriff + top edge of ${bottomName} waistband visible. ~5-10% from top edge.
- BOTTOM of frame: floor with BARE FEET fully visible. Heels ~5-8% from bottom edge with small floor margin below.
- NO head, NO upper body, NO shoulders in frame.
- The model's lower body fills the central frame: ${bottomHyphen} waistband at top, bare legs in the middle, bare feet at the bottom.
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
Arms hang relaxed and STRAIGHT DOWN at the sides of the body. The lower forearms and HANDS are visible at the TOP edge of the frame near the ${bottomHyphen} waistband (hands at hip level, fingers loose). Arms NOT crossed, NOT in pockets, NOT raised, NOT on hips.`
    : `═══ ARMS ═══
Arms hang relaxed at the sides of the body with a small natural gap from the torso (~5cm at the upper arm). Hands hang at hip level, palms facing slightly inward, fingers loose and natural. Arms NOT crossed, NOT in pockets, NOT raised, NOT on hips.`;

  // Top description — only relevant for full-body views (in legs-only, top is out of frame)
  // GENDER-CONDITIONAL: female = sports bra, male = bare chest (standard
  // male fitness/studio reference, since a sports bra on a male model is wrong).
  const topBlock = isLegsOnly
    ? '' // top is out of frame
    : isMale
      ? `═══ TOP — COMPLETELY BARE CHEST (THIS IS A MALE MODEL — NO TOP GARMENT EXISTS) ═══
THE MODEL IS SHIRTLESS. THE ENTIRE UPPER BODY IS BARE SKIN. NOTHING IS WORN ABOVE THE WAIST.
- The chest, pectorals, sternum, collarbones, shoulders, upper back, sides, ribs, and stomach are ALL bare skin in matching complexion.
- ABSOLUTELY NO: shirt, t-shirt, tank top, singlet, vest, sleeveless top, halter, hoodie, sweater, jacket, coat.
- ABSOLUTELY NO: sports bra, bra, bralette, bandeau, crop top, chest band, chest wrap, strapless top.
- ABSOLUTELY NO: visible straps over the shoulders of any kind (no spaghetti straps, no thick straps, no thin straps, no shoulder straps of any colour).
- ABSOLUTELY NO: black band, dark band, or any horizontal contour line across the chest or under the bust — the male chest has nipples and pectoral definition visible, NOT a band or covering.
- ABSOLUTELY NO: necklace, harness, chain, sash, or any line crossing the chest.
- The skin runs continuously from neck to boxer-brief waistband with no interruption. Natural male pectorals + nipples + visible sternum + visible abdominals if the body type matches IMAGE 1.
- Natural male musculature consistent with IMAGE 1.
- Do NOT add chest hair, tattoos, jewelry, or accessories that are not visible in IMAGE 1.
- The clothing in IMAGE 1 is NOT a reference for what to render — this is a male studio reference shoot, and male studio reference shoots have a BARE CHEST as the universal neutral placeholder. Override anything the model wears in IMAGE 1.`
      : `═══ TOP — PLAIN MATTE-BLACK SPORTS BRA ═══
The model wears a plain MATTE BLACK SPORTS BRA on the upper body (basic athletic style):
- Color: matte black throughout. NO logos, NO patterns, NO color variation, NO sheen.
- Style: thin spaghetti straps over the shoulders, scoop neckline at the front, flat 2cm band at the bottom hem sitting just under the bust.
- Bare arms (skin showing from shoulder to wrist), bare midriff between the sports bra band and the hot pants waistband.
- This is a neutral placeholder top — it will be replaced with the production garment downstream.`;

  // Pose direction (gender-conditional naming for top + bottom)
  const poseDirection = isBack
    ? `Body facing AWAY from the camera (back view) — viewer sees the back of the body, the back of the${isLegsOnly ? ` ${bottomName}` : isMale ? ' bare back and the back of the boxer briefs' : ' sports bra and the back of the hot pants'}, and the heels of the feet.`
    : `Body facing the camera (front view) — viewer sees the front of the body, the front of the${isLegsOnly ? ` ${bottomHyphen} waistband` : isMale ? ' bare chest, midriff, boxer-brief waistband' : ' sports bra, midriff, hot-pants waistband'}, and the toes/tops of the feet.`;

  // Opening line — gender-conditional with bare-chest opener for males.
  // Gemini's "fashion editorial" prior tends to inject a sports bra when it
  // sees "fashion model + matte black + studio shoot". By opening with
  // "SHIRTLESS BARE-CHESTED" + reframing as a "studio CASTING portrait"
  // (not a fashion editorial), we starve that pattern while keeping clean
  // commercial-quality beauty lighting (avoids the harsh-clinical look of
  // "anatomical reference" framing).
  const openingLine = (isMale && !isLegsOnly)
    ? `Photorealistic studio CASTING PORTRAIT photo of a SHIRTLESS BARE-CHESTED ADULT MALE model, 1:1 SQUARE crop, ${isBack ? 'BACK' : 'FRONT'} VIEW, full body head-to-toe. The model is SHIRTLESS — completely bare-chested with no top garment of any kind. From the waist down, the model wears plain matte-black boxer briefs and stands BAREFOOT on a clean light-grey studio backdrop (#D9DAD2). This is NOT a fashion editorial — it is a neutral studio casting portrait for studio asset library use. Soft EVEN diffused 5500K studio lighting from the front (key + fill), flat clean even illumination across the face and body, NO side lighting, NO dramatic shadows on one side of the face, NO under-eye darkening, NO makeup or cosmetic appearance. Natural unretouched skin texture.`
    : isMale && isLegsOnly
      ? `Photorealistic studio reference photo, 1:1 SQUARE crop, ${isBack ? 'BACK' : 'FRONT'} VIEW, waist-down view of an adult male model. The model wears plain matte-black boxer briefs at the hipbone and stands BAREFOOT on a clean light-grey studio backdrop (#D9DAD2). Soft EVEN diffused 5500K studio lighting, flat clean even illumination across the body.`
      : `Photorealistic studio CASTING PORTRAIT photo of a female model, 1:1 SQUARE crop, ${isBack ? 'BACK' : 'FRONT'} VIEW, ${isLegsOnly ? 'waist-down' : 'full body head-to-toe'}. Standing on a clean light-grey studio backdrop (#D9DAD2). Soft EVEN diffused 5500K studio lighting from the front (key + fill), flat clean even illumination across the face and body, NO side lighting, NO dramatic shadows on one side of the face, NO under-eye darkening, NO heavy mascara appearance. Natural unretouched skin texture.`;

  const PROMPT = `${openingLine}

${framingBlock}

═══ IDENTITY (from IMAGE 1 + IMAGE 1B) — SKIN TONE LOCKED ═══
The rendered model is the SAME PERSON as in IMAGE 1 + IMAGE 1B — a ${modelGender} model${modelDesc ? ` with these EXACT specific attributes (do not deviate): ${modelDesc}` : ''}.

CRITICAL SKIN TONE INSTRUCTION:
- Look at IMAGE 1 + IMAGE 1B carefully. Identify the model's exact complexion.
- If the model has DARK / DEEP / BROWN / melanin-rich skin, render DARK / DEEP / BROWN skin on every visible body part (legs, arms, midriff${isLegsOnly ? '' : ', neck, shoulders, face'}). The rendered body parts have the SAME complexion as IMAGE 1 + IMAGE 1B.
- If LIGHT, render LIGHT. Match precisely — do NOT default to a generic "fashion-stock-model" complexion.

Body proportions (hip width, leg length, calf shape, ankle thickness), height, leg muscle structure: match IMAGE 1 exactly.

═══ POSE — MANDATORY HIP-WIDTH BILATERAL STANCE (CRITICAL — DO NOT SHORTCUT) ═══
The model stands in a perfectly bilateral, hip-width stance. Read this carefully — Gemini's default fashion pose is contrapposto with feet close together, and that pose is FORBIDDEN here:

FOOT PLACEMENT:
- Each foot is positioned DIRECTLY UNDERNEATH the lateral hip bone / hip joint on the same side (left foot under left hip joint, right foot under right hip joint).
- The visible gap between the INNER EDGES of the two feet, measured at the floor, is the SAME WIDTH as the width of one shoe sole (≈10–15 cm). The gap is clearly visible — it is not a tiny sliver, not feet touching, not legs pressed together.
- Both feet are PARALLEL to each other, flat on the floor, sole-to-floor contact across the entire foot.
- Imagine the natural athletic "ready stance" or a relaxed standing-attention pose where the feet sit directly below the hip joints — NOT the catwalk / fashion pose with one foot in front of the other or feet pressed together.

LEGS:
- Both legs are STRAIGHT DOWN, fully extended (knees not bent, not locked aggressively, just naturally straight).
- The legs run vertical from hip joint to ankle on each side — left leg vertical, right leg vertical, like two parallel columns spaced hip-width apart.
- NO crossing, NO one-leg-in-front-of-other, NO knees touching, NO inner thighs touching.

HIPS + WEIGHT:
- Hips perfectly level and centred. NO hip tilt, NO hip cocked-out, NO weight on one leg.
- Weight is distributed 50% on the left foot, 50% on the right foot — equal weight bearing.
- NO contrapposto (the classic fashion-shoot pose where one leg bears most of the weight and the opposite hip is dropped — explicitly forbidden here).

FEET DIRECTION — STRICTLY FORWARD: ${isBack
    ? 'Both feet point STRAIGHT AHEAD in the same direction the body faces (away from camera). NOT V-shape outward, NOT pigeon-toe inward.'
    : 'Both feet point STRAIGHT AHEAD toward the camera — toes pointing directly at the viewer, parallel to the camera axis. NOT V-shape outward, NOT pigeon-toe inward.'}

This is the SAME pose for every model in the studio asset library — like an engineering-drawing reference pose. Consistency is critical because these renders are cross-compared.

${poseDirection}

${armsBlock}

${topBlock}

${isMale
    ? `═══ BOTTOM — PLAIN MATTE-BLACK BOXER BRIEFS ═══
Plain MATTE BLACK BOXER BRIEFS at the hipbone, ~3-5cm below the navel. Flat 2cm elastic waistband at the top, plain mid-thigh leg openings (covering the upper third of the thigh, ending well above the knee). NO logos, NO branding, NO piping, NO mesh, NO sheen, NO color other than matte black, NO patterns. Clean smooth cotton-jersey boxer brief. The waistband line is unambiguous — this is a neutral placeholder bottom that will be replaced with the production garment downstream.`
    : `═══ BOTTOM — PLAIN MATTE-BLACK HOT PANTS ═══
Plain MATTE BLACK HIGH-WAISTED HOT PANTS (booty shorts) at the hipbone, ~3-5cm below the navel. Flat 2cm waistband at the top, plain leg openings just above the upper thigh. NO logos, NO mesh, NO piping, NO sheen, NO color other than matte black, NO denim wash, NO patterns. Clean smooth cotton-jersey hot pant. The waistband line is unambiguous — this is a neutral placeholder bottom that will be replaced with the production garment downstream.`}

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
- WRONG POSE (this is a frequent failure — REJECT these patterns):
  * Feet pressed together / touching / inner edges touching / nearly touching.
  * Feet less than one-shoe-width apart at the inner edges.
  * Feet under the medial inner thighs or under the kneecaps instead of under the hip joints.
  * One leg slightly bent / one knee softer than the other (contrapposto — FORBIDDEN here).
  * Hip cocked to one side / weight on one leg / hip tilt.
  * One foot in front of the other / catwalk pose / scissoring legs.
  * Knees touching, inner thighs touching, legs pressed together — all FORBIDDEN.
- WRONG: feet in V-shape outward or pigeon-toe inward. Both feet point straight ahead.
- WRONG: arms in pockets, crossed, raised, on hips, or out of view${isLegsOnly ? ' (hands must be visible at top of frame near waistband)' : ''}.
- WRONG: any garment other than the plain matte-black ${isLegsOnly ? bottomName : isMale ? 'boxer briefs (bare chest, NO top garment of any kind — NO shirt, NO bra, NO singlet)' : 'sports bra + hot pants'}. NO logos, NO patterns, NO mesh, NO color variation.${isMale && !isLegsOnly ? `
- WRONG (critical — this is the #2 failure on male renders): ANY chest covering on the male model. NO sports bra, NO bra, NO bralette, NO bandeau, NO crop top, NO chest band, NO chest wrap, NO halter, NO tank top, NO singlet, NO vest, NO shirt, NO straps over the shoulders, NO horizontal contour or shadow across the chest. The male chest is COMPLETELY BARE skin from neck to boxer-brief waistband, with visible natural pectorals and nipples consistent with male anatomy.
- WRONG: hallucinating a black shoulder strap or dark band across the chest because the model card shows clothing — the model card's clothing is to be IGNORED, the rendered outfit is ONLY what the OUTFIT block describes (bare chest + matte-black boxer briefs).` : ''}
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

  // Generate views in parallel (each is independent). Optionally filtered
  // to a subset via --views <comma-list>.
  const allViews: ViewKey[] = ['fullBodyFront', 'fullBodyBack', 'legsFront', 'legsBack'];
  const views: ViewKey[] = viewFilter ? allViews.filter(v => viewFilter!.has(v)) : allViews;
  if (viewFilter && views.length === 0) {
    console.warn(`  No views match filter — skipping`);
    return;
  }
  if (viewFilter) console.log(`  Filtered views: ${views.join(', ')}`);
  const results = await Promise.all(views.map(async v => {
    try {
      const buf = await generateView(v, model);
      return { view: v, buf, ok: true as const };
    } catch (e) {
      console.error(`  ✗ ${v} failed:`, e instanceof Error ? e.message : e);
      return { view: v, ok: false as const, error: e };
    }
  }));

  // Upload successful renders + thumbnails + update Firestore.
  // Thumbnail = 512x512 JPEG quality 82 (~50-80KB) for the model-detail-page
  // grid. The full 4K PNG (~17MB) is reserved for the lightbox-on-click view.
  // Generating the thumb inline (one resize per asset) is ~1s per file via
  // sharp lanczos3 — much faster than backfilling later.
  const sharp = (await import('sharp')).default;
  const update: Record<string, string> = {};
  for (const r of results) {
    if (!r.ok) continue;
    // Upload 4K master.
    const url = await uploadGeneratedImage(`model-assets/${modelId}`, `${r.view}.png`, r.buf);
    update[`assets4K_${r.view}`] = url;
    // Generate + upload 512px JPEG thumbnail.
    try {
      const thumbBuf = await sharp(r.buf)
        .resize(512, 512, { fit: 'cover', kernel: 'lanczos3' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      const thumbUrl = await uploadGeneratedImage(
        `model-assets/${modelId}`,
        `${r.view}_thumb.jpg`,
        thumbBuf,
        'image/jpeg',
      );
      update[`assetsThumb_${r.view}`] = thumbUrl;
      console.log(`  ✓ ${r.view}: 4K (${(r.buf.length / 1024 / 1024).toFixed(1)}MB) + thumb (${(thumbBuf.length / 1024).toFixed(0)}KB)`);
    } catch (e) {
      console.warn(`  ⚠ ${r.view} thumb failed (4K still saved):`, e instanceof Error ? e.message : e);
    }
  }

  if (Object.keys(update).length > 0) {
    update['assets4K_updatedAt'] = new Date().toISOString();
    if (Object.keys(update).some(k => k.startsWith('assetsThumb_'))) {
      update['assetsThumb_updatedAt'] = new Date().toISOString();
    }
    await db.collection('models').doc(modelId).update(update);
    console.log(`  ✓ Firestore updated`);
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
