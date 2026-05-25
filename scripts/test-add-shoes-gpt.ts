/**
 * Same 3-shoe test as Gemini, but using OpenAI gpt-image-1 image.edit.
 * gpt-image-1 supports multi-image input via the `image` parameter (array)
 * with a single prompt. We pass the barefeet CONTOR + a shoe flat + prompt.
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

import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

const SOURCE = path.join(projectRoot, 'test_outputs/sole-mode/barefeet-single/contor_run4.png');
const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/add-shoes-gpt');
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
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log('Loading source render…');
  const srcBuf = fs.readFileSync(SOURCE);
  console.log(`Source: ${(srcBuf.length / 1024 / 1024).toFixed(1)}MB`);

  for (const shoe of SHOES) {
    console.log(`\n=== ${shoe.name} (${shoe.id}) ===`);
    const shoeBuf = await fetchBuf(shoe.flat);
    console.log(`Shoe ref: ${(shoeBuf.length / 1024).toFixed(0)}KB`);

    const prompt = `Take IMAGE 1 (a back-view photograph of a model in long wide-leg jeans, currently barefoot under the cascading hem). Paint shoes on the model's feet so the shoes appear UNDER the cascading jeans hem. The shoes are shown in IMAGE 2 — match their exact style, colour, and material (${shoe.name}). Where the jeans hem covers the foot, the fabric stays as the outer layer (drapes over the shoe top). Only the parts of the shoes that extend BEYOND the hem are visible — typically the front of the toe box and the back of the heel peeking out from under the cascading fabric. Preserve every other pixel of IMAGE 1 exactly: jeans, model identity, body, pose, background, lighting. Only the bare-feet region is replaced by the shoes from IMAGE 2 partially visible under the hem.`;

    const t0 = Date.now();
    try {
      const result = await openai.images.edit({
        model: 'gpt-image-1',
        image: [
          await toFile(srcBuf, 'source.png', { type: 'image/png' }),
          await toFile(shoeBuf, 'shoe.jpg', { type: 'image/jpeg' }),
        ],
        prompt,
        size: '1024x1024',
      });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      const b64 = result.data?.[0]?.b64_json;
      if (!b64) { console.error(`no b64 in result`); continue; }
      const out = path.join(OUT_DIR, `${shoe.id}.png`);
      fs.writeFileSync(out, Buffer.from(b64, 'base64'));
      console.log(`DONE in ${dt}s — ${(Buffer.from(b64, 'base64').length / 1024).toFixed(0)}KB → ${out}`);
    } catch (e) {
      console.error(`FAILED: ${(e as Error).message}`);
    }
  }
  console.log(`\nOutputs in: ${OUT_DIR}`);
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
