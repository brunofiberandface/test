/**
 * A/B: matte with vs without the Gemini grounding-shadow regen pass.
 *
 * Hypothesis (Bruno 2026-05-18 inspection of F6 Kate M06 v1):
 * the Gemini grounding-shadow regen step softens denim texture even though
 * the prompt says "preserve subject and backdrop exactly; add only the
 * grounding shadow under the feet". Gemini is a generative model — every
 * pixel gets re-rendered.
 *
 * Test:
 *   1. Pull the F6 M06 v1 teeedit stage (crisp denim, no matte yet) as source.
 *   2. Call produceBackdropVariants TWICE on that same buffer:
 *      a) disableShadow=false (current production) → rembg + procedural
 *         shadow + Gemini grounding-shadow regen
 *      b) disableShadow=true → rembg + procedural shadow only, NO Gemini
 *   3. Save both grey + white variants.
 *
 * Visual comparison shows whether the Gemini regen is the cause of the
 * airbrushed look and whether the procedural shadow alone is acceptable.
 *
 * Output:
 *   test_outputs/matte-ab/with-gemini/grey.png    + white.png
 *   test_outputs/matte-ab/without-gemini/grey.png + white.png
 *   test_outputs/matte-ab/source.png  (the teeedit stage we tested on)
 */
import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  const c = fs.readFileSync(envPath, 'utf-8');
  for (const line of c.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { produceBackdropVariants } from '../src/lib/subject-matte';

const SOURCE_URL = 'https://storage.googleapis.com/gstar-ai-studio-assets/output/Kate%20Boyfriend%20Jeans/debug/F6_M06_v1_teeedit.png';
const OUT_BASE = path.join(projectRoot, 'test_outputs', 'matte-ab');

async function main() {
  fs.mkdirSync(path.join(OUT_BASE, 'with-gemini'), { recursive: true });
  fs.mkdirSync(path.join(OUT_BASE, 'without-gemini'), { recursive: true });

  console.log(`Fetching source: ${SOURCE_URL}`);
  const r = await fetch(SOURCE_URL);
  if (!r.ok) { console.error(`fetch failed: ${r.status}`); process.exit(1); }
  const sourceBuffer = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(path.join(OUT_BASE, 'source.png'), sourceBuffer);
  console.log(`Source: ${(sourceBuffer.length / 1024).toFixed(0)} KB → ${path.join(OUT_BASE, 'source.png')}`);

  // A) WITH Gemini grounding-shadow regen (current production behavior)
  console.log(`\n=== A) WITH Gemini grounding-shadow regen ===`);
  const t0a = Date.now();
  const variantsA = await produceBackdropVariants(sourceBuffer, { disableShadow: false });
  const dtA = ((Date.now() - t0a) / 1000).toFixed(1);
  if (!variantsA) {
    console.error('variantsA returned null');
  } else {
    fs.writeFileSync(path.join(OUT_BASE, 'with-gemini', 'grey.png'), variantsA.greyBuffer);
    fs.writeFileSync(path.join(OUT_BASE, 'with-gemini', 'white.png'), variantsA.whiteBuffer);
    console.log(`A DONE in ${dtA}s — grey=${(variantsA.greyBuffer.length / 1024).toFixed(0)}KB, white=${(variantsA.whiteBuffer.length / 1024).toFixed(0)}KB`);
  }

  // B) WITHOUT Gemini grounding-shadow regen
  console.log(`\n=== B) WITHOUT Gemini grounding-shadow regen ===`);
  const t0b = Date.now();
  const variantsB = await produceBackdropVariants(sourceBuffer, { disableShadow: true });
  const dtB = ((Date.now() - t0b) / 1000).toFixed(1);
  if (!variantsB) {
    console.error('variantsB returned null');
  } else {
    fs.writeFileSync(path.join(OUT_BASE, 'without-gemini', 'grey.png'), variantsB.greyBuffer);
    fs.writeFileSync(path.join(OUT_BASE, 'without-gemini', 'white.png'), variantsB.whiteBuffer);
    console.log(`B DONE in ${dtB}s — grey=${(variantsB.greyBuffer.length / 1024).toFixed(0)}KB, white=${(variantsB.whiteBuffer.length / 1024).toFixed(0)}KB`);
  }

  console.log(`\nInspect:\n  ${path.join(OUT_BASE, 'source.png')}\n  ${path.join(OUT_BASE, 'with-gemini')}\n  ${path.join(OUT_BASE, 'without-gemini')}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
