/**
 * Test the 5 new top-focus M06 poses (t01-t05) from src/lib/m06-top-poses.ts.
 *
 * Each pose is derived from the "tops women.pdf" slide 2 (POSE TOPS / RELAXED
 * FEMININE MOVEMENT — STRAIGHT FRONT POSE). The 5 poses correspond 1:1 to the
 * 5 reference models in the slide.
 *
 * For each pose, this script:
 *  1. Loads the cropped source thumbnail from /tmp/m06_top_test/sources/source-t0N.png
 *     (rendered earlier from the PDF via pdftoppm + PIL crop).
 *  2. Loads the model card + top garment refs from a real top-focus job
 *     (default: 7mBFaFsSXvkmtAhZSb4D — Raw denim kick jacket / F16).
 *  3. Calls Gemini-3-pro-image-preview with the canonical M06 prompt
 *     ADAPTED FOR TOP-FOCUS:
 *       - Hero garment = TOP (flat front + fit-model front angles)
 *       - Bottom = incidental plain jeans (text description, no flat ref)
 *       - Pose ref = the source thumb from the slide
 *  4. Writes the output PNG to /tmp/m06_top_test/outputs/output-t0N.png.
 *
 * Usage:
 *   npx tsx scripts/test-m06-top-poses.ts <poseId> [jobId]
 *   npx tsx scripts/test-m06-top-poses.ts all       # render all 5 sequentially
 */
import * as path from 'path';
import * as fs from 'fs';

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

import { generateImage, type ReferenceImage } from '../src/lib/vertex';
import { getWardrobeItem, getModel } from '../src/lib/firestore';
import { Firestore } from '@google-cloud/firestore';
import { M06_TOP_POSES, getM06TopPose } from '../src/lib/m06-top-poses';

const DEFAULT_JOB_ID = '7mBFaFsSXvkmtAhZSb4D';  // Raw denim kick jacket / F16
const SOURCES_DIR = '/tmp/m06_top_test/sources';
const OUTPUTS_DIR = '/tmp/m06_top_test/outputs';
const IDENTITY_HEAD_PATH = '/tmp/m06_top_test/identity/F16-head.png';

// Explicit identity attributes for F16 ("Cara"), surfaced into the prompt
// because Gemini was conflating IMAGE 1's pose-model hair/skin into the
// rendered output even when IMAGE 2 was the only identity ref. Spelling out
// the exact attributes turns the identity into text constraints rather than
// "infer-from-IMAGE-2" guidance.
const IDENTITY_ATTRS = {
  modelId: 'F16',
  name: 'Cara',
  hair: 'long platinum white-blonde hair, parted in the middle, falling straight to mid-chest length with subtle natural waves — NOT yellow-blonde, NOT golden, NOT brown, NOT short, NOT curly',
  skin: 'very fair, pale, cool undertone — porcelain complexion — NOT olive, NOT medium, NOT tan, NOT dark',
  eyes: 'pale blue-grey eyes',
  build: 'slim, slight build with long elegant neck',
  face: 'high cheekbones, straight slim nose, soft jawline, natural unsmiling expression',
};

async function fetchAsBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  const arr = await r.arrayBuffer();
  return { buffer: Buffer.from(arr), mimeType: r.headers.get('content-type') || 'image/jpeg' };
}

