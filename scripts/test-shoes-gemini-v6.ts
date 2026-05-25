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
const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/add-shoes-gemini-v6');
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
PANT-OVER-SHOE OCCLUSION (BACK VIEW)

The pant length, cut, silhouette, construction, and hem position are defined by the garment reference images. Follow the reference exactly. Do not lengthen, shorten, or restyle the pant. The pant may be cropped, mid-calf, ankle-length, full-length, or stacked — whatever the reference shows.

This rule applies ONLY at the region where the pant and the shoe overlap in the image. If the pant ends above the shoe (cropped, mid-calf) and there is no overlap, this rule does nothing — render the shoe as normal below the visible hem.

WHERE PANT AND SHOE OVERLAP:
The pant fabric is the foreground layer. The shoe is behind it. At the overlap region, the denim covers and hides the portion of the shoe behind it — the shoe's upper, tongue, laces, or ankle collar are obscured wherever pant fabric is in front of them.

The pant fabric does NOT terminate at the shoe's outline. The pant fabric does NOT tuck behind, into, or under the shoe. The pant fabric does NOT trace the silhouette of the shoe.

Whatever portion of the shoe is below the pant hem remains fully visible — typically the back of the heel, the midsole, and the sole touching the floor.
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

    const prompt = `IMAGE 1 is a back-view photograph of a model in long wide-leg jeans, currently barefoot. Paint the shoes from IMAGE 2 (${shoe.name}, back view) on the model's feet and apply the occlusion rule below.

${LAYERING_BACK_VIEW}

PRESERVE: model identity, body, pose, arms, upper torso, backdrop, lighting, framing — all unchanged. Pant colour, fabric, panel construction, knee seams, anatomical outseams, waistband, washes, pockets — all unchanged. The pant silhouette in IMAGE 1 (CONTOR 3D wide-leg barrel) stays exactly as rendered in IMAGE 1.`;

    const t0 = Date.now();
    try {
      const result = await generateImage({
        prompt,
        referenceImages: [
          { buffer: srcBuf, mimeType: 'image/png', label: 'IMAGE 1 — source render: back view of model, barefoot under long wide-leg jeans (CONTOR 3D barrel). Preserve the pant exactly; only add the shoes from IMAGE 2 behind the pant fabric per the OCCLUSION rule.' },
          { buffer: shoeImg.buf, mimeType: shoeImg.mime, label: `IMAGE 2 — back view of target shoe (${shoe.name}). Heel counter is the visible part below the hem.` },
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
