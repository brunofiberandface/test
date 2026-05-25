/**
 * Iterate the Gemini shoe-paint prompt for better shoe visibility.
 *
 * Previous prompt (v1): "shoes peek out from under cascading hem" → Gemini
 * cascaded the hem PAST the foot, showing only toe-tips of the shoes.
 *
 * New prompt (v2): explicitly position hem AT THE TOP of the shoe. Adjust
 * the existing jeans so the hem rests on the shoe upper. Most of the shoe
 * is visible BELOW the hem. Slight natural break/cascade at the meeting
 * point, but no heavy fabric pile covering the shoes.
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

const SOURCE = path.join(projectRoot, 'test_outputs/sole-mode/barefeet-single/contor_run4.png');
const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/add-shoes-gemini-v2');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SHOES = [
  { id: 'white-sneaker', name: 'White leather low-top sneaker',
    flat: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/3xKezovO6eef7SJfMioC/360_00.jpg' },
  { id: 'grey-sneaker', name: 'Grey low-top sneaker',
    flat: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/xaVs4I5KFQKq5AEq5m6I/flat_front.jpg' },
  { id: 'brown-suede-boot', name: 'Brown suede ankle boot',
    flat: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/C0QleJPtkd58NRiHhPES/flat_front.jpg' },
];

async function fetchBuf(url: string) {
  const r = await fetch(url.split('?')[0]);
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') || 'image/jpeg' };
}

async function main() {
  console.log('Loading source render…');
  const srcBuf = fs.readFileSync(SOURCE);
  console.log(`Source: ${(srcBuf.length / 1024 / 1024).toFixed(1)}MB`);

  for (const shoe of SHOES) {
    console.log(`\n=== ${shoe.name} (${shoe.id}) ===`);
    const shoeImg = await fetchBuf(shoe.flat);

    // v2 prompt — push hem UP and make shoes mostly visible
    const prompt = `IMAGE 1 shows a back view of a model in long wide-leg jeans, currently barefoot. Paint shoes on the model's feet, AND adjust the hem of the jeans so the shoes are clearly visible underneath.

The shoes to paint are shown in IMAGE 2 — match their style, colour, material, silhouette, and proportions exactly: ${shoe.name}.

HEM POSITIONING (CRITICAL):
- The jeans hem ENDS at the TOP of the shoe — at the laces / collar / top of the shoe upper.
- The hem may have a small natural fabric break where it meets the shoe top (slight gather, light crease), but does NOT cascade past the shoe.
- MOST of the shoe is VISIBLE BELOW the hem — the entire vamp, toe box, sides, sole, and heel cup are clearly seen.
- The hem rests on the shoe like normal jeans on sneakers, not like a long dress dragging on the floor.
- ADJUST the existing hem length upward as needed so the shoes are properly visible. The existing render's hem-cascading-to-floor is too long — shorten it to rest naturally at the top of the shoe.

SHOE RENDERING:
- Both shoes visible (left + right feet).
- Match the shoe size to the model's foot — actual proportional fit, not oversized or undersized.
- Match the shoe's exact appearance from IMAGE 2: same upper material, same colour, same sole, same laces, same hardware.
- Both shoes flat on the floor, heels touching, parallel orientation matching the existing model pose.

PRESERVE:
- The model's identity, body, pose, arms, upper torso — all unchanged.
- The backdrop, lighting, framing — unchanged.
- The jeans colour, fabric, pocket construction, waistband, panel seams — all unchanged. ONLY the lower portion of the hem may be re-shaped to accommodate the visible shoes.

Render at high fidelity — sharp denim texture, sharp shoe details, natural shadow contact under the feet.`;

    const t0 = Date.now();
    try {
      const result = await generateImage({
        prompt,
        referenceImages: [
          { buffer: srcBuf, mimeType: 'image/png', label: 'IMAGE 1 — source render with barefeet under long cascading hem. Adjust hem length so the shoes from IMAGE 2 are properly visible.' },
          { buffer: shoeImg.buf, mimeType: shoeImg.mime, label: `IMAGE 2 — target shoe (${shoe.name}). Match exactly: style, colour, material, sole, hardware.` },
        ],
        aspectRatio: '1:1',
        imageSize: '4K',
        model: 'gemini-3-pro-image-preview',
      });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      const out = path.join(OUT_DIR, `${shoe.id}.png`);
      fs.writeFileSync(out, result.imageData);
      console.log(`DONE in ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
    } catch (e) {
      console.error(`FAILED: ${(e as Error).message}`);
    }
  }
  console.log(`\nOutputs in: ${OUT_DIR}`);
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
