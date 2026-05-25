/**
 * Render each shoe as a LOW-PROFILE standalone asset on a neutral floor:
 * just the sole + ~1cm lip of the upper above the sole. No model. Both
 * shoes oriented heel-toward-camera (back view).
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

const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/low-profile-shoe-assets');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SHOES = [
  { id: 'white-sneaker', name: 'White leather low-top sneaker',
    refs: ['https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/3xKezovO6eef7SJfMioC/360_00.jpg',
           'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/3xKezovO6eef7SJfMioC/360_02.jpg'] },
  { id: 'grey-sneaker', name: 'Grey low-top sneaker',
    refs: ['https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/xaVs4I5KFQKq5AEq5m6I/flat_front.jpg',
           'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/xaVs4I5KFQKq5AEq5m6I/flat_back.jpg'] },
  { id: 'brown-suede-boot', name: 'Brown suede ankle boot',
    refs: ['https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/C0QleJPtkd58NRiHhPES/flat_front.jpg',
           'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/C0QleJPtkd58NRiHhPES/flat_back.jpg'] },
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

    const prompt = `Render a photograph of a PAIR of LOW-PROFILE ${shoe.name} — only the SOLE and approximately 1cm (1/5 of original shoe height) of the upper above the sole. The rest of the shoe upper, the heel cup, the laces, the tongue, the ankle collar, and the back of the upper are all CUT OFF and GONE. What remains is essentially the sole disk and a thin band of the upper edge directly attached to the sole — like a very flat slipper or moccasin profile.

The pair (left foot and right foot) is placed flat on a light-grey studio floor (sweep colour hex #D9DAD2), about hip-width apart, parallel to each other.

CAMERA / ORIENTATION:
- The view is from BEHIND the pair. The HEELS face the camera. The TOES point AWAY from the camera into the background.
- The camera is at a low height, looking slightly down from behind.

The reference images show what the FULL shoes look like — match their colour, sole shape, sole material, and any sole-edge details. Only the sole + 1cm lip is rendered. Do NOT render the full shoe. Do NOT invent branding text or logos.

The frame contains only the floor and the pair of low-profile shoes. No model, no body, no legs, no feet shown (the cut shoes are empty objects on the floor). Single still photograph, 1:1 square crop, 4K.`;

    const t0 = Date.now();
    try {
      const result = await generateImage({
        prompt,
        referenceImages: refs.map((r, i) => ({
          buffer: r.buf,
          mimeType: r.mime,
          label: `Reference ${i + 1}: full ${shoe.name} — use for colour + sole material, do NOT render the upper portion.`,
        })),
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
