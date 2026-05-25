/**
 * 3 more runs of the v2 extend-hem-over-shoe prompt (runs 4, 5, 6).
 * Consistency check on what looked like a working approach in runs 1-3.
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

const BASE_PATH = path.join(projectRoot, 'test_outputs/sole-mode/barefeet-single/contor_run4.png');
const SHOE_PATH = '/Users/bdheedene/Desktop/Screenshot 2026-05-21 at 21.22.13.png';
const LAYERING_PATH = '/Users/bdheedene/Desktop/Screenshot 2026-05-21 at 20.02.00.png';
const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/extend-hem-over-shoe');

const PROMPT = `TASK: Add shoes to the model's feet AND extend the pant legs downward to cover the shoes. Two changes only — everything else stays identical to Image 1.

Image 1 is the base: a model wearing G-Star wide-leg jeans, standing barefoot in a studio. Preserve from Image 1:
- Model identity, skin tone, body, hair, pose, stance
- The jeans wash, color, fading, construction seams, back pockets with G-Star arc stitching, leather brand patch, barrel-leg silhouette
- The studio background, floor, lighting, shadows, framing

Image 2 is the shoe: white Axel Arigato low-top sneakers. Add these shoes to the model's feet, replacing the bare feet.

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

async function main() {
  const baseBuf = fs.readFileSync(BASE_PATH);
  const shoeBuf = fs.readFileSync(SHOE_PATH);
  const layeringBuf = fs.readFileSync(LAYERING_PATH);

  for (let i = 4; i <= 6; i++) {
    console.log(`\n=== run ${i}/6 ===`);
    const t0 = Date.now();
    try {
      const result = await generateImage({
        prompt: PROMPT,
        referenceImages: [
          { buffer: baseBuf, mimeType: 'image/png', label: 'IMAGE 1 — base barefoot CONTOR' },
          { buffer: shoeBuf, mimeType: 'image/png', label: 'IMAGE 2 — AXEL ARIGATO white sneaker' },
          { buffer: layeringBuf, mimeType: 'image/png', label: 'IMAGE 3 — layering reference' },
        ],
        aspectRatio: '1:1',
        imageSize: '4K',
        model: 'gemini-3-pro-image-preview',
      });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      fs.writeFileSync(path.join(OUT_DIR, `run${i}.png`), result.imageData);
      console.log(`DONE ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
    } catch (e) {
      console.error(`FAILED: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
