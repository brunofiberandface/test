/**
 * Take the barefeet CONTOR render Bruno liked (run4 of barefeet-single) and
 * use Gemini to add 3 different shoes under the cascading hem. Tests if
 * "long-hem garment generated barefoot + shoes added post-hoc" works as a
 * pipeline.
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
const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/add-shoes');
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
    console.log(`Shoe ref: ${(shoeImg.buf.length / 1024).toFixed(0)}KB`);

    const prompt = `In IMAGE 1, the model is currently barefoot under the long wide-leg jeans hem. Paint shoes (${shoe.name}) on the model's feet so the shoes appear underneath the cascading jeans hem.

The shoes shown in IMAGE 2 are the target shoes — match their style, colour, material, and silhouette exactly.

Where the hem of the jeans covers the foot, the jeans fabric stays as the outer layer (drapes OVER the shoe). Only the parts of the shoes that extend BEYOND the hem are visible — typically the front of the toe box and the back of the heel, just peeking out from under the cascading fabric.

Preserve every other pixel of IMAGE 1 exactly: the jeans, the model identity, the body, the pose, the backdrop, the lighting. Only the bare feet region is changed — replaced by the shoes from IMAGE 2 partially visible under the hem.`;

    const t0 = Date.now();
    try {
      const result = await generateImage({
        prompt,
        referenceImages: [
          { buffer: srcBuf, mimeType: 'image/png', label: 'IMAGE 1 — the rendered model with long cascading jeans hem and bare feet. Add shoes only; preserve everything else.' },
          { buffer: shoeImg.buf, mimeType: shoeImg.mime, label: `IMAGE 2 — target shoe reference (${shoe.name}). Copy style/colour/material exactly.` },
        ],
        aspectRatio: '1:1',
        imageSize: '4K',
        model: 'gemini-3-pro-image-preview',
      });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      const out = path.join(OUT_DIR, `${shoe.id}.png`);
      fs.writeFileSync(out, result.imageData);
      console.log(`DONE in ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB → ${out}`);
    } catch (e) {
      console.error(`FAILED: ${(e as Error).message}`);
    }
  }
  console.log(`\nOutputs in: ${OUT_DIR}`);
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
