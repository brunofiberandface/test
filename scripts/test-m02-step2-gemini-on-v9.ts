/**
 * STEP 2: run the validated LEARNING #104 Gemini extend-hem-over-shoe
 * prompt on each of the 3 v9 barefoot outputs.
 *
 * Inputs per run:
 *   Image 1: v9 barefoot painted M02 (model + Judee jeans, bare feet)
 *   Image 2: shoe back/flat ref (black chunky platform loafer)
 *   Image 3: layering reference (cream pant over dark sneaker — supplementary)
 *
 * Output: M02 with shoes added under the extended denim hem.
 *
 * 3 runs (one per v9 barefoot input).
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

import { generateImage } from '../src/lib/vertex';

const V9_BASES = [
  path.join(projectRoot, 'test_outputs/sole-mode/m02-lean-prompt-audit-v9/run1.png'),
  path.join(projectRoot, 'test_outputs/sole-mode/m02-lean-prompt-audit-v9/run2.png'),
  path.join(projectRoot, 'test_outputs/sole-mode/m02-lean-prompt-audit-v9/run3.png'),
];
const LOAFER_FLATBACK = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/u6L8UZmZw7PM0iHLmNCv/flat_back.jpg';
const LAYERING_REF = 'https://storage.googleapis.com/gstar-ai-studio-assets/test/reference-pant-over-shoe.png';

const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/m02-step2-gemini-on-v9');
fs.mkdirSync(OUT_DIR, { recursive: true });

const GEMINI_SHOE_PROMPT = `TASK: Add shoes to the model's feet AND extend the pant legs downward to cover the shoes. Two changes only — everything else stays identical to Image 1.

Image 1 is the base: a model wearing G-Star wide-leg jeans, standing barefoot in a studio. Preserve from Image 1:
- Model identity, skin tone, body, hair, pose, stance, arms hanging at the sides
- The jeans wash, color, fading, construction seams, back pockets with G-Star arc stitching, leather brand patch, barrel-leg silhouette
- The studio background, floor, lighting, shadows, framing

Image 2 is the shoe: add these shoes to the model's feet, replacing the bare feet.

Image 3 is a layering example showing how a pant cascades over and on top of sneakers — the pant fabric drapes down over the back of the sneaker and only the sole and back rim are visible below the cascading hem. Use Image 3 ONLY as a layering reference for the spatial relationship between pant and shoe.

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

OUTPUT: Image 1 modified so that (a) bare feet are replaced by the shoes from Image 2, and (b) the pant legs are extended downward to drape over the shoes with the hem near floor level. All other elements — model, arms, jeans construction, scene, lighting — identical to Image 1.`;

async function runOne(runIdx: number, basePath: string): Promise<void> {
  console.log(`\n=== run ${runIdx}/3 (base=${path.basename(basePath)}) ===`);
  const baseBuf = fs.readFileSync(basePath);
  const shoeResp = await fetch(LOAFER_FLATBACK);
  const shoeBuf = Buffer.from(await shoeResp.arrayBuffer());
  const shoeMime = shoeResp.headers.get('content-type') || 'image/jpeg';
  const layeringResp = await fetch(LAYERING_REF);
  const layeringBuf = Buffer.from(await layeringResp.arrayBuffer());
  const layeringMime = layeringResp.headers.get('content-type') || 'image/png';

  const t0 = Date.now();
  const result = await generateImage({
    prompt: GEMINI_SHOE_PROMPT,
    referenceImages: [
      { buffer: baseBuf, mimeType: 'image/png', label: 'IMAGE 1 — barefoot painted M02 (preserve everything except feet+hem)' },
      { buffer: shoeBuf, mimeType: shoeMime, label: 'IMAGE 2 — shoe back/flat reference' },
      { buffer: layeringBuf, mimeType: layeringMime, label: 'IMAGE 3 — layering reference (spatial-relationship guidance)' },
    ],
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const outPath = path.join(OUT_DIR, `run${runIdx}.png`);
  fs.writeFileSync(outPath, result.imageData);
  console.log(`DONE ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
}

async function main() {
  console.log(`Prompt length: ${GEMINI_SHOE_PROMPT.length} chars`);
  console.log(`Shoe ref: ${LOAFER_FLATBACK}`);
  console.log(`Layering ref: ${LAYERING_REF}`);
  for (let i = 0; i < V9_BASES.length; i++) {
    try {
      await runOne(i + 1, V9_BASES[i]);
    } catch (e) {
      console.error(`run ${i + 1} FAILED: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
