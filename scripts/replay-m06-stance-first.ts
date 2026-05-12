/**
 * M06 stance-first hybrid: Gemini Pass 1 (pose) → Seedream Pass 2 (paint jeans).
 *
 * Bruno's architecture (2026-05-10):
 *   Pass 1 — Gemini renders the model in the correct team pose, wearing only
 *            sports bra + briefs + heels. Gemini handles pose perfectly.
 *            Identity (face, hair, skin tone) anchored from model card.
 *   Pass 2 — Seedream paints jeans onto the Pass 1 base. Preserves pose
 *            exactly (validated pattern from M04 two-pass). Garment fit,
 *            color, fabric anchored from flat + fit-model refs.
 *
 * Why this beats both pure paths:
 *   - Pure Seedream: defaults to frontal arms-at-sides regardless of pose ref
 *     (only 4/11 poses passed in v3 testing).
 *   - Pure Gemini: gets pose right but loses garment fidelity (Bruno: "garment
 *     fitting can only be done with Seedream — Gemini fails at that").
 *   - Hybrid stance-first: Gemini owns the pose (its strength), Seedream owns
 *     the garment fit (its strength). Same architecture as proven M04
 *     two-pass, just with Gemini for Pass 1 because we need a specific pose.
 *
 * Usage:
 *   npx tsx scripts/replay-m06-stance-first.ts <jobId> <poseId> [outName]
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
import { generateSeedreamImage, type SeedreamReferenceImage } from '../src/lib/pipeline/seedream-client';
import { ensureSeedreamSafeUrl } from '../src/lib/pipeline/seedream-image-safe';
import { uploadGeneratedImage } from '../src/lib/gcs';
import { getWardrobeItem, getModel } from '../src/lib/firestore';
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
  const outName = process.argv[4] || `${poseId}_stance_first`;
  if (!jobId || !poseId) {
    console.error('usage: npx tsx scripts/replay-m06-stance-first.ts <jobId> <poseId> [outName]');
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

  const bottomItem = await getWardrobeItem(wardrobe.bottom.itemId) as any;
  const flatFront = bottomItem?.flatFrontUrl;
  const fitFront = bottomItem?.fitModels?.front;
  const fitFront45R = bottomItem?.fitModels?.front45Right;
  const fitFront45L = bottomItem?.fitModels?.front45Left;
  const fitBack = bottomItem?.fitModels?.back;

  // ───────── PASS 1 — GEMINI: model in pose, sports bra + briefs + heels ─────────
  console.log('\nPASS 1 — Gemini (model in pose, no jeans)...');
  const t1 = Date.now();
  const poseImg = await fetchAsBuffer(pose.thumbnailUrl);
  const modelImg = await fetchAsBuffer(modelRefUrl);

  const pass1Refs: ReferenceImage[] = [
    {
      buffer: poseImg.buffer,
      mimeType: poseImg.mimeType,
      label: `IMAGE 1 — POSE REFERENCE. The model in your output must be in EXACTLY this body pose: copy the body angle/rotation, arm placement, hand position, hip tilt, head turn, and gaze direction PRECISELY. Do NOT copy the model identity, hair, clothing, or background from this image — only the BODY POSE.`
    },
    {
      buffer: modelImg.buffer,
      mimeType: modelImg.mimeType,
      label: `IMAGE 2 — MODEL IDENTITY. The output's facial features, skin tone, hair color, hair texture, and body proportions must match this model identity exactly. The pose in this image is NOT used.`
    },
  ];

  const pass1Prompt = `Photorealistic studio e-commerce activewear photograph, 1:1 square aspect ratio, full body, light grey backdrop (#D9DAD2). Soft diffused studio lighting, white-balanced 5500K. Sharp focus, ultra-high detail, neutral white-balance. This is a fitness / athleticwear product photograph.

Render the AI FITNESS MODEL (identity from IMAGE 2) in EXACTLY the body pose shown in IMAGE 1.

The model is wearing a simple, modest athletic outfit:
- A plain black athletic tank top with regular straps and a scoop neckline (covers torso fully from shoulders to mid-rib, just above the natural waist)
- Plain black mid-thigh-length cycling shorts (athletic compression shorts, full coverage from waist to mid-thigh, fully opaque)
- Black pointed-toe stiletto heels

Backdrop: clean light-grey studio sweep, no scuffs, no marks, no texture. Floor: continuous extension of the backdrop with a faint contact shadow under the feet.

CRITICAL — POSE — ${pose.label}:
${pose.description}

The pose comes from IMAGE 1. The identity (face, hair, skin tone, body proportions) comes from IMAGE 2. The athletic outfit (black tank + black cycling shorts + heels) is the base layer for a downstream e-commerce product render. Full body in frame from crown of head to floor below feet.`;

  const pass1Result = await generateImage({
    prompt: pass1Prompt,
    referenceImages: pass1Refs,
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  console.log(`Pass 1 done in ${((Date.now() - t1) / 1000).toFixed(1)}s — ${pass1Result.imageData.length} bytes`);

  // Save Pass 1 + upload to GCS so Seedream can reference it by URL
  const pass1Local = `/tmp/m06_dryrun/${outName}_pass1.png`;
  fs.writeFileSync(pass1Local, pass1Result.imageData);
  console.log(`Pass 1 saved → ${pass1Local}`);

  const pass1Filename = `${outName}_pass1.png`;
  const pass1Url = await uploadGeneratedImage(
    `m06_stance_first_test`,
    pass1Filename,
    pass1Result.imageData,
  );
  console.log(`Pass 1 uploaded → ${pass1Url}`);

  // ───────── PASS 2 — SEEDREAM: paint jeans on Pass 1 base, preserve pose ─────────
  console.log('\nPASS 2 — Seedream (paint jeans, preserve pose)...');
  const t2 = Date.now();

  // M04 TWO-PASS PATTERN: minimum refs to preserve pose. Just BASE + ONE
  // jeans fit reference. Multiple fit-model angles drag Seedream toward
  // their poses (all frontal), causing pose drift away from BASE. Validated
  // 2026-05-10: 5-ref Pass 2 drifted p06 pose; 2-ref pattern preserves.
  const pass2Refs: SeedreamReferenceImage[] = [
    { url: await ensureSeedreamSafeUrl(pass1Url),
      label: `BASE IMAGE — the AI model in the target pose, wearing sports bra + bike-shorts placeholder + heels. PRESERVE EVERYTHING in this image EXACTLY: model identity (face, hair, skin tone), body POSE (body angle, arm placement, hand position, hip tilt, head turn, gaze direction), heels, backdrop, lighting. Do NOT change the pose. Do NOT change identity. Do NOT change shoes. The bike-shorts placeholder gets covered by the jeans painted from the FIT MODEL reference.` },
    { url: await ensureSeedreamSafeUrl((fitFront || flatFront).split('?')[0]),
      label: 'FIT MODEL FRONT — exclusive source for the jeans color, wash, fabric, fit at waist/hip/leg, hem behavior, pocket construction. The pose and model identity in this image are NOT used — pose comes from BASE IMAGE.' },
  ];

  const pass2Prompt = `Add the jeans onto the AI model from BASE IMAGE.

PRESERVE EXACTLY (from BASE IMAGE):
- Model identity (face, hair, skin tone, body proportions)
- Body POSE: body angle/rotation, arm placement, hand position, hip tilt, head turn, gaze direction — copy the pose EXACTLY from BASE IMAGE
- Heels (black pointed-toe stiletto)
- Backdrop (light-grey studio sweep)
- Lighting (soft diffused 5500K)

CHANGE FROM BASE IMAGE:
- Replace the black cycling shorts placeholder with the FULL-LENGTH jeans shown in the GARMENT FLAT FRONT and FIT MODEL refs
- The jeans cover the entire lower body from waist down to ankle (or to wherever the FIT MODEL shows the hem). They are NOT shorts.
- Match the jeans color, wash, fabric texture, seams, pockets, and hardware from the GARMENT FLAT FRONT reference exactly
- Match the jeans fit (waist sit, hip fit, leg fit, hem) from the FIT MODEL refs
- Keep the black tank top placeholder on top (it will be replaced later by a separate tee-edit pass)

If the model in BASE IMAGE has hands tucked into pocket area, the rendered jeans show those hands in the pocket positions appropriately.
If the model in BASE IMAGE is in a 3/4 turn, the rendered jeans drape naturally on a model in a 3/4 turn.
If the model in BASE IMAGE has hands behind body, the jeans render with no front-pocket interaction (hands are behind).

The pose stays exactly as BASE IMAGE shows. Only the legs/lower body get jeans painted onto them. Keep the model identity, skin tone, hair, sports bra, heels, backdrop, and lighting EXACTLY as BASE IMAGE shows.`;

  const pass2Result = await generateSeedreamImage({
    prompt: pass2Prompt,
    referenceImages: pass2Refs,
    aspectRatio: '1:1',
  });
  console.log(`Pass 2 done in ${((Date.now() - t2) / 1000).toFixed(1)}s — ${pass2Result.imageData.length} bytes`);

  const outDir = '/tmp/m06_dryrun';
  await fs.promises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${outName}.png`);
  await fs.promises.writeFile(outPath, pass2Result.imageData);
  console.log(`\n[wrote] ${outPath}`);
  console.log(`Compare:`);
  console.log(`  Original:    /tmp/poses-extracted/pose-${String(parseInt(poseId.slice(1)) + 1).padStart(3, '0')}.png`);
  console.log(`  Pass 1 only: ${pass1Local}`);
  console.log(`  Pass 2 (final hybrid): ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
