/**
 * Hybrid M06: Seedream first (garment + identity + fit), then Gemini pose-fix.
 *
 * Step 1 — Seedream M06 produces a frontal arms-at-sides render with correct
 *           garment color, fabric, fit, drape, identity, hair, and shoes.
 *           This is what Seedream is good at. Pose is wrong but everything
 *           else is locked.
 * Step 2 — Gemini takes (Seedream output + team pose reference) and re-poses
 *           the model. Prompt locks every other aspect: "preserve garment,
 *           identity, hair, shoes, lighting, backdrop EXACTLY — only change
 *           body angle, arm placement, hand position, head turn".
 *
 * Trade-off vs pure Seedream: 2 generation passes (60s + 60s ≈ 2 min total)
 *   vs 1 pass (60s). Cost: ~$0.05/image vs ~$0.012. Pose accuracy: dramatic
 *   improvement on rotation poses (validated on p06 vs Seedream-only).
 *
 * Trade-off vs pure Gemini: garment fidelity preserved (Bruno: "garment
 *   fitting can only be done with Seedream — Gemini fails at that").
 *
 * Reads the Seedream output from /tmp/m06_dryrun/<poseId>.png if it exists,
 * otherwise generates it fresh via the production seedreamM06 path.
 *
 * Usage:
 *   npx tsx scripts/replay-m06-hybrid.ts <jobId> <poseId> [outName]
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
import { Firestore } from '@google-cloud/firestore';
import { getM06Pose } from '../src/lib/m06-poses';

async function fetchAsBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  const arr = await r.arrayBuffer();
  return { buffer: Buffer.from(arr), mimeType: r.headers.get('content-type') || 'image/jpeg' };
}

async function main() {
  const jobId = process.argv[2];
  const poseId = process.argv[3];
  const outName = process.argv[4] || `${poseId}_hybrid`;
  if (!jobId || !poseId) {
    console.error('usage: npx tsx scripts/replay-m06-hybrid.ts <jobId> <poseId> [outName]');
    process.exit(1);
  }

  const pose = getM06Pose(poseId);
  console.log(`pose: ${pose.id} — ${pose.label}`);

  // Step 1: get the Seedream M06 output (re-use if already on disk)
  const seedreamPath = `/tmp/m06_dryrun/${poseId}.png`;
  if (!fs.existsSync(seedreamPath)) {
    console.error(`Seedream output not found at ${seedreamPath} — run replay-m06.ts first`);
    process.exit(2);
  }
  const seedreamBuf = fs.readFileSync(seedreamPath);
  console.log(`Step 1: Seedream output loaded (${seedreamBuf.length} bytes from ${seedreamPath})`);

  // Step 2: Gemini pose-fix
  console.log('Step 2: Gemini pose-fix pass...');
  const poseImg = await fetchAsBuffer(pose.thumbnailUrl);

  const refs: ReferenceImage[] = [
    {
      // IMAGE 1 — Seedream output (the dominant source for everything except pose)
      buffer: seedreamBuf,
      mimeType: 'image/png',
      label: `IMAGE 1 — BASE RENDER. This is the AI MODEL with the correct garment, jeans color, fabric texture, fit, drape, hair, identity, skin tone, footwear, sports bra placeholder top, lighting, and backdrop. Preserve EVERYTHING in this image EXACTLY in your output: same model identity, same skin tone, same jeans color and wash, same denim fabric texture, same fit at the waist and through the leg, same hem, same shoes, same backdrop, same lighting. The ONLY thing to change from this image is the BODY POSE.`
    },
    {
      // IMAGE 2 — pose ref
      buffer: poseImg.buffer,
      mimeType: poseImg.mimeType,
      label: `IMAGE 2 — POSE REFERENCE. The model in your output must be in EXACTLY this body pose: copy the body angle / rotation relative to camera, the arm placement, the hand position (in pocket / on hip / hidden behind back / etc.), the elbow angles, the hip tilt, the head turn, and the gaze direction. Match this pose precisely. Do NOT copy the model identity, hair, clothing, or background from this image — those come from IMAGE 1.`
    },
  ];

  const finalPrompt = `Photorealistic studio e-commerce photograph, 1:1 square aspect ratio, full body. Re-pose the AI MODEL from IMAGE 1 (BASE RENDER) into the body pose shown in IMAGE 2 (POSE REFERENCE).

WHAT TO PRESERVE EXACTLY (copy from IMAGE 1):
- Model identity: face, hair color, hair length, hair texture, skin tone, complexion, body proportions
- Garment: jeans color, wash, fabric texture, fit at waist, fit through hip, fit through leg, hem, length, denim drape
- Top: black sports bra placeholder
- Footwear: black pointed heels
- Backdrop: clean light-grey studio sweep, no scuffs or texture
- Floor surface and contact shadow
- Lighting: soft diffused 5500K, even illumination

WHAT TO CHANGE (copy from IMAGE 2):
- Body angle / rotation relative to camera (frontal vs 3/4 vs side profile)
- Arm placement (at sides vs in pockets vs on hips vs behind back)
- Hand position (which hand goes where — in front pocket / back pocket / on hip / hidden behind body)
- Elbow angles (out vs at sides)
- Hip tilt
- Head turn (facing camera vs over shoulder)
- Gaze direction (at lens vs upward vs over shoulder)

POSE TARGET — ${pose.label}:
${pose.description}

CRITICAL: this is a re-pose, NOT a re-render. The garment in your output must be visibly the same pair of jeans as in IMAGE 1 — same color, same wash, same fabric, same fit. The model must be visibly the same person. Only the body posture changes. Do NOT regenerate the garment from scratch. Do NOT change the jeans color or texture. Do NOT change the model's hair or skin tone. Do NOT change the shoes.

If IMAGE 2 shows the model with hands behind the back, your output's model has hands behind the back wearing the SAME jeans as IMAGE 1.
If IMAGE 2 shows a 3/4 turn, your output's model is in a 3/4 turn wearing the SAME jeans as IMAGE 1.

The pose comes from IMAGE 2. Everything else comes from IMAGE 1.`;

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
