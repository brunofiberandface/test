/**
 * Replay M05 generation for a given job, directly via Seedream-4.5.
 *
 * Runs the EXACT production code path: seedreamM05() → buildPrompt() →
 * generateSeedreamImage(). The only difference from production is that
 * the prompt content is read from a LOCAL file (or hard-coded fallback)
 * rather than the active promptVault revision — letting us dry-run a
 * candidate prompt without flipping the active flag in Firestore.
 *
 * Usage:
 *   npx tsx scripts/replay-m05.ts <jobId> [outFilename] [--prompt-file=path]
 *
 * If --prompt-file is omitted, the embedded new-pose prompt below is used.
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

import { generateSeedreamShot } from '../src/lib/pipeline/seedream-generate';
import { Firestore } from '@google-cloud/firestore';

// ── Embedded candidate M05 prompt (team-spec, lower-waist→mid-thigh, NO hands on hips) ──
const CANDIDATE_PROMPT = `Photorealistic studio e-commerce photograph, 1:1 square, BACK VIEW close-up. Tight back-pocket hero crop of the AI MODEL — the same model identity and outfit shown in the M03 ANCHOR and M04 ANCHOR references. Sharp focus, ultra-high detail, color accurate, neutral white-balanced, commercial studio quality.

### Camera & Framing — TEAM SPEC
1:1 square crop. Camera positioned close and slightly off-center, framing from roughly the LOWER WAIST DOWN TO MID-THIGH. The back-pocket area is the clear hero of the shot.

- TOP edge of frame: just below the natural waist (a thin slice of the lowest portion of the top is visible above the waistband — the rest of the upper body, shoulders, and head are OUT of frame).
- BOTTOM edge of frame: mid-thigh — knees, calves, ankles, shoes, and the floor are OUT of frame.
- Camera is slightly off-center horizontally so the subject is not perfectly dead-centered; the gentle hip tilt pushes the silhouette a few degrees off the vertical axis.
- Camera at hip-line height looking straight ahead at the back-pocket area — no upward, downward, or extreme lateral angle.
- 85–105mm equivalent lens, no wide-angle distortion.

The hero subject — both back pockets, the yoke, and the seat of the {garment_type} — fills the central portion of the square frame and is fully readable.

### Studio set & Lighting
Backdrop and (cropped) floor: EXACTLY as shown in the M03 / M04 anchor references — a clean, uniform sweep with the same tone and gradient. Do NOT introduce any backdrop variation, gradient, scuff, or surface texture that isn't already present in those anchors. Studio lighting is soft, fully diffused, white-balanced to 5500K, coming from front and slightly above eye level. Even illumination across the back-pocket area, no hard shadows.

### Skin & Body Color — CRITICAL
Any visible body skin in this M05 frame (any sliver of lower back / hip / arm at frame edge) is rendered with the SAME tone, undertone, and color temperature as the body skin in the M03/M04 anchor references. No localized color shift, no makeup-style color, no rosy tint, no peach undertone. The skin in M05 is identical in color to the skin in M03/M04 — same model, same complexion, same render. The M03 ANCHOR is the exclusive authority for the model's skin tone; the FIT MODEL refs are NOT a source for skin color, only for garment fit and pocket geometry.

### Outfit & Identity — ANCHOR-DRIVEN
The model in M05 is the same model as in M03 / M04 — exactly. Body proportions, complexion, and any visible skin matches the M03 ANCHOR.

The top garment ({top_description}) is rendered EXACTLY as it appears in the M03 / M04 anchors — same color, same fabric texture. The top sits naturally OVER the waistband. Render only the small visible portion of the top above the waistband that fits inside this M05 frame.

### Hero subject — back-pocket area
The hero is the back hip + back pocket area of the {garment_type}, framed and constructed exactly as the FIT MODEL BACK 45° RIGHT reference shows that region. Use the FIT MODEL BACK 45° RIGHT and FLAT BACK references as the source of truth for:
- The pocket construction (patch / welt / flap) and its geometry
- Stitching pattern, thread color, and any garment hardware
- The overall back-hip layout

Both back pockets are fully visible, fully readable. Hip seam, yoke, and waistband are crisp and read honestly.

### Pose — TEAM SPEC, SUBTLE NATURAL ASYMMETRY (NO HANDS ON HIPS)
The model is in a NATURAL, RELAXED back pose — NOT exaggerated, NOT a hand-on-hip stance.

Body Position:
- Weight is shifted onto ONE leg, creating a NATURAL, SUBTLE hip tilt. This gentle asymmetry adds shape and dimension to the back view, preventing it from reading as flat or static. The weight-bearing hip pushes very slightly toward the camera side, creating a soft, natural curve through the back and seat.
- The shift is SUBTLE — not exaggerated, not extreme. The garment's true fit is doing the work; the pose just adds light dimension.

Arms & Hands — CRITICAL: NO HANDS ON HIPS:
- One arm hangs naturally at the side, hand relaxed and loosely open, falling just at the outer hip — visible at the EDGE of the frame to give the shot human, bodily context.
- The other arm is either OUT OF FRAME or similarly relaxed at the opposite side.
- NO hands on hips. NO reaching. NO arms wrapping the waist. NO elbows bent outward. The arms are purely secondary and must NOT compete with the back-pocket focal point.

Lower Body:
- Both feet grounded, pointing forward or at a very slight outward angle.
- NO exaggerated stance — legs close to hip-width, relaxed and natural.
- The subtle weight shift does all the work in the lower body — no wide stance, no crossed legs, no stride.

Torso & Posture:
- Spine upright and elongated — no arching of the lower back, no pushing the seat outward artificially.
- Natural and neutral posture, allowing the true fit and shape of the waistband and back pocket to read honestly.
- Back of head is implied — head and shoulders are out of frame, but the body alignment continues the natural posture upward.

### CRITICAL — NO BRAND LABELS
Render the back-hip and pocket area as CLEAN unbranded garment fabric. Do NOT render any brand labels, leather patches, woven patches, embossed labels, printed labels, or any branding tag of any kind anywhere in this M05 frame.

If the silhouette description below mentions a brand label position (waistband / hip / back-pocket / etc.), DO NOT render it — that label is composited onto the final image by a separate post-generation pipeline step. Render the surface where the label would sit as clean unbroken garment fabric.

If the fit-model reference photos show a brand label visible on the garment, DO NOT reproduce it — those are reference for fit and pocket geometry only, not for label rendering.

The waistband, hip, pocket surface, and any other place where a label might normally appear are all rendered as plain garment fabric with no labels, no patches, and no branding.

{silhouette}

### Final environment
The studio set is rendered fresh and uncluttered — matching the M03 / M04 anchors exactly.`;

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
  const jobId = args[0];
  const outName = args[1] || `${jobId}_M05_dryrun`;
  const promptFileFlag = flags.find(f => f.startsWith('--prompt-file='));
  const promptFile = promptFileFlag ? promptFileFlag.split('=')[1] : null;

  if (!jobId) {
    console.error('usage: npx tsx scripts/replay-m05.ts <jobId> [outFilename] [--prompt-file=path]');
    process.exit(1);
  }

  const generationPrompt = promptFile
    ? fs.readFileSync(promptFile, 'utf-8')
    : CANDIDATE_PROMPT;
  console.log(`prompt source: ${promptFile || '(embedded candidate)'}  (${generationPrompt.length} chars)`);

  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const jobDoc = await db.collection('jobs').doc(jobId).get();
  if (!jobDoc.exists) { console.error(`job ${jobId} not found`); process.exit(2); }
  const job = jobDoc.data() as any;
  console.log(`job: ${job.jobName || jobId}`);
  console.log(`focus: ${job.focusName || job.focusDesignNumber || '?'}`);
  console.log(`m03Anchor: ${job.m03AnchorUrl ? 'yes' : 'NO'}`);
  console.log(`m04Anchor: ${job.m04AnchorUrl ? 'yes' : 'NO'}`);

  const wardrobe = job.wardrobe;
  if (!wardrobe?.bottom?.itemId) { console.error('job has no bottom — required for M05'); process.exit(3); }
  const modelId = job.modelId || (job.modelIds && job.modelIds[0]);
  if (!modelId) { console.error('no modelId on job'); process.exit(4); }

  // M05 pulls silhouette from the bottom item (always, per the bug fix)
  const focusDoc = await db.collection('wardrobe').doc(wardrobe.bottom.itemId).get();
  const focusItem = focusDoc.data() as any;
  const silhouetteBack: string = focusItem?.silhouetteBack || '';
  const silhouetteFront: string = focusItem?.silhouetteFront || '';
  console.log(`silhouetteBack: ${silhouetteBack.length} chars`);

  if (process.env.DRY_RUN) { console.log('[DRY_RUN] skipping Seedream call'); return; }

  // Build production-shape context
  const ctx: any = {
    wardrobe,
    modelId,
    silhouette: { front: silhouetteFront, back: silhouetteBack },
    m03AnchorUrl: job.m03AnchorUrl,
    m04AnchorUrl: job.m04AnchorUrl,
  };

  const prompt = {
    generationPrompt,
    silhouettePrompt: null,
    revision: 999,  // synthetic — for log line only
    shotType: 'M05' as const,
  };

  console.log(`\n[replay] calling seedreamM05 production path...`);
  const t0 = Date.now();
  const result = await generateSeedreamShot('M05', ctx, prompt as any);
  console.log(`[replay] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.imageData.length} bytes`);

  const outDir = '/tmp/m05_replay';
  await fs.promises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${outName}.png`);
  await fs.promises.writeFile(outPath, result.imageData);
  console.log(`[wrote] ${outPath}`);
  console.log(`\nCompare to current production M05: ${job.jobName ? `output/${job.jobName}/${modelId}_M05_v*.png` : '?'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
