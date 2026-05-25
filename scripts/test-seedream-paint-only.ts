/**
 * Runs ONLY the Seedream jeans paint step on a Tier-2 legs view, using the
 * latest single-angle + single-model-lock prompt. Saves the result so we can
 * chain other tests (e.g. strip-paint) on a clean, non-twin back-jeans image.
 *
 * Usage:
 *   npx tsx scripts/test-seedream-paint-only.ts <shoeId> <modelId> <bottomItemId> <front|back>
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
import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';
import { normalizeWardrobeItem } from '../src/lib/wardrobe-compat';

const args = process.argv.slice(2);
if (args.length < 4) {
  console.error('Usage: npx tsx scripts/test-seedream-paint-only.ts <shoeId> <modelId> <bottomItemId> <front|back>');
  process.exit(1);
}
const [shoeId, modelId, bottomId, sideArg] = args;
const isBack = sideArg === 'back';
const view = isBack ? 'legsBack' : 'legsFront';

const db = new Firestore({ projectId: 'gstar-ai-studio' });

function buildJeansPaintPrompt(): string {
  return `Photorealistic studio reference photo, 1:1 SQUARE crop, 4K resolution, ${isBack ? 'BACK' : 'FRONT'} VIEW, waist-down (legs + feet) of ONE SINGLE MODEL.

═══ SINGLE-MODEL LOCK ═══
The output frame contains EXACTLY ONE model. ONE person. ONE body. Single-instance render. NOT a comparison shot. NOT a multi-angle layout. NOT two copies of the same model side-by-side. The fit-model reference image (IMAGE 3) shows the jeans on a body for FIT REFERENCE ONLY — it is NOT an instruction to render multiple instances.

═══ THIS IS A NARROW EDIT — IMAGE 1 IS YOUR BLUEPRINT ═══
The output is IMAGE 1 with ONLY the placeholder pants replaced. Every pixel of IMAGE 1 EXCEPT the placeholder pants area MUST be preserved exactly:
- Model identity (visible skin, body proportions): preserved from IMAGE 1.
- Shoes (style, colour, material, position, both feet visible): preserved 100% from IMAGE 1.
- Foot placement, stance, gap between feet, body angle: preserved from IMAGE 1.
- Background (light-grey studio sweep #D9DAD2), lighting, framing, camera angle, contact shadow: preserved from IMAGE 1.

═══ THE EDIT — REPLACE PLACEHOLDER WITH JEANS ═══
Replace ONLY the placeholder pants (hot pants on female / boxer briefs on male, from the waistband down to where the jeans hem meets the shoes) with the jeans shown in IMAGE 2:
- Jeans appearance: match IMAGE 2 exactly — colour, wash, fabric, stitching, pocket shapes, ${isBack ? 'yoke seams, back-panel construction, back-pocket geometry' : 'front pockets, fly, rivet placement'}.
- Jeans drape and length: match how IMAGE 3 shows the jeans on a body. IMAGE 3 is a FIT REFERENCE — copy the drape style onto the SAME model in IMAGE 1, NOT the model in IMAGE 3.
- Hem behaviour: fabric falls naturally over the shoes from IMAGE 1.
- Waistband: sits at the same height as the placeholder waistband in IMAGE 1.

═══ ABSOLUTELY FORBIDDEN ═══
- DO NOT render more than one model. DO NOT render the model multiple times. DO NOT render a comparison / before-after / multi-angle layout.
- DO NOT modify the shoes — they are 100% locked from IMAGE 1.
- DO NOT modify the model's skin tone, body proportions, or pose.
- DO NOT change the background, lighting, or framing.
- DO NOT add belts, socks, accessories.
- DO NOT show the model barefoot.`;
}

async function main() {
  const cellId = `${shoeId}_${modelId}`;
  console.log(`Seedream paint only: ${cellId} × ${bottomId} (${view})`);

  // 1. Cell view URL
  const cellDoc = await db.collection('qaShoeMatrix').doc(cellId).get();
  if (!cellDoc.exists) throw new Error(`Cell ${cellId} not found`);
  const cell = cellDoc.data()!;
  const matrixUrl = (cell.images?.[view] as string | undefined)?.split('?')[0];
  if (!matrixUrl) throw new Error(`Cell ${cellId} has no ${view}`);

  // 2. Jeans refs
  const bottomDoc = await db.collection('wardrobe').doc(bottomId).get();
  if (!bottomDoc.exists) throw new Error(`Bottom ${bottomId} not found`);
  const bottomItem = bottomDoc.data() as Record<string, unknown>;
  const normalized = normalizeWardrobeItem(bottomItem);
  if (!normalized) throw new Error(`Bottom ${bottomId} has no usable images`);
  const jeansFlatUrl = isBack
    ? (normalized.flatBackUrl || normalized.flatFrontUrl)
    : normalized.flatFrontUrl;
  const fm = normalized.fitModels;
  const jeansAngle = isBack ? fm.back : fm.front;
  if (!jeansFlatUrl) throw new Error(`Bottom ${bottomId} has no flat`);

  const refs = [
    {
      url: matrixUrl,
      label: `IMAGE 1 — TIER-2 BASE (${view}): the SINGLE model wearing target shoes + placeholder pants. PRESERVE every pixel except the placeholder pants. Render exactly ONE model.`,
    },
    {
      url: jeansFlatUrl,
      label: `IMAGE 2 — JEANS FLAT (${isBack ? 'back' : 'front'}): source of truth for colour, wash, fabric, stitching, pockets.`,
    },
    ...(jeansAngle ? [{
      url: jeansAngle,
      label: `IMAGE 3 — JEANS FIT-MODEL ANGLE: fit reference showing drape ON A DIFFERENT MODEL. Use ONLY for jeans fit; output renders the SAME model from IMAGE 1. Do NOT render a comparison shot.`,
    }] : []),
  ];

  console.log(`Calling Seedream with ${refs.length} refs...`);
  const t0 = Date.now();
  const result = await generateSeedreamImage({
    prompt: buildJeansPaintPrompt(),
    referenceImages: refs,
    aspectRatio: '1:1',
    apiKey: process.env.BYTEPLUS_API_KEY,
  });
  console.log(`Seedream done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${(result.imageData.length / 1024).toFixed(0)}KB`);

  const outPath = `/tmp/test-seedream-paint-${cellId}-${view}.png`;
  fs.writeFileSync(outPath, result.imageData);
  console.log(`\n✓ Output: ${outPath}`);
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
