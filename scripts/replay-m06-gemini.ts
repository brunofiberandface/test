/**
 * Test M06 generation via Gemini-3-pro-image-preview (instead of Seedream).
 *
 * Why: Seedream defaults to frontal arms-at-sides regardless of the pose
 * reference image (validated on 11/11 dry-runs 2026-05-10). Gemini's true
 * multi-image fusion handles "render person from Image A in pose from Image B"
 * better in principle. This script proves/disproves that.
 *
 * Same job fixtures (Kate Boyfriend Jeans 62 / F9 Tia), same refs + same
 * prompt structure as the Seedream M06 path, just routed through Gemini.
 *
 * Usage:
 *   npx tsx scripts/replay-m06-gemini.ts <jobId> <poseId> [outName]
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
import { M06_POSES, getM06Pose } from '../src/lib/m06-poses';

async function fetchAsBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  const arr = await r.arrayBuffer();
  const buffer = Buffer.from(arr);
  const ct = r.headers.get('content-type') || 'image/jpeg';
  return { buffer, mimeType: ct };
}

async function main() {
  const jobId = process.argv[2];
  const poseId = process.argv[3];
  const outName = process.argv[4] || `${jobId}_M06_${poseId}_GEMINI`;
  if (!jobId || !poseId) {
    console.error('usage: npx tsx scripts/replay-m06-gemini.ts <jobId> <poseId> [outName]');
    process.exit(1);
  }
  const pose = getM06Pose(poseId);
  console.log(`pose: ${pose.id} — ${pose.label}`);

  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const jobDoc = await db.collection('jobs').doc(jobId).get();
  if (!jobDoc.exists) { console.error(`job ${jobId} not found`); process.exit(2); }
  const job = jobDoc.data() as any;
  console.log(`job: ${job.jobName || jobId}`);

  const wardrobe = job.wardrobe;
  const modelId = job.modelId;
  const model = await getModel(modelId) as any;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;
  if (!modelRefUrl) throw new Error('no model ref url');

  // Pull bottom (focus) item
  const bottomItem = await getWardrobeItem(wardrobe.bottom.itemId) as any;
  const flat = bottomItem?.flatFrontUrl;
  const angles = [
    bottomItem?.fitModels?.front,
    bottomItem?.fitModels?.front45Right,
    bottomItem?.fitModels?.front45Left,
  ].filter(Boolean);

  console.log('Fetching reference images...');
  const refs: ReferenceImage[] = [];

  // Pose ref (slot 0) — primary visual anchor. Skipped for poses where the
  // team-PDF reference shows a strong back/profile rotation but we want a
  // frontal output (e.g. p04, p10) — the image overrides FRONTAL text
  // instructions, so we drop it and rely on text-only.
  if (!pose.skipPoseRefImage) {
    const poseImg = await fetchAsBuffer(pose.thumbnailUrl);
    refs.push({
      buffer: poseImg.buffer,
      mimeType: poseImg.mimeType,
      label: `IMAGE 1 — POSE REFERENCE. The model in IMAGE 1 is a DIFFERENT PERSON whose pose is the target. Copy from IMAGE 1 ONLY: body angle/rotation degree, arm placement, hand position (which hand is where), head direction, head turn over shoulder, gaze direction (at camera vs upward vs over shoulder), hip tilt, weight shift, asymmetry. Do NOT copy from IMAGE 1: identity, face, skin tone, hair color, hair length, clothing, background. The rendered model's identity is NOT IMAGE 1's identity.`
    });
  } else {
    console.log(`  pose ref IMAGE skipped (text-only) for ${pose.id}`);
  }

  // Supplementary cropped pose ref for stubborn-failure poses (p08, etc.)
  // Crops isolate the failure-mode area so Gemini can't be distracted by
  // other visual cues in the full-body shot.
  const POSE_CROP_PATHS: Record<string, { path: string; label: string }> = {
    p08: {
      path: '/tmp/poses-extracted/pose-009-crop-torso.png',
      label: `IMAGE 1B — CROPPED POSE DETAIL (upper torso only, hands HIDDEN behind body). This crop emphasizes the silhouette signature for this pose: from the front view, the model's HANDS ARE NOT VISIBLE — both arms come down from the shoulders and disappear behind the body. NO forearms, NO hands, NO wrists in front of the body. Match this exact silhouette: the rendered model's upper body silhouette must show ONLY head + shoulders + torso + upper arms going behind the body. NOT a single forearm or hand appears in front of the body.`,
    },
  };
  const cropEntry = POSE_CROP_PATHS[poseId];
  if (cropEntry && fs.existsSync(cropEntry.path)) {
    const cropBuf = fs.readFileSync(cropEntry.path);
    refs.push({ buffer: cropBuf, mimeType: 'image/png', label: cropEntry.label });
    console.log(`  + cropped ref for ${poseId}: ${cropEntry.path}`);
  }

  // Model identity (slot 1)
  const modelImg = await fetchAsBuffer(modelRefUrl);
  refs.push({
    buffer: modelImg.buffer,
    mimeType: modelImg.mimeType,
    label: `IMAGE 2 — MODEL IDENTITY (the ONLY identity source). The rendered model is the SAME PERSON as in IMAGE 2 — exact same skin tone, exact same complexion depth, exact same hair color and length, exact same hair texture, exact same facial features. If IMAGE 2 shows a Black model with short close-cropped natural hair, the rendered model is a Black model with short close-cropped natural hair — NOT a different model. The pose in IMAGE 2 is NOT the target pose; pose comes from IMAGE 1.`
  });

  // Garment flat (slot 2)
  if (flat) {
    const flatImg = await fetchAsBuffer(flat);
    refs.push({
      buffer: flatImg.buffer,
      mimeType: flatImg.mimeType,
      label: `IMAGE 3 — GARMENT FLAT. Source for the jeans' color, wash, fabric, seams, hardware, and pockets.`
    });
  }

  // Fit model angles (slots 3+)
  for (let i = 0; i < angles.length; i++) {
    const a = await fetchAsBuffer(angles[i]);
    refs.push({
      buffer: a.buffer,
      mimeType: a.mimeType,
      label: `IMAGE ${4 + i} — FIT MODEL ANGLE ${i + 1}. Source for jean fit, drape, and silhouette only. The pose and identity in this image are NOT used.`
    });
  }

  console.log(`Total refs: ${refs.length}`);

  const finalPrompt = `Photorealistic studio e-commerce photograph, 1:1 square, full body, light grey backdrop (#D9DAD2). Soft diffused studio lighting, white-balanced 5500K. Sharp focus, ultra-high detail.

═══ IDENTITY (from IMAGE 2 ONLY) ═══
The rendered model is the SAME PERSON as in IMAGE 2 — exact same skin tone, complexion depth, hair color, hair length, hair texture, facial features, and body proportions. The model in IMAGE 1 is a DIFFERENT person whose pose is being copied — the rendered model's identity does NOT take ANY attributes from IMAGE 1. If IMAGE 1's model has lighter skin or different hair, the rendered model still has IMAGE 2's exact skin tone and hair.

═══ POSE (from IMAGE 1 ONLY) ═══
The model in the rendered output is in EXACTLY the body pose shown in IMAGE 1. Specifically copy from IMAGE 1:

1. **BODY ROTATION DEGREE — literal**: If IMAGE 1 shows a strict frontal stance (body squared to camera), the rendered model is also strictly frontal — do NOT add a 3/4 turn. If IMAGE 1 shows a 30°, 45°, 60°, or 75° rotation away from camera, render that EXACT degree of rotation — do NOT soften toward frontal. Match the rotation precisely.

2. **HAND PLACEMENT — literal, no mirroring**: If IMAGE 1 shows the LEFT hand in a pocket and the RIGHT hand at the side, render the LEFT hand in the pocket and the RIGHT hand at the side. Do NOT flip or mirror. The hand-which-side-of-the-body in IMAGE 1 is exactly the hand-which-side-of-the-body in the output.

3. **HANDS HIDDEN BEHIND BODY**: If IMAGE 1 shows hands NOT visible from the front (tucked behind the body, behind the back, or hidden by the body), the rendered model's hands are also HIDDEN behind the body — only the upper arms are visible falling slightly back from the shoulders. Do NOT default to placing hands in front pockets when IMAGE 1's hands are hidden behind. Hidden means hidden.

4. **HEAD AND NECK ANGLE — copy precisely**: If IMAGE 1's model has the head turned over the shoulder back toward the camera while the body faces away, render that exact head turn — head twisted back toward camera, gaze meeting the lens, while the torso continues to face the body's diagonal direction. The head can rotate independently of the body when IMAGE 1 shows it.

5. **GAZE DIRECTION — copy precisely**: If IMAGE 1's gaze is upward and off-lens, the rendered model's gaze is upward and off-lens (chin lifted, eyes directed above and beyond the camera). If IMAGE 1's gaze is direct at lens, render direct at lens. Do NOT default to a forward-camera gaze when IMAGE 1 shows otherwise.

6. **ASYMMETRY AND WEIGHT SHIFT**: Copy any subtle asymmetry — weight on one leg, slight hip tilt, slight diagonal lean, one shoulder lower. Do NOT smooth the pose toward perfect symmetry.

═══ POSE DESCRIPTION (text reinforcement of IMAGE 1) ═══
Pose archetype: ${pose.label}
${pose.description}

═══ GARMENT (from IMAGE 3 + FIT MODEL ANGLES) ═══
The model wears the jeans shown in IMAGE 3 (GARMENT FLAT) — same color, wash, fabric, fit. The garment's drape and silhouette match the FIT MODEL ANGLES.

═══ TOP — MANDATORY (clothing isolation) ═══
The model's UPPER BODY wears ONLY a plain black athletic sports bra (basic athletic style, no logo, no detail, no print). NOTHING else on the upper body. NO t-shirt, NO long-sleeve top, NO oversized top, NO jacket, NO knit, NO cardigan, NO turtleneck, NO bomber. The arms are bare (skin showing). The midriff is bare (skin showing). The shoulders are bare (skin showing).

CLOTHING ISOLATION: The clothing visible in IMAGE 1 (POSE REFERENCE) is NOT the rendered model's clothing. IGNORE everything the IMAGE 1 model wears on the upper body — the long-sleeve, the oversized top, the bomber, the cardigan, the turtleneck, the jacket — whatever it is, do NOT reproduce it in the rendered output. The rendered upper body is bare arms + plain black sports bra ONLY. If you find yourself rendering a long-sleeve, an oversized t-shirt, a jacket, a turtleneck, or any color other than black on the upper body, the render is wrong.

═══ FOOTWEAR — MANDATORY ═══
The model ALWAYS wears black pointed-toe stiletto heels. ALWAYS render the heels at the bottom of the frame, regardless of what footwear (or no footwear) is shown in IMAGE 1. The model is NEVER barefoot. The heels are visible at the bottom of the rendered image.

═══ STUDIO ═══
Backdrop: clean light-grey studio sweep, no scuffs, no texture, no marks. Floor: continuous extension of the backdrop with a faint contact shadow under the feet.

═══ FAILURE MODES TO AVOID ═══
- WRONG: rendering a frontal arms-at-sides pose when IMAGE 1 shows a 3/4 turn or side profile.
- WRONG: rendering a different model identity (different skin tone or hair) than IMAGE 2.
- WRONG: mirroring the hands (left becoming right or right becoming left).
- WRONG: rendering hands in front pockets when IMAGE 1 shows hands hidden behind the body.
- WRONG: rendering the head facing forward when IMAGE 1 shows the head turned back over the shoulder.
- WRONG: rendering a direct camera gaze when IMAGE 1 shows the gaze upward off-lens.

The pose MUST match IMAGE 1. The identity MUST match IMAGE 2. These are non-negotiable.`;

  console.log('\nCalling Gemini...');
  const t0 = Date.now();
  const result = await generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  console.log(`Gemini done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.imageData.length} bytes`);

  const outDir = '/tmp/m06_dryrun';
  await fs.promises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${outName}.png`);
  await fs.promises.writeFile(outPath, result.imageData);
  console.log(`[wrote] ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
