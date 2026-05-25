/**
 * Standalone end-to-end test of the NEW M02 pipeline.
 *
 * Inputs:
 *   - Tier-1 barefoot legsBack base (F9 model)
 *   - Bottom fit-model back at 4K (Judee — backfilled in this session)
 *   - Shoe flat-back ref (black leather chunky loafer)
 *
 * Steps:
 *   1. Seedream paint Judee jeans onto barefoot base
 *      (using NEW lean + SINGLE-MODEL LOCK + FRAMING LOCK prompt)
 *      → barefoot model with jeans cascading to floor
 *   2. Gemini extend-hem-over-shoe (LEARNING #104 prompt)
 *      → final M02 with shoes UNDER the extended denim
 *
 * (Tee strip-paint is skipped here — separate concern, the matrix-paint
 *  module already handles that step before the new shoe step.)
 *
 * 3 runs per step to check consistency.
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
import { generateImage } from '../src/lib/vertex';

const F9_TIER1_LEGSBACK = 'https://storage.googleapis.com/gstar-ai-studio-assets/output/model-assets/F9/legsBack.png';
const JUDEE_FITBACK_4K   = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/4nyMHh7ICQLrpxBX8zmP/fitmodel_05.jpg';
const LOAFER_FLATBACK   = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/u6L8UZmZw7PM0iHLmNCv/flat_back.jpg';

const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/new-m02-pipeline');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── STEP 1: Seedream paint prompt (lean + locks) ───────────────────────────
const SEEDREAM_PROMPT = `═══ SINGLE-MODEL LOCK ═══
The output frame contains EXACTLY ONE model. ONE person. ONE body. NOT a comparison shot. NOT a multi-angle layout. NOT two copies of the same model side-by-side. IMAGE 2 shows the garment on a DIFFERENT body for FIT REFERENCE ONLY — it is NOT an instruction to render multiple instances. The output renders ONLY the model from IMAGE 1.

═══ FRAMING LOCK ═══
The output frame is byte-equivalent in framing to IMAGE 1: 1:1 square, waist-down crop (from above the waistband down to just below the feet), model centered horizontally. NO head, NO upper body, NO chest visible. NO offset to the left or right. NO empty backdrop padding on the side. The model from IMAGE 1 stays in the SAME position, SAME scale, SAME crop. The studio backdrop (light-grey #D9DAD2 sweep) fills the frame as in IMAGE 1.

═══ PAINT TASK ═══
Apply the fitmodel trousers (IMAGE 2) onto the BAREFOOT AI model (IMAGE 1). Merge the two images: the trousers should be fully respected in form, fit, color, wash, construction, and length — all details preserved. IMPORTANT: the trousers run naturally down respecting the fitmodel length, with the pant hem extending to floor level over the bare feet — fabric drapes / pools as shown in IMAGE 2. The model in IMAGE 1 is barefoot — preserve the bare feet, do NOT add shoes. The model stands equally on 2 feet, 50% on each foot, keeping the SAME position and SAME framing as IMAGE 1.`;

// ── STEP 2: Gemini extend-hem-over-shoe (LEARNING #104) ────────────────────
const GEMINI_SHOE_PROMPT = `TASK: Add shoes to the model's feet AND extend the pant legs downward to cover the shoes. Two changes only — everything else stays identical to Image 1.

Image 1 is the base: a model wearing G-Star wide-leg jeans, standing barefoot in a studio. Preserve from Image 1:
- Model identity, skin tone, body, hair, pose, stance
- The jeans wash, color, fading, construction seams, back pockets with G-Star arc stitching, leather brand patch, barrel-leg silhouette
- The studio background, floor, lighting, shadows, framing

Image 2 is the shoe: add these shoes to the model's feet, replacing the bare feet.

REQUIRED MODIFICATION TO IMAGE 1 — extend the pant legs:
The pant hem in Image 1 currently ends above the ankle, with bare feet visible below. This is wrong. In the output, the pant legs must be LONGER. The denim must extend downward from where it currently ends, continuing past the ankle, past the top of the shoe, and draping down over the shoe uppers. The new hem position is near floor level — just above the sole of the shoe.

Specifically, in the output:
- The bare ankles visible in Image 1 are NOT visible — they are covered by extended denim
- The top of each shoe (the upper, the laces if any, the ankle collar) is NOT visible — covered by extended denim
- Only the lower portion of each shoe is visible: the sole, a small portion of the back heel, and the front of the toe box if it protrudes
- The denim hem sits low, near where the sole meets the floor
- The new denim extending downward matches the wash, color, and texture of the rest of the jeans exactly
- The barrel-leg silhouette continues naturally downward — the leg shape curves inward toward the new hem as it does in the upper portion of the jeans
- The fabric drapes naturally over the shoe shape, with subtle folds where the denim meets the top of the shoe

DO NOT keep the pant hem at its current position in Image 1.
DO NOT leave the shoes fully visible below a high hem.
DO NOT show the full shoe upper — most of the shoe is covered by extended denim.

The denim is the foreground layer at the foot. The shoes sit behind it. Only the sole and back-heel emerge below the hem at floor level.

OUTPUT: Image 1 modified so that (a) bare feet are replaced by the shoes from Image 2, and (b) the pant legs are extended downward to drape over the shoes with the hem near floor level. All other elements — model, jeans construction, scene, lighting — identical to Image 1.`;

async function runStep1Seedream(runIdx: number): Promise<Buffer> {
  console.log(`\n  [step1.${runIdx}] Seedream paint (Tier-1 barefoot + Judee fitback)`);
  const t0 = Date.now();
  const result = await generateSeedreamImage({
    prompt: SEEDREAM_PROMPT,
    referenceImages: [
      { url: F9_TIER1_LEGSBACK, label: '' },
      { url: JUDEE_FITBACK_4K, label: '' },
    ],
    aspectRatio: '1:1',
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const outPath = path.join(OUT_DIR, `run${runIdx}_step1_seedream.png`);
  fs.writeFileSync(outPath, result.imageData);
  console.log(`    DONE ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB → ${path.basename(outPath)}`);
  return result.imageData;
}

async function runStep2Gemini(barefootPainted: Buffer, runIdx: number): Promise<Buffer> {
  console.log(`  [step2.${runIdx}] Gemini extend-hem-over-shoe`);
  const shoeResp = await fetch(LOAFER_FLATBACK);
  const shoeBuf = Buffer.from(await shoeResp.arrayBuffer());
  const shoeMime = shoeResp.headers.get('content-type') || 'image/jpeg';
  const t0 = Date.now();
  const result = await generateImage({
    prompt: GEMINI_SHOE_PROMPT,
    referenceImages: [
      { buffer: barefootPainted, mimeType: 'image/png', label: 'IMAGE 1 — barefoot painted M02 (model + jeans, bare feet)' },
      { buffer: shoeBuf, mimeType: shoeMime, label: 'IMAGE 2 — shoe back/flat reference (black leather chunky platform loafer)' },
    ],
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const outPath = path.join(OUT_DIR, `run${runIdx}_step2_final.png`);
  fs.writeFileSync(outPath, result.imageData);
  console.log(`    DONE ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB → ${path.basename(outPath)}`);
  return result.imageData;
}

async function main() {
  console.log(`Inputs:`);
  console.log(`  base (Tier-1 F9 legsBack): ${F9_TIER1_LEGSBACK}`);
  console.log(`  garment (Judee fit-back 4K): ${JUDEE_FITBACK_4K}`);
  console.log(`  shoe (black loafer flat-back): ${LOAFER_FLATBACK}`);
  console.log(`Seedream prompt: ${SEEDREAM_PROMPT.length} chars`);
  console.log(`Gemini prompt: ${GEMINI_SHOE_PROMPT.length} chars`);

  for (let i = 1; i <= 3; i++) {
    console.log(`\n=== Run ${i}/3 ===`);
    try {
      const step1 = await runStep1Seedream(i);
      await runStep2Gemini(step1, i);
    } catch (e) {
      console.error(`Run ${i} FAILED: ${(e as Error).message}`);
    }
  }
  console.log(`\nAll runs done. Output dir: ${OUT_DIR}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
