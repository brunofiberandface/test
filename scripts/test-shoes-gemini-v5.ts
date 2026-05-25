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
const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/add-shoes-gemini-v5');
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
LEG SILHOUETTE AND PANT-OVER-SHOE LAYERING (BACK VIEW)

This is a wide-leg G-Star denim trouser photographed from behind for an e-commerce catalog. The leg of the trouser is wide and full from the knee all the way down to the hem, with a generous leg opening. The leg opening at the hem is the same width as the leg at the knee — the fabric does NOT taper inward, narrow, gather, bunch, funnel, or collect around the ankle. The pant leg falls in a straight vertical column from the knee to the hem like a wide cylinder, not like a sweatpant cuff and not like a tailored trouser break.

The pant hem is a clean, wide horizontal edge. It sits low — covering the entire ankle bone and continuing down so that the hem covers the upper portion of the shoe. Only the lower one-third to one-half of the shoe is visible below the hem: the heel cup at the back, the midsole, and the sole touching the floor. The shoe upper, laces, tongue, and ankle collar of the shoe are fully hidden behind the pant fabric. The pant fabric is the foreground layer; the shoe sits behind it.

The denim is heavyweight and holds its shape. It hangs vertically from the knee without clinging to the calf or ankle. There is no fabric bunching, no stacked folds, no gathered cuff, no elastic-look at the bottom of the leg. The vertical drape is smooth and full down to the hem. The pant leg looks like loose wide-leg jeans, not like joggers, not like skinny jeans tucked into shoes, not like tailored trousers with a heavy break.

Imagine a G-Star RAW catalog photograph of a model standing in wide-leg jeans over low sneakers or low boots: the jeans fall as a wide column, the hem sits over the top of the shoes, and the back of the shoes peeks out at floor level. That is the target.
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

    const prompt = `IMAGE 1 is a back-view photograph of a model in long wide-leg jeans, currently barefoot. Paint the shoes from IMAGE 2 (${shoe.name}, back view) on the model's feet and apply the silhouette + layering rules below.

${LAYERING_BACK_VIEW}

PRESERVE: model identity, body, pose, arms, upper torso, backdrop, lighting, framing — all unchanged. Jeans colour, fabric, pocket construction, waistband, panel seams — unchanged.`;

    const t0 = Date.now();
    try {
      const result = await generateImage({
        prompt,
        referenceImages: [
          { buffer: srcBuf, mimeType: 'image/png', label: 'IMAGE 1 — source render: back view of model, barefoot under long wide-leg jeans. Apply LAYERING_BACK_VIEW with shoes from IMAGE 2.' },
          { buffer: shoeImg.buf, mimeType: shoeImg.mime, label: `IMAGE 2 — back view of target shoe (${shoe.name}). Heel cup is the visible part.` },
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
