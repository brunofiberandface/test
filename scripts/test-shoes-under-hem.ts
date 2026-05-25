/**
 * NEW APPROACH: Take a barefoot CONTOR base where the hem is ALREADY in the
 * correct cascading position, and use Gemini to ADD shoes UNDER the existing
 * pant hem — preserving the hem position exactly.
 *
 * Bruno's prompt: shoes go BEHIND the existing pant fabric. Only the sole +
 * back-of-heel + small portion below the hem is visible. Pant fabric is the
 * foreground layer at the ankle.
 *
 * Gemini multi-image edit (not Seedream) — the prompt is a strict
 * preservation task ("preserve everything except bare feet").
 *
 * 3 reference images:
 *  IMAGE 1: barefoot CONTOR (existing render with correct hem cascade)
 *  IMAGE 2: AXEL ARIGATO white sneaker (shoe to add)
 *  IMAGE 3: cream-pant-over-black-sneaker (layering reference, supplementary)
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
import { generateImage } from '../src/lib/vertex';

const BASE_PATH = path.join(projectRoot, 'test_outputs/sole-mode/barefeet-single/contor_run4.png');
const SHOE_PATH = '/Users/bdheedene/Desktop/Screenshot 2026-05-21 at 21.22.13.png';
const LAYERING_PATH = '/Users/bdheedene/Desktop/Screenshot 2026-05-21 at 20.02.00.png';
const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/shoes-under-hem');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROMPT = `TASK: Add shoes to the model's feet. Do not modify anything else.

Image 1 is the base image. The model is wearing G-Star wide-leg jeans and standing barefoot. Preserve EVERYTHING in Image 1 exactly as it is, except for the bare feet:
- Model identity, skin tone, body, hair, pose, stance — unchanged
- The jeans — wash, color, fading, construction seams, back pockets, brand patch, fit, drape, every fold and wrinkle — unchanged
- THE PANT HEM POSITION — unchanged. The hem in Image 1 sits low, near the floor, draping over and partially covering the model's feet. This exact hem position must be preserved. Do not raise the hem. Do not redraw the hem. Do not change where the denim ends.
- The studio background, floor, lighting, shadows, color grading, framing — unchanged

Image 2 is the shoe reference. Add these shoes to the model's feet in Image 1, replacing the bare feet. Preserve from Image 2:
- The exact shoe model, color, materials, sole shape, and construction
- Proportions and scale appropriate to the model's foot size in Image 1

Image 3 is a layering example showing how a pant cascades over and on top of sneakers — the pant fabric drapes down over the back of the sneaker and only the sole and back rim are visible below the cascading hem. Use Image 3 ONLY as a layering reference for the spatial relationship between pant and shoe.

CRITICAL LAYERING:
The shoes go UNDER the existing pant hem. The pant fabric remains the foreground layer at the ankle. The shoes sit BEHIND the pant fabric where they meet. Only the portion of each shoe that extends below the existing pant hem in Image 1 is visible — typically the sole, the back of the heel, and a small portion of the upper that protrudes below the hem.

DO NOT lift the pant hem to reveal the shoes.
DO NOT redraw the pant hem at a higher position.
DO NOT show the full shoe upper, laces, tongue, or ankle collar — these are hidden behind the existing denim.
DO NOT modify the pant fabric in any way.

The denim in Image 1 already drapes correctly over the feet. Keep that drape exactly. Simply replace the bare feet underneath with the shoes from Image 2, occluded by the existing denim wherever they overlap.

OUTPUT: Image 1 with the bare feet replaced by the shoes from Image 2, with all other elements (model, jeans, hem position, scene) identical to Image 1.`;

async function main() {
  const baseBuf = fs.readFileSync(BASE_PATH);
  const shoeBuf = fs.readFileSync(SHOE_PATH);
  const layeringBuf = fs.readFileSync(LAYERING_PATH);
  console.log(`base ${baseBuf.length}B, shoe ${shoeBuf.length}B, layering ${layeringBuf.length}B`);
  console.log(`prompt ${PROMPT.length} chars`);

  for (let i = 1; i <= 3; i++) {
    console.log(`\n=== run ${i}/3 ===`);
    const t0 = Date.now();
    try {
      const result = await generateImage({
        prompt: PROMPT,
        referenceImages: [
          { buffer: baseBuf, mimeType: 'image/png', label: 'IMAGE 1 — base barefoot CONTOR render. Preserve everything except bare feet.' },
          { buffer: shoeBuf, mimeType: 'image/png', label: 'IMAGE 2 — AXEL ARIGATO white sneaker back view. Add this shoe under the model feet.' },
          { buffer: layeringBuf, mimeType: 'image/png', label: 'IMAGE 3 — layering reference showing pant cascading OVER sneaker. Use only for spatial-relationship guidance.' },
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
