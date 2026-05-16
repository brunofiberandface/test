/**
 * Two-pass male asset regen pipeline for the bra-stubborn models.
 *
 * Pipeline:
 *   PASS 1 (Seedream) — Generate the body + outfit + pose. Seedream follows
 *     "SHIRTLESS BARE-CHESTED" literally and does NOT hallucinate sports bras
 *     the way Gemini's fashion-editorial prior does. Output: bare-chested
 *     male in matte-black boxer briefs in the correct pose.
 *
 *   PASS 2 (Gemini-3-pro-image-preview) — Re-render the Seedream output
 *     using it as a body/outfit/pose ANCHOR (IMAGE 1) plus the model card
 *     as the IDENTITY reference (IMAGE 2). Gemini's stronger face quality
 *     fixes Seedream's mascara / uneven-lighting face artifacts while
 *     keeping the no-bra body.
 *
 * Cost per model: 4 views × (Seedream $0.04 + Gemini Pro 4K $0.24) = $1.12
 * Total for M15/M16/M21: ~$3.36, ~30 min wall time sequential.
 *
 * Usage:
 *   npx tsx scripts/regen-males-seedream-then-gemini.ts <modelId> [<modelId2> ...]
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
import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';
import { ensureSeedreamSafeUrl } from '../src/lib/pipeline/seedream-image-safe';
import { buildIdentityHeadCrop } from '../src/lib/pipeline/identity-head-crop';
import { uploadGeneratedImage } from '../src/lib/gcs';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npx tsx scripts/regen-males-seedream-then-gemini.ts <modelId> [...]');
  process.exit(1);
}

const STUDIO_BACKDROP_URL =
  'https://storage.googleapis.com/gstar-ai-studio-assets/backdrops/clean-studio-grey.jpg';

interface ModelDoc {
  modelId?: string;
  referenceImageUrl?: string;
  cardImageUrl?: string;
  backReferenceImageUrl?: string;
  gender?: string;
  description?: string;
}

type ViewKey = 'fullBodyFront' | 'fullBodyBack' | 'legsFront' | 'legsBack';
const VIEWS: ViewKey[] = ['fullBodyFront', 'fullBodyBack', 'legsFront', 'legsBack'];

async function fetchBuf(url: string): Promise<Buffer> {
  const r = await fetch(url.split('?')[0]);
  if (!r.ok) throw new Error(`fetch ${url.slice(0, 60)}... → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function buildSeedreamPrompt(view: ViewKey, model: ModelDoc): string {
  const isBack = view === 'fullBodyBack' || view === 'legsBack';
  const isLegsOnly = view === 'legsFront' || view === 'legsBack';
  const modelDesc = (model.description || '').split('\n')[0].slice(0, 280);

  const framing = isLegsOnly
    ? '1:1 square WAIST-DOWN crop. Top of frame just above the hipbone, bottom of frame shows bare feet on floor. NO head, NO upper body. The boxer-brief waistband is visible at the top of frame; bare legs run down to bare feet at the bottom.'
    : '1:1 square FULL-BODY crop showing the model HEAD-TO-TOE with 10-15% clear headroom above the top of the hair. The ENTIRE model is visible, head to toe, with floor margin below the feet.';

  const view_dir = isBack ? 'BACK VIEW (facing away from camera)' : 'FRONT VIEW (facing camera)';

  return `Photorealistic studio CASTING PORTRAIT photo of a SHIRTLESS BARE-CHESTED ADULT MALE model. 1:1 SQUARE crop. ${view_dir}. ${isLegsOnly ? 'Waist-down crop.' : 'Full body head-to-toe.'} The model has IDENTITY matching IMAGE 2 (model card).${modelDesc ? ` Specific attributes: ${modelDesc}` : ''}

═══ FRAMING ═══
${framing}

═══ OUTFIT (CRITICAL — NO BRA, NO TOP, NO STRAPS) ═══
${isLegsOnly ? '' : 'TOP: The model is SHIRTLESS — completely BARE-CHESTED. NO shirt, NO tank top, NO sports bra, NO bra, NO chest band, NO shoulder straps, NO chest covering of any kind. The entire upper body is bare skin from neck to boxer-brief waistband. Bare arms, bare chest with visible male anatomy (pectorals, nipples), bare shoulders, bare midriff.'}

BOTTOM: plain matte-black boxer briefs at the hipbone (~3-5cm below the navel). Flat 2cm elastic waistband, mid-thigh leg openings. NO logos, NO branding, NO mesh, NO color other than matte black.

FOOTWEAR: BAREFOOT — no shoes, no socks. Bare feet visible at bottom of frame.

═══ POSE ═══
Bilaterally symmetric stance: both feet planted DIRECTLY UNDER the hip joints (left foot under left hip, right foot under right hip). Inner edges of feet have one shoe-width gap (≈10-15 cm). Both legs straight vertical from hip to ankle. Weight 50/50 across both feet. Hips level. NO contrapposto, NO hip tilt, NO crossed legs.

Feet point straight ahead (${isBack ? 'away from camera' : 'toward camera'}). Arms hang straight down at sides, hands relaxed at hip level.

═══ STUDIO ═══
Clean light-grey backdrop (#D9DAD2) — matches IMAGE 1 exactly. Soft EVEN diffused 5500K lighting from the front, NO side lighting, NO dramatic shadows, NO under-eye darkening. Natural unretouched skin texture. The face has clean even soft lighting — NO heavy shadows, NO mascara-like look around the eyes.`;
}

function buildGeminiFaceCorrectionPrompt(view: ViewKey, model: ModelDoc): string {
  const isBack = view === 'fullBodyBack' || view === 'legsBack';
  const isLegsOnly = view === 'legsFront' || view === 'legsBack';
  const modelDesc = (model.description || '').split('\n')[0].slice(0, 280);

  // KEY DESIGN: Treat IMAGE 1 (Seedream output) as the BODY/POSE/OUTFIT
  // reference ONLY. Treat IMAGE 2 + IMAGE 2B (the model card) as the FACE
  // and identity reference. The face is REGENERATED with high quality
  // lighting — NOT preserved from IMAGE 1, because IMAGE 1's face has the
  // Seedream stylization (mascara look, uneven lighting) we are trying to
  // fix. Previous attempt over-emphasized "preserve IMAGE 1" and left the
  // bad face in place.
  return `Photorealistic studio CASTING PORTRAIT of an adult male model, 1:1 SQUARE crop, ${isBack ? 'BACK' : 'FRONT'} VIEW, ${isLegsOnly ? 'waist-down' : 'full body head-to-toe'}. The model is SHIRTLESS (bare-chested) wearing plain matte-black boxer briefs and standing barefoot on a clean light-grey studio backdrop.

═══ HOW TO USE THE THREE REFERENCE IMAGES ═══
IMAGE 1 = BODY/POSE/OUTFIT/COMPOSITION reference. Used for: body proportions, body angle, stance, foot placement, hand position, arm position, hip + shoulder posture, outfit (SHIRTLESS bare chest + matte-black boxer briefs + barefoot), framing, background, composition. Match IMAGE 1 EXACTLY for these.

IMAGE 2 (+ IMAGE 2B head crop) = FACE / HEAD / IDENTITY reference. Used for: facial features, expression, skin tone, hair, head shape. Render the FACE fresh from IMAGE 2 — do NOT copy the face from IMAGE 1, because IMAGE 1's face has stylized artifacts (heavy under-eye shadows, mascara-like darkening, uneven side-lighting) that we want REMOVED.

═══ FROM IMAGE 1 — BODY ANCHOR ═══
- Body shape / proportions / muscle definition: as shown in IMAGE 1.
- Pose: exact stance, foot placement, weight distribution, arm/hand position, hip + shoulder angle.
- Outfit: SHIRTLESS, bare chest, plain matte-black boxer briefs at the hipbone, barefoot. (Do NOT add a top garment.)
- Background: light-grey studio sweep, same as IMAGE 1.
- Camera framing and composition: same as IMAGE 1.

═══ FROM IMAGE 2 + IMAGE 2B — FACE + IDENTITY (REGENERATE, DO NOT COPY FROM IMAGE 1) ═══
${isLegsOnly ? 'This is a waist-down view, no face is visible. Use IMAGE 2 + IMAGE 2B ONLY for skin-tone matching (legs, feet, midriff).' : `- The rendered face has the EXACT identity of IMAGE 2 + IMAGE 2B: facial features (eye shape and color, nose, mouth, brow, jaw, ears), facial expression (relaxed, neutral), hair (color, texture, length, hairline, styling).
- The face is RE-RENDERED with these quality requirements (this is where IMAGE 1 fails — fix it now):
  * Clean EVEN soft diffused frontal studio lighting on the face. NO dramatic side shadow on one side of the face.
  * NO heavy under-eye darkening. The eyes look naturally bright and clear, NOT made-up.
  * NO mascara-like look around the eyes. NO eyeliner, NO eye shadow, NO cosmetic eye darkening.
  * Natural unretouched male skin texture. No oily / shiny / over-processed AI look.
  * Symmetric lighting — both sides of the face get equal soft fill light.`}
- Skin tone: match IMAGE 2 + IMAGE 2B's complexion EXACTLY across ALL visible body parts (${isLegsOnly ? 'legs, feet, waist, midriff' : 'face, neck, shoulders, chest, arms, midriff, legs, feet'}). If IMAGE 2 shows dark / brown / deep skin, render dark / brown / deep skin. If IMAGE 2 shows light skin, render light skin. Uniform skin tone across the body — no patchy areas.

═══ MODEL ${modelDesc ? `(specific: ${modelDesc})` : ''} ═══

═══ ABSOLUTELY FORBIDDEN ═══
- DO NOT add any top garment. NO sports bra, NO bra, NO shirt, NO tank top, NO chest band, NO shoulder straps, NO horizontal contour across the chest. The chest is BARE as shown in IMAGE 1.
- DO NOT copy the face shadows or face lighting from IMAGE 1 — IMAGE 1's face has stylized artifacts we are explicitly fixing. The face comes from IMAGE 2 + IMAGE 2B with clean even fresh studio lighting.
- DO NOT add cosmetic eye makeup, mascara, eyeliner, eye shadow, or under-eye darkening on the male model.
- DO NOT change the body proportions, pose, or outfit relative to IMAGE 1.
- DO NOT change the background.`;
}

interface FaceCorrectionResult {
  view: ViewKey;
  seedreamBuf?: Buffer;
  finalBuf?: Buffer;
  error?: string;
}

async function processView(
  modelId: string,
  model: ModelDoc,
  view: ViewKey,
  modelCardBuf: Buffer,
  modelCardUrl: string,
  headCropBuf: Buffer | null,
): Promise<FaceCorrectionResult> {
  console.log(`  [${view}] PASS 1 (Seedream)…`);
  const tSeed = Date.now();
  let seedreamBuf: Buffer;
  try {
    const seedreamPrompt = buildSeedreamPrompt(view, model);
    const seedRefs = [
      { url: await ensureSeedreamSafeUrl(STUDIO_BACKDROP_URL), label: 'STUDIO BACKDROP' },
      { url: await ensureSeedreamSafeUrl(modelCardUrl.split('?')[0]), label: 'MODEL CARD IDENTITY' },
    ];
    const seedResult = await generateSeedreamImage({
      prompt: seedreamPrompt,
      referenceImages: seedRefs,
      aspectRatio: '1:1',
    });
    seedreamBuf = seedResult.imageData;
    console.log(`  [${view}] PASS 1 ✓ ${((Date.now() - tSeed) / 1000).toFixed(1)}s — ${(seedreamBuf.length / 1024 / 1024).toFixed(1)}MB`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  [${view}] PASS 1 ✗ ${msg}`);
    return { view, error: `seedream: ${msg}` };
  }

  console.log(`  [${view}] PASS 2 (Gemini face-correction)…`);
  const tGem = Date.now();
  try {
    const geminiRefs: ReferenceImage[] = [
      {
        buffer: seedreamBuf,
        mimeType: 'image/png',
        label: 'IMAGE 1 — BODY/POSE/OUTFIT/BACKGROUND ANCHOR. Use ONLY for body proportions, pose, stance, outfit (SHIRTLESS bare chest + matte-black boxer briefs + barefoot), framing, composition, background. DO NOT copy the FACE from this image — its face has stylized artifacts (mascara-like eye darkening, harsh side lighting) that we want REMOVED. The face comes from IMAGE 2 + IMAGE 2B with clean lighting.',
      },
      {
        buffer: modelCardBuf,
        mimeType: 'image/jpeg',
        label: 'IMAGE 2 — FACE + IDENTITY REFERENCE (model card, primary face source). The rendered face has the EXACT facial features, expression, hair, and skin tone of this image. The face is regenerated fresh using this identity, with clean even soft studio lighting (no harsh shadows, no mascara look, no under-eye darkening). NOT a reference for outfit or pose.',
      },
    ];
    if (headCropBuf) {
      geminiRefs.push({
        buffer: headCropBuf,
        mimeType: 'image/png',
        label: 'IMAGE 2B — HEAD CROP / SKIN TONE ANCHOR. The rendered skin tone matches this image precisely. Use to verify complexion depth.',
      });
    }
    const geminiResult = await generateImage({
      prompt: buildGeminiFaceCorrectionPrompt(view, model),
      referenceImages: geminiRefs,
      aspectRatio: '1:1',
      imageSize: '4K',
      model: 'gemini-3-pro-image-preview',
    });
    const finalBuf = geminiResult.imageData;
    console.log(`  [${view}] PASS 2 ✓ ${((Date.now() - tGem) / 1000).toFixed(1)}s — ${(finalBuf.length / 1024 / 1024).toFixed(1)}MB`);
    return { view, seedreamBuf, finalBuf };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  [${view}] PASS 2 ✗ ${msg}`);
    return { view, seedreamBuf, error: `gemini: ${msg}` };
  }
}

async function processModel(db: Firestore, modelId: string): Promise<void> {
  console.log(`\n════════ ${modelId} (Seedream → Gemini face-fix) ════════`);
  const snap = await db.collection('models').doc(modelId).get();
  if (!snap.exists) { console.error(`  Model ${modelId} not found`); return; }
  const model = snap.data() as ModelDoc;
  console.log(`  Gender: ${model.gender}`);

  // Prep model card buffers (used across all 4 views).
  const frontCardUrl = model.referenceImageUrl || model.cardImageUrl;
  const backCardUrl = model.backReferenceImageUrl || frontCardUrl;
  if (!frontCardUrl) { console.error(`  Model has no card image`); return; }
  const frontCardBuf = await fetchBuf(frontCardUrl);
  const backCardBuf = backCardUrl === frontCardUrl ? frontCardBuf : await fetchBuf(backCardUrl);
  let frontHeadCrop: Buffer | null = null;
  try { frontHeadCrop = await buildIdentityHeadCrop(frontCardBuf); }
  catch (e) { console.warn(`  Head crop skipped: ${(e as Error).message}`); }

  // Run all 4 views in parallel (per-model parallel, but cross-model still serial).
  const results = await Promise.all(VIEWS.map(view => {
    const isBack = view === 'fullBodyBack' || view === 'legsBack';
    return processView(
      modelId, model, view,
      isBack ? backCardBuf : frontCardBuf,
      isBack ? backCardUrl! : frontCardUrl,
      frontHeadCrop, // use front head crop for both — back skin tone is same
    );
  }));

  // Upload successful renders + thumbnails + patch Firestore.
  const sharp = (await import('sharp')).default;
  const update: Record<string, string> = {};
  for (const r of results) {
    if (!r.finalBuf) { console.warn(`  ⚠ ${r.view} failed — keeping existing asset`); continue; }
    const url = await uploadGeneratedImage(`model-assets/${modelId}`, `${r.view}.png`, r.finalBuf);
    update[`assets4K_${r.view}`] = url;
    const thumbBuf = await sharp(r.finalBuf)
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
    console.log(`  ✓ ${r.view}: 4K (${(r.finalBuf.length / 1024 / 1024).toFixed(1)}MB) + thumb (${(thumbBuf.length / 1024).toFixed(0)}KB)`);
  }
  if (Object.keys(update).length > 0) {
    const now = new Date().toISOString();
    update['assets4K_updatedAt'] = now;
    update['assetsThumb_updatedAt'] = now;
    await db.collection('models').doc(modelId).update(update);
    console.log(`  ✓ Firestore updated (${Object.keys(update).length} fields)`);
  }
}

async function main() {
  const db = new Firestore();
  for (const id of args) {
    await processModel(db, id);
  }
  console.log(`\n════════ DONE: ${args.length} model(s) processed ════════`);
}

main().catch(e => { console.error(e); process.exit(1); });
