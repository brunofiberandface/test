/**
 * Render each shoe as a clean back-perspective asset on a plain studio
 * background. Different from the wardrobe flat photos (which are 3/4 product
 * angles): these are purpose-built "as worn from behind" views, ready to be
 * composited under a model's feet.
 *
 * Two stages of restraint vs prior experiments:
 *   1. Single shoe per image, isolated on neutral floor — Gemini has no
 *      competing visual context.
 *   2. Output uses identical lighting + floor color as our matrix base
 *      (#D9DAD2 grey backdrop) so the asset composites without colour shift.
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

const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/shoe-assets');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SHOES = [
  { id: 'white-sneaker', name: 'White leather low-top sneaker',
    refs: [
      'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/3xKezovO6eef7SJfMioC/360_00.jpg',
      'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/3xKezovO6eef7SJfMioC/360_02.jpg',
    ] },
  { id: 'grey-sneaker', name: 'Grey low-top sneaker',
    refs: [
      'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/xaVs4I5KFQKq5AEq5m6I/flat_front.jpg',
      'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/xaVs4I5KFQKq5AEq5m6I/flat_back.jpg',
    ] },
  { id: 'brown-suede-boot', name: 'Brown suede ankle boot',
    refs: [
      'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/C0QleJPtkd58NRiHhPES/flat_front.jpg',
      'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/C0QleJPtkd58NRiHhPES/flat_back.jpg',
    ] },
];

async function fetchBuf(url: string) {
  const r = await fetch(url.split('?')[0]);
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') || 'image/jpeg' };
}

async function main() {
  for (const shoe of SHOES) {
    console.log(`\n=== ${shoe.name} (${shoe.id}) ===`);
    const refs = await Promise.all(shoe.refs.map(fetchBuf));

    const prompt = `Render a back-view photograph of a pair of ${shoe.name} placed on a light-grey studio floor (sweep colour hex #D9DAD2), seen from a low camera angle as if photographed from behind a person who is wearing them.

Composition:
- A pair of shoes (left foot and right foot), placed parallel to each other, both pointing AWAY from the camera (toes pointing into the background, heels facing the camera).
- The heels are aligned with each other, set roughly hip-width apart.
- The shoes are flat on the floor, sitting naturally as if a person is standing in them. (No legs, no model, no feet visible — only the shoes themselves and the floor.)
- The camera is at a low height (about knee-height of a standing person), looking slightly down at the shoes from behind.

The shoes are the EXACT pair shown in the reference images: same colour, same material, same upper construction, same heel counter, same sole. Match the reference precisely.

The background is the same light-grey studio sweep — even, soft, diffuse, no shadow other than a very subtle contact shadow directly under each shoe.

Output is a single still photograph, 1:1 square crop, 4K resolution.`;

    const t0 = Date.now();
    try {
      const result = await generateImage({
        prompt,
        referenceImages: refs.map((r, i) => ({
          buffer: r.buf,
          mimeType: r.mime,
          label: `Shoe reference ${i + 1} (${shoe.name})`,
        })),
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
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