async function renderPose(poseId: string, jobId: string): Promise<string> {
  const pose = getM06TopPose(poseId);
  console.log(`\n═══ ${pose.id} — ${pose.label} ═══`);

  // Load BODY-ONLY source thumb (the slide model with head cropped off) as
  // the POSE REFERENCE. Head-cropping the pose ref eliminates the identity-
  // bleed failure mode where Gemini was copying the slide model's hair/skin
  // into the rendered output even though IMAGE 2 (F16) was supposed to be
  // the only identity source. Full-source thumbs remain in /sources/ for the
  // comparison PDF, but Gemini only sees the body-cropped variant.
  const sourcePath = path.join(SOURCES_DIR, `source-${pose.id}-body.png`);
  if (!fs.existsSync(sourcePath)) throw new Error(`source body thumb missing: ${sourcePath}`);
  const sourceBuf = fs.readFileSync(sourcePath);

  // Load job + model + top garment
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });
  const jobDoc = await db.collection('jobs').doc(jobId).get();
  if (!jobDoc.exists) throw new Error(`job ${jobId} not found`);
  const job = jobDoc.data() as any;
  console.log(`  job: ${job.jobName || jobId}  model=${job.modelId}`);

  const model = await getModel(job.modelId) as any;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;
  if (!modelRefUrl) throw new Error('no model ref url');

  // Pull TOP (focus) item
  const topConfig = job.wardrobe?.top;
  if (!topConfig?.itemId) throw new Error('no top item in wardrobe');
  const topItem = await getWardrobeItem(topConfig.itemId) as any;
  if (!topItem) throw new Error(`top item not found: ${topConfig.itemId}`);
  const topName = topItem.name || 'top garment';
  const topDescription = topItem.topDescription || topItem.description || topName;
  const topFlat = topItem.flatFrontUrl || topItem.imageUrl;
  const topAngles = [
    topItem?.fitModels?.front,
    topItem?.fitModels?.front45Right,
    topItem?.fitModels?.front45Left,
  ].filter(Boolean) as string[];
  console.log(`  top: "${topName}" — flat=${!!topFlat} angles=${topAngles.length}`);

  // Build refs
  const refs: ReferenceImage[] = [];

  // Slot 0: BODY-ONLY POSE REFERENCE (slide model with head cropped off)
  refs.push({
    buffer: sourceBuf,
    mimeType: 'image/png',
    label: `IMAGE 1 — POSE REFERENCE (BODY ONLY — head cropped off so identity cannot bleed from this image). The body in IMAGE 1 belongs to a DIFFERENT model whose POSE is the target. Copy from IMAGE 1 ONLY: body angle (front-facing), shoulder line, arm placement, hand placement (in-pocket vs at-side), elbow position, weight shift / hip tilt. Do NOT copy from IMAGE 1: skin tone, the specific top garment shown, background, lighting. IMAGE 1 has NO HEAD intentionally — the rendered model's head, face, hair, and skin tone come EXCLUSIVELY from IMAGE 2 and IMAGE 2B.`,
  });

  // Slot 0B: CROPPED HAND-DETAIL POSE REFERENCE (t01 / t02 only).
  // 2026-05-12 ITERATION: t01/t02 (hands hanging at sides) failed on the
  // first round — Gemini defaults to hands-in-pockets for top-focus + jeans
  // e-com renders, overriding the pose ref. Mirror of the p08 workaround
  // (POSE_CROP_PATHS in replay-m06-gemini.ts): inject a cropped torso/hip
  // band that isolates the failure-mode signature so Gemini can't ignore it.
  const HANDCROP_POSES = new Set(['t01', 't02']);
  if (HANDCROP_POSES.has(pose.id)) {
    const handcropPath = path.join(SOURCES_DIR, `source-${pose.id}-handcrop.png`);
    if (fs.existsSync(handcropPath)) {
      refs.push({
        buffer: fs.readFileSync(handcropPath),
        mimeType: 'image/png',
        label: `IMAGE 1B — CROPPED POSE DETAIL (torso + hip + hand area only). This crop isolates the silhouette signature for ${pose.id}: BOTH HANDS HANG FREELY AT THE SIDES OF THE BODY — neither hand is in a pocket, both hands are visible at hip level with fingers showing. Match this exact silhouette in the rendered output: arms drop down past the hips, hands visible in front of the upper thighs, fingers gently curled, ZERO pocket interaction. If you find yourself rendering a thumb hooked over a pocket or a hand tucked inside, you are violating IMAGE 1B — the hands in IMAGE 1B are clearly outside the pockets, hanging.`,
      });
      console.log(`  + handcrop ref for ${pose.id}: ${handcropPath}`);
    }
  }

  // Slot 1: model identity (full card)
  const modelImg = await fetchAsBuffer(modelRefUrl);
  refs.push({
    buffer: modelImg.buffer,
    mimeType: modelImg.mimeType,
    label: `IMAGE 2 — MODEL IDENTITY (the ONLY full-body identity source). The rendered model is the SAME PERSON as in IMAGE 2 — exact same skin tone, complexion, hair color, hair length, hair texture, facial features, body proportions. The pose in IMAGE 2 is NOT the target pose; pose comes from IMAGE 1.`,
  });

  // Slot 1B: cropped IDENTITY ANCHOR (head + shoulders crop of the model
  // card). The full card (IMAGE 2) is a head-to-toe shot — when Gemini
  // composes the multi-image fusion, the face/hair signal can be diluted
  // against the larger body. A tight head crop reinforces the identity
  // anchor at exactly the resolution Gemini needs to match facial features
  // and hair. Identity-bleed fix 2026-05-12: paired with the head-cropped
  // pose ref (IMAGE 1) so the only face/hair signal in the entire ref
  // bundle comes from IMAGE 2 + IMAGE 2B.
  if (fs.existsSync(IDENTITY_HEAD_PATH)) {
    refs.push({
      buffer: fs.readFileSync(IDENTITY_HEAD_PATH),
      mimeType: 'image/png',
      label: `IMAGE 2B — IDENTITY ANCHOR (head + shoulders crop, same person as IMAGE 2). This is the SAME MODEL as IMAGE 2, cropped tight on the face + hair + neckline so the identity signal is unambiguous. The rendered model's FACE must match IMAGE 2B: same eye shape, same nose, same lip shape, same jawline. The rendered model's HAIR must match IMAGE 2B exactly: same color, same length, same parting, same texture. If IMAGE 2B shows long platinum white-blonde straight hair to mid-chest, the rendered model has long platinum white-blonde straight hair to mid-chest — NOT short, NOT curly, NOT golden, NOT brown.`,
    });
    console.log(`  + identity anchor ref (head crop)`);
  }

  // Slot 2: TOP garment flat (the HERO garment for top-focus M06)
  if (topFlat) {
    const flatImg = await fetchAsBuffer(topFlat);
    refs.push({
      buffer: flatImg.buffer,
      mimeType: flatImg.mimeType,
      label: `IMAGE 3 — TOP GARMENT FLAT (the HERO GARMENT). This is the EXACT top the rendered model wears — same color, fabric, neckline/collar, sleeves, hem, fit, buttons/zippers. The garment in IMAGE 1 is NOT the target garment — use ONLY IMAGE 3 + 4 for the top.`,
    });
  }

  // Slots 3+: TOP fit-model angles
  for (let i = 0; i < topAngles.length && i < 3; i++) {
    const a = await fetchAsBuffer(topAngles[i]);
    refs.push({
      buffer: a.buffer,
      mimeType: a.mimeType,
      label: `IMAGE ${4 + i} — TOP FIT MODEL ANGLE ${i + 1}. Source for the top garment's fit, drape, shoulder fit, sleeve cap, hem length on body. Pose and identity here are NOT used.`,
    });
  }

  // Final prompt
  const finalPrompt = `Photorealistic studio e-commerce photograph, 1:1 square, full body, light grey backdrop (#D9DAD2). Soft diffused studio lighting, white-balanced 5500K. Sharp focus, ultra-high detail.

═══ IDENTITY (from IMAGE 2 + IMAGE 2B + explicit attributes below) ═══
The rendered model is the SAME PERSON as in IMAGE 2 and IMAGE 2B — confirmed by these EXPLICIT attributes (non-negotiable):

  • HAIR: ${IDENTITY_ATTRS.hair}
  • SKIN: ${IDENTITY_ATTRS.skin}
  • EYES: ${IDENTITY_ATTRS.eyes}
  • BUILD: ${IDENTITY_ATTRS.build}
  • FACE: ${IDENTITY_ATTRS.face}

IDENTITY ISOLATION: IMAGE 1 (POSE REFERENCE) is BODY-ONLY — the head is intentionally cropped off because IMAGE 1's model is a DIFFERENT person whose identity must NOT appear in the rendered output. Even though IMAGE 1 has no head, you must NOT invent a head based on IMAGE 1's body type or skin tone — the head comes EXCLUSIVELY from IMAGE 2 + IMAGE 2B and the explicit attributes above. If IMAGE 1's body suggests a dark-skinned curly-haired model, the rendered model is STILL platinum-blonde + pale-skin per IMAGE 2B. Same for any other implied identity from IMAGE 1.

The rendered model's hair color, hair length, hair texture, skin tone, eye color, facial features, and body build ALL come from IMAGE 2 + IMAGE 2B + the explicit attributes — period. Zero attributes from IMAGE 1.

═══ POSE (from IMAGE 1 + text below) ═══
The model in the rendered output is in EXACTLY the body pose shown in IMAGE 1, reinforced by the text description below. Specifically:

1. **BODY FRONTAL — required**: All 5 of these poses are STRICTLY FRONT-FACING. The body is squared to the camera. No 3/4 turns, no profile, no diagonal lean above 10°. Both shoulders are visible from the front at near-equal depth. The chest faces the lens.

2. **HAND PLACEMENT — copy from IMAGE 1 literally, no mirroring**: If IMAGE 1 shows BOTH HANDS at the sides (hanging), render both hands at the sides. If IMAGE 1 shows BOTH HANDS in front pockets (with thumbs hooked out), render both hands in front pockets with thumbs out. If IMAGE 1 shows BOTH HANDS DEEP IN POCKETS (no thumbs out), render both hands deep in pockets, no thumbs out. If IMAGE 1 shows ONE HAND in a pocket and the OTHER HAND at the side, render ONE in a pocket and ONE at the side — same side as IMAGE 1, no flip.

3. **WEIGHT SHIFT / HIP TILT — copy from IMAGE 1**: If IMAGE 1 shows a clear weight shift onto one leg with a visible hip tilt, render that exact contrapposto. If IMAGE 1 shows even weight on both legs (symmetric), render the rendered model with even weight, no hip tilt. Match the asymmetry magnitude precisely.

4. **HEAD ANGLE / GAZE — direct at camera**: All 5 poses have the head LEVEL and the eyes DIRECTED STRAIGHT INTO THE LENS. Render the rendered model with chin neutral and a direct, confident gaze at the camera. Expression relaxed and unsmiling, with energy through the eyes.

5. **SHOULDERS — relaxed**: Shoulders relaxed and level (with a hair of asymmetry if the IMAGE 1 weight shift implies it). Not military-stiff, not slumped.

6. **FINGERS — soft**: Fingers are soft and slightly curled, never clenched, never pointing, never rigid. Per the team brief: "Keep fingers soft, posture firm but casual."

═══ POSE DESCRIPTION (text reinforcement of IMAGE 1) ═══
Pose archetype: ${pose.label} (${pose.id})
${pose.description}

═══ TOP GARMENT — THE HERO (from IMAGE 3 + IMAGE 4-onward) ═══
The model's UPPER BODY wears the TOP shown in IMAGE 3 (FLAT FRONT) and IMAGE 4+ (FIT MODEL ANGLES). This is the focal garment — render it with maximum fidelity.

Top description (reinforcement): ${topDescription}

Match the top exactly: color, fabric, neckline/collar, sleeves, hem position on body, fit profile (slim/regular/oversized), all hardware (buttons, zippers, snaps), any branding or labels visible in IMAGE 3.

CRITICAL — the top in IMAGE 1 (POSE REFERENCE) is NOT the target top. IGNORE the top garment shown in IMAGE 1. The rendered model's top is the garment in IMAGE 3 + IMAGE 4+, period.

═══ BOTTOM (incidental — minimal interference) ═══
The model wears plain medium-wash blue denim jeans (straight-leg or relaxed-straight fit). The jeans are NOT the focus and should NOT distract from the top. No bold wash, no rips, no distress, no embellishments — a clean, neutral mid-blue denim. The waistband sits at natural waist or just below. The jeans extend below the bottom of the frame OR are cropped at upper-thigh (since this is a top-focus shot, the lower body may be partially or fully cropped from the frame — the framing should prioritize the top).

═══ FRAMING ═══
Top-focus framing: the TOP garment must occupy the visual center of the frame and be fully visible from neckline to hem. The head is visible at top. The lower body (jeans) may extend below the frame or be cropped at upper-thigh — whatever framing presents the TOP most clearly. Default to: head visible at top, top garment fully visible, jeans cropped at upper-thigh or mid-thigh.

═══ STUDIO ═══
Backdrop: clean light-grey studio sweep (#D9DAD2), no scuffs, no texture, no marks. Floor: continuous extension of the backdrop with a faint contact shadow under the feet. Soft diffused 5500K lighting, even illumination across the body, no harsh shadows.

═══ FAILURE MODES TO AVOID ═══
- WRONG: rendering the top from IMAGE 1 (the pose reference top) instead of the top from IMAGE 3.
- WRONG: any hair color other than ${IDENTITY_ATTRS.hair.split(',')[0]} — NOT golden-blonde, NOT brown, NOT black, NOT red, NOT short hair, NOT curly hair.
- WRONG: any skin tone other than ${IDENTITY_ATTRS.skin.split(',')[0]} — NOT olive, NOT medium, NOT tan, NOT dark.
- WRONG: a different model identity (any face/hair/skin attribute) than IMAGE 2 + IMAGE 2B.
- WRONG: mirroring the hands (left becoming right).
- WRONG: a 3/4 turn or profile — all 5 of these poses are FRONTAL.
- WRONG: head turned over the shoulder — these poses look STRAIGHT INTO THE CAMERA.
- WRONG: clenched fists or rigid fingers — fingers are soft.
- WRONG: any expression other than relaxed-confident — no smile, no glare.
- WRONG: distracting bottom garment (bright wash, rips, embellishments) that competes with the top.
${HANDCROP_POSES.has(pose.id) ? `
═══ ADDITIONAL FAILURE MODES FOR ${pose.id} (HANDS AT SIDES) ═══
- ABSOLUTELY WRONG: any hand inside a front pocket. The front pockets are EMPTY.
- ABSOLUTELY WRONG: any thumb hooked over a pocket edge.
- ABSOLUTELY WRONG: any wrist tucked behind a pocket opening.
- ABSOLUTELY WRONG: any knuckle visible inside a pocket.
- ABSOLUTELY WRONG: hands hidden behind the body.
- ABSOLUTELY WRONG: hands clasped in front.
- ABSOLUTELY WRONG: any hand-in-pocket gesture whatsoever.
- REQUIRED: BOTH hands clearly VISIBLE, hanging at the SIDES of the body, in front of the upper thighs, fingers SHOWING.
- This is the #1 failure mode to avoid for ${pose.id}. The signature of this pose is HANDS HANGING DOWN AT THE SIDES — match IMAGE 1 + IMAGE 1B literally.
` : ''}
The pose MUST match IMAGE 1 + text. The identity MUST match IMAGE 2. The top MUST match IMAGE 3 + IMAGE 4+. These are non-negotiable.`;

  console.log(`  refs: ${refs.length}, prompt: ${finalPrompt.length} chars`);
  console.log(`  Calling Gemini-3-pro-image-preview...`);
  const t0 = Date.now();
  const result = await generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.imageData.length} bytes`);

  await fs.promises.mkdir(OUTPUTS_DIR, { recursive: true });
  const outPath = path.join(OUTPUTS_DIR, `output-${pose.id}.png`);
  await fs.promises.writeFile(outPath, result.imageData);
  console.log(`  [wrote] ${outPath}`);
  return outPath;
}

async function main() {
  const arg = process.argv[2];
  const jobId = process.argv[3] || DEFAULT_JOB_ID;

  if (!arg) {
    console.error('usage: npx tsx scripts/test-m06-top-poses.ts <t01..t05|all> [jobId]');
    process.exit(1);
  }

  if (arg === 'all') {
    // Sequential to be polite to the API; switch to Promise.all if rate-limit permits
    for (const pose of M06_TOP_POSES) {
      try {
        await renderPose(pose.id, jobId);
      } catch (e) {
        console.error(`  FAIL ${pose.id}:`, (e as Error).message);
      }
    }
  } else {
    await renderPose(arg, jobId);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
