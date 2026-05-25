/**
 * v3 of lean Seedream prompt — fix v2 regression where the word "heels"
 * was interpreted as high-heel shoes (3/3 had stilettos instead of bare feet).
 *
 * v3: replace "heels facing the camera" with anatomy-neutral phrasing:
 *   "The bare feet at the bottom of the frame are oriented the SAME WAY as
 *    in IMAGE 1 — back of the foot toward camera, toes pointing away from
 *    the camera. Barefoot, no footwear."
 *
 * 3 runs.
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

import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';

const F9_TIER1_LEGSBACK = 'https://storage.googleapis.com/gstar-ai-studio-assets/output/model-assets/F9/legsBack.png';
const JUDEE_FITBACK_4K  = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/4nyMHh7ICQLrpxBX8zmP/fitmodel_05.jpg';

const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/m02-lean-prompt-audit-v3');
fs.mkdirSync(OUT_DIR, { recursive: true });

const LEAN_PROMPT = `Merge IMAGE 1 (barefoot AI model in black placeholder underwear, waist-down) with IMAGE 2 (fitmodel wearing the target trousers, waist-down). Output = IMAGE 1 with the placeholder replaced by the trousers from IMAGE 2. Preserve the trousers' wash, color, fit, length, drape, hem behavior, and back-pocket construction exactly as in IMAGE 2. Preserve IMAGE 1's framing (1:1 waist-down, centered, no head, no upper body), model identity, and bare feet. The bare feet at the bottom of the frame are oriented the SAME WAY as in IMAGE 1 — back of the foot toward camera, toes pointing away from the camera. Barefoot, no footwear. Render exactly ONE model.`;

async function runOne(runIdx: number): Promise<void> {
  console.log(`\n=== run ${runIdx}/3 ===`);
  const t0 = Date.now();
  const result = await generateSeedreamImage({
    prompt: LEAN_PROMPT,
    referenceImages: [
      { url: F9_TIER1_LEGSBACK, label: '' },
      { url: JUDEE_FITBACK_4K, label: '' },
    ],
    aspectRatio: '1:1',
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const outPath = path.join(OUT_DIR, `run${runIdx}.png`);
  fs.writeFileSync(outPath, result.imageData);
  console.log(`DONE ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
}

async function main() {
  console.log(`Prompt length: ${LEAN_PROMPT.length} chars`);
  for (let i = 1; i <= 3; i++) {
    try {
      await runOne(i);
    } catch (e) {
      console.error(`run ${i} FAILED: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
