/**
 * v3 of Gemini shoe-paint:
 *   - Use BACK-view shoe references (heel cups visible)
 *   - Explicit prompt about perspective: model is back view, shoes pointing
 *     away from camera, what's visible is heel cup + back of upper.
 *
 * Issue with v2: front-view shoe refs + back-view model = Gemini painted
 * toe-boxes facing camera (wrong perspective).
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
const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/add-shoes-gemini-v3-back');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SHOES = [
  { id: 'white-sneaker', name: 'White leather low-top sneaker',
    back: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/3xKezovO6eef7SJfMioC/360_02.jpg' },
  { id: 'grey-sneaker', name: 'Grey low-top sneaker',
    back: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/xaVs4I5KFQKq5AEq5m6I/flat_back.jpg' },
  { id: 'brown-suede-boot', name: 'Brown suede ankle boot',
    back: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/C0QleJPtkd58NRiHhPES/flat_back.jpg' },
];

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

    const prompt = `IMAGE 1 is a BACK VIEW photograph of a model in long wide-leg jeans, currently barefoot. The model faces away from the camera. Paint shoes on the model's feet AND adjust the jeans hem so the shoes are visible.

═══ PERSPECTIVE — CRITICAL ═══
The model is rendered FROM BEHIND. Her feet are flat on the floor with TOES POINTING AWAY from the camera and HEELS POINTING TOWARD the camera. From this camera angle, what's visible on each shoe is:
- The HEEL CUP and the BACK of the shoe upper
- The BACK STITCHING / back logo / heel tab
- A small portion of the OUTER SIDE of the shoe
- The SOLE EDGE around the heel area
The TOE BOX is FACING AWAY from the camera and is NOT visible (or barely visible past the heel).

IMAGE 2 (the shoe reference) shows the BACK view of the target shoes — ${shoe.name}. Match exactly what's visible in IMAGE 2 — the back of the heel cup, the heel construction, the back stitching, the colour, the material. Do NOT paint the front of the shoe (toe box / tongue / laces / fly piece) — those are not visible from a back-view camera angle.

═══ HEM POSITIONING ═══
The jeans hem ENDS at the TOP of the shoe (the collar / heel cup top). Light natural break / fabric cascade onto the upper portion of the shoe is fine, but the hem does NOT cover the entire shoe. The HEEL CUP and back of the shoe upper are CLEARLY VISIBLE BELOW the hem. Adjust the existing hem upward as needed so the shoes are properly visible from behind.

═══ PRESERVE ═══
Model identity, body, pose, arms, upper torso, backdrop, lighting, framing — all unchanged. Jeans colour, fabric, pocket construction, waistband, panel seams — unchanged. ONLY the lower portion of the hem is re-shaped to accommodate the visible heel cups.`;

    const t0 = Date.now();
    try {
      const result = await generateImage({
        prompt,
        referenceImages: [
          { buffer: srcBuf, mimeType: 'image/png', label: 'IMAGE 1 — source render: BACK VIEW of model, barefoot under long cascading hem. Paint shoes visible from behind (heel cup view), adjust hem accordingly.' },
          { buffer: shoeImg.buf, mimeType: shoeImg.mime, label: `IMAGE 2 — BACK VIEW of target shoe (${shoe.name}). The heel cup, back upper, back stitching, back logo are shown. Paint THIS view on the rendered model's feet.` },
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
