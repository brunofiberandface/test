/**
 * Test M01 v2 prompt — same architecture as M02 v9 but front-view, with
 * matrix base showing SHOES (not barefoot — front view doesn't have the
 * back-view pant-over-shoe problem), and 4 garment refs (front canonical +
 * front45L + front45R + flat front).
 *
 * Refs (5):
 *   IMAGE 1: Tier-2 matrix base (F9 + black loafer, legsFront, model in
 *            placeholder pants + shoes already)
 *   IMAGE 2: fit-model front canonical
 *   IMAGE 3: fit-model front45Left
 *   IMAGE 4: fit-model front45Right
 *   IMAGE 5: garment flat-front product photo
 *
 * No Tier-1 anchor needed — M01 doesn't need the framing anchor as
 * aggressively because front-view doesn't have the bare-back risk
 * (frontal torso would show; but matrix base + shoes is the natural anchor).
 *
 * 3 runs.
 */
import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';

const F9_BLACK_LOAFER_LEGSFRONT = 'https://storage.googleapis.com/gstar-ai-studio-assets/output/qa-matrix/u6L8UZmZw7PM0iHLmNCv/F9/legsFront.jpg';
const JUDEE_FITFRONT_4K   = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/4nyMHh7ICQLrpxBX8zmP/fitmodel_04.jpg';
const JUDEE_FIT_FRONT45L  = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/4nyMHh7ICQLrpxBX8zmP/fitmodel_00.jpg';
const JUDEE_FIT_FRONT45R  = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/4nyMHh7ICQLrpxBX8zmP/fitmodel_03.jpg';
const JUDEE_FLAT_FRONT    = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/4nyMHh7ICQLrpxBX8zmP/flat_front.jpg';

const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/m01-v2-prompt');
fs.mkdirSync(OUT_DIR, { recursive: true });

// v2 prompt — mirrors the proven M02 v9 structure but front-view, with the
// matrix base wearing shoes (Tier-2). Same lock pattern: framing, body
// orientation, arms, single model.
const M01_V2_PROMPT = `Merge IMAGE 1 (AI model wearing shoes and black placeholder underwear, waist-down) with IMAGES 2-4 (fitmodel wearing the target trousers, viewed from 3 front angles: straight front, front 45° left, front 45° right) and IMAGE 5 (the garment flat-front product photo — supplementary reference for color, wash, and front-panel construction). Output = IMAGE 1 with the placeholder replaced by the trousers from IMAGES 2-5. Preserve the trousers' wash, color, fit, length, drape, hem behavior, width progression, and front-panel construction (button fly, rivets, fly stitching, front-pocket shapes, belt loops) exactly as in IMAGES 2-5 — use the multiple angles plus the flat to triangulate the true garment silhouette. Preserve IMAGE 1's exact crop: the top edge of the output frame is at the waistband level (exactly matching IMAGE 1's top edge), model centered horizontally, bottom edge just below the feet. Frame above the waistband is not rendered. Preserve model identity, anatomical body orientation (entire front of body facing the camera as in IMAGE 1), arms hanging naturally at both sides of the body (visible from the shoulders down past the hips, as in IMAGE 1), and the shoes from IMAGE 1. Render exactly ONE model.`;

async function runOne(runIdx: number): Promise<void> {
  console.log(`\n=== run ${runIdx}/3 ===`);
  const t0 = Date.now();
  const result = await generateSeedreamImage({
    prompt: M01_V2_PROMPT,
    referenceImages: [
      { url: F9_BLACK_LOAFER_LEGSFRONT, label: '' },
      { url: JUDEE_FITFRONT_4K, label: '' },
      { url: JUDEE_FIT_FRONT45L, label: '' },
      { url: JUDEE_FIT_FRONT45R, label: '' },
      { url: JUDEE_FLAT_FRONT, label: '' },
    ],
    aspectRatio: '1:1',
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const outPath = path.join(OUT_DIR, `run${runIdx}.png`);
  fs.writeFileSync(outPath, result.imageData);
  console.log(`DONE ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
}

async function main() {
  console.log(`Prompt length: ${M01_V2_PROMPT.length} chars`);
  console.log(`5 refs: matrix base (legsFront with shoes) + front canonical + front45L + front45R + flat front`);
  for (let i = 1; i <= 3; i++) {
    try {
      await runOne(i);
    } catch (e) {
      console.error(`run ${i} FAILED: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
