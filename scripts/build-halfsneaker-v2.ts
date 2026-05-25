/**
 * Re-do the half-sneaker base — explicit "no socks, no extra fabric".
 * Just: cut the sneaker upper at half its height. Lower half (sole + bottom
 * vamp + heel cup base) remains visible. Above that, the model's ankle and
 * lower leg are BARE — the placeholder shorts + skin like in the original
 * matrix base, NOTHING added.
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

const MATRIX_BASE_URL = 'https://storage.googleapis.com/gstar-ai-studio-assets/output/qa-matrix/3xKezovO6eef7SJfMioC/F3/legsBack.jpg';
const OUT = path.join(projectRoot, 'test_outputs/sole-mode/half-sneaker/halfsneaker_base_v2.png');

const PROMPT = `In this back-view photograph of a model wearing white leather low-top sneakers, modify ONLY the sneakers. Cut each sneaker at HALF its original height — keep only the lower 50% of the sneaker (the sole, toe cap, lower vamp, and the bottom of the heel cup). Remove the upper 50% of each sneaker (the laces, tongue, collar, and the upper portion of the heel cup are GONE).

Above where each sneaker has been cut, the model's BARE ANKLE and lower leg are visible — natural skin, NO socks, NO fabric overlay, NO replacement material. Just the model's natural skin where the sneaker upper used to be.

Every other pixel in the image is preserved exactly: the model's body, pose, the placeholder black shorts, the background, the lighting, and the foot position. ONLY the upper half of each sneaker is removed and the natural skin/leg shows through where it was.`;

async function main() {
  console.log('Fetching matrix base…');
  const r = await fetch(MATRIX_BASE_URL.split('?')[0]);
  if (!r.ok) { console.error(`fetch ${r.status}`); process.exit(1); }
  const buf = Buffer.from(await r.arrayBuffer());
  console.log(`Source: ${(buf.length / 1024).toFixed(0)}KB`);

  console.log('Calling Gemini with explicit "no socks" instruction…');
  const t0 = Date.now();
  const result = await generateImage({
    prompt: PROMPT,
    referenceImages: [{ buffer: buf, mimeType: 'image/jpeg', label: 'SOURCE — modify ONLY the sneakers; preserve everything else.' }],
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  fs.writeFileSync(OUT, result.imageData);
  console.log(`Saved in ${dt}s → ${OUT}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
