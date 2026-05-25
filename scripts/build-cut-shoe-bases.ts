/**
 * Cut the visible sneakers on the matrix base down to just the sole +
 * ~1cm of the upper above the sole. Two outputs:
 *   - F3 + WHITE sneakers (cut)
 *   - F3 + GREY sneakers (cut)
 *
 * Bruno wants to inspect these before we run Seedream paints.
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

const SOURCES = [
  { id: 'f3-white-sneaker', url: 'https://storage.googleapis.com/gstar-ai-studio-assets/output/qa-matrix/3xKezovO6eef7SJfMioC/F3/legsBack.jpg' },
  { id: 'f3-grey-sneaker', url: 'https://storage.googleapis.com/gstar-ai-studio-assets/output/qa-matrix/xaVs4I5KFQKq5AEq5m6I/F3/legsBack.jpg' },
];

const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/cut-shoes');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROMPT = `In this back-view photograph of a model wearing low-top sneakers, modify ONLY the sneakers. Cut each sneaker DOWN to a very low silhouette — keep ONLY the sole and a thin lip of the upper approximately 1cm above the sole (about 1/5 of the original shoe height). Remove the entire rest of the sneaker upper — the heel cup, the laces, the tongue, the collar, the side panels above 1cm — all gone. What remains is essentially the bottom of the shoe: the sole + a very low band of the upper just at the sole edge.

Above where each sneaker has been cut, the model's BARE ANKLE and lower leg are visible — natural skin, NO socks, NO fabric overlay, NO replacement material.

Every other pixel of the image is preserved exactly: the model's body, pose, the placeholder black shorts, the background, the lighting, the foot position on the floor. Only the upper portion of each sneaker is removed.`;

async function fetchBuf(url: string) {
  const r = await fetch(url.split('?')[0]);
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  for (const src of SOURCES) {
    console.log(`\n=== ${src.id} ===`);
    const buf = await fetchBuf(src.url);
    console.log(`Source: ${(buf.length / 1024).toFixed(0)}KB`);
    const t0 = Date.now();
    try {
      const result = await generateImage({
        prompt: PROMPT,
        referenceImages: [{ buffer: buf, mimeType: 'image/jpeg', label: 'SOURCE — modify ONLY the sneakers; preserve everything else.' }],
        aspectRatio: '1:1',
        imageSize: '4K',
        model: 'gemini-3-pro-image-preview',
      });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      fs.writeFileSync(path.join(OUT_DIR, `${src.id}.png`), result.imageData);
      console.log(`DONE in ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
    } catch (e) {
      console.error(`FAILED: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
