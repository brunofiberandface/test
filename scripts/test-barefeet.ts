/**
 * Bare-feet base — no shoes at all. Hypothesis: with zero foot anchor,
 * Seedream may follow the fit-model length more reliably (or it may go even
 * more wild — we don't know yet).
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
const OUT = path.join(projectRoot, 'test_outputs/sole-mode/barefeet/barefeet_base.png');

const PROMPT = `In this back-view photograph of a model wearing white leather low-top sneakers, REMOVE the sneakers ENTIRELY. The model is now BAREFOOT — bare feet flat on the studio floor, natural skin tone, both heels touching the floor, no shoes whatsoever.

The model's feet, ankles, and lower legs are visible as bare skin all the way down to the toes touching the floor. The floor is the same light-grey studio sweep as the rest of the image.

Every other pixel is preserved exactly: model identity, body, pose, the placeholder black shorts, the background, the lighting. ONLY the sneakers are removed and replaced with bare feet on the floor.`;

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  console.log('Fetching matrix base…');
  const r = await fetch(MATRIX_BASE_URL.split('?')[0]);
  if (!r.ok) { console.error(`fetch ${r.status}`); process.exit(1); }
  const buf = Buffer.from(await r.arrayBuffer());
  console.log(`Source: ${(buf.length / 1024).toFixed(0)}KB`);

  console.log('Calling Gemini to remove shoes → bare feet…');
  const t0 = Date.now();
  const result = await generateImage({
    prompt: PROMPT,
    referenceImages: [{ buffer: buf, mimeType: 'image/jpeg', label: 'SOURCE — remove ONLY the sneakers; preserve everything else.' }],
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
