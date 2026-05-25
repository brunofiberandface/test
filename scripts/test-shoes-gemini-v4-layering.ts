/**
 * v4 — Bruno's LAYERING_BACK_VIEW prompt verbatim. Precise rules about
 * pant-over-shoe layering: hem terminates between TOP of heel counter and
 * MIDDLE of heel, heel cup visible below, natural fabric stack/break above.
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
const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/add-shoes-gemini-v4-layering');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SHOES = [
  { id: 'white-sneaker', name: 'White leather low-top sneaker',
    back: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/3xKezovO6eef7SJfMioC/360_02.jpg' },
  { id: 'grey-sneaker', name: 'Grey low-top sneaker',
    back: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/xaVs4I5KFQKq5AEq5m6I/flat_back.jpg' },
  { id: 'brown-suede-boot', name: 'Brown suede ankle boot',
    back: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/C0QleJPtkd58NRiHhPES/flat_back.jpg' },
];

const LAYERING_BACK_VIEW = `
PANT-OVER-SHOE LAYERING (BACK VIEW) — CRITICAL:

Layer order from foreground to background at the ankle:
1. Pant fabric (foremost layer, draped from above)
2. Shoe heel counter (visible BELOW the pant hem)
3. Floor / background

The pant hem must terminate at a height between the top of the shoe heel counter and the middle of the heel — so that the back of the shoe (heel cup) is clearly visible below the hem, but the shoe upper and laces are covered.

Specifically for the back view:
- The pant hem falls forward of the heel due to gravity. The fabric does NOT wrap behind the heel or tuck under it.
- Below the pant hem, you see the curved back of the shoe (heel counter) and a sliver of sole touching the floor.
- Above the pant hem, the denim shows ONE OR TWO natural horizontal folds (the "stack" or "break") from the fabric's own weight resting on the shoe. Heavyweight raw denim stacks slightly — it does not hang in a perfectly straight tube.
- The hem itself is a defined horizontal edge with visible fabric thickness — not a feathered or blurred boundary.
- Left and right legs are slightly asymmetric: the hem height differs by 3-5 mm between legs, and the fold positions are not mirrored. Real photographs show this. Perfect symmetry reads as artificial.

Forbidden:
- Pant hem at floor level with no shoe visible behind it.
- Pant hem at calf level exposing the entire shoe and ankle.
- Pants tucked behind or inside the shoe collar.
- Straight tubular pant leg with no fabric stack above the hem.
- Perfectly symmetric hems across both legs.
- A clean straight horizontal line where pant meets shoe — there must be at least a small visible break/fold.
`.trim();

async function fetchBuf(url: string) {
  const r = await fetch(url.split('?')[0]);
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') || 'image/jpeg' };
}

async function main() {
  const srcBuf = fs.readFileSync(SOURCE);
  for (const shoe of SHOES) {
    console.log(`\n=== ${shoe.name} (${shoe.id}) ===`);
    const shoeImg = await fetchBuf(shoe.back);

    const prompt = `IMAGE 1 is a back-view photograph of a model in long wide-leg jeans, currently barefoot. Paint the shoes from IMAGE 2 (${shoe.name}, back view shown) on the model's feet and apply the layering rules below.

${LAYERING_BACK_VIEW}

PRESERVE:
- Model identity, body, pose, arms, upper torso, backdrop, lighting, framing — all unchanged.
- Jeans colour, fabric, pocket construction, waistband, panel seams — all unchanged.
- The pants stay LONG — do NOT crop them above the heel. The new hem rests between the top of the heel counter and the middle of the heel (per the layering rule).`;

    const t0 = Date.now();
    try {
      const result = await generateImage({
        prompt,
        referenceImages: [
          { buffer: srcBuf, mimeType: 'image/png', label: 'IMAGE 1 — source render: back view of model, barefoot under long jeans. Apply LAYERING_BACK_VIEW with shoes from IMAGE 2.' },
          { buffer: shoeImg.buf, mimeType: shoeImg.mime, label: `IMAGE 2 — back view of target shoe (${shoe.name}). Heel counter is the visible part.` },
        ],
        aspectRatio: '1:1',
        imageSize: '4K',
        model: 'gemini-3-pro-image-preview',
      });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      fs.writeFileSync(path.join(OUT_DIR, `${shoe.id}.png`), result.imageData);
      console.log(`DONE in ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
    } catch (e) {
      console.error(`FAILED: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
