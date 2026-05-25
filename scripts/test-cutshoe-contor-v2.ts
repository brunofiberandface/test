/**
 * Prompt iteration B: add "render the hem at the EXACT same height as the
 * fitmodel's hem". Baseline (current prompt) was 2/6 perfect = 33% on cut-
 * shoe bases. Run 5 samples per shoe to compare.
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

const CONTOR_FITBACK = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/pants/ZB2GMhoH1hQDjdJQbD6d/fitmodel_04.jpg';

// Minimal delta — single phrase added after the existing "lenght" anchor:
// "render the hem at the EXACT same height as the fitmodel's hem"
const PROMPT = `Apply the fitmodel trousers onto the SINGLE AI model in the photo. so merge the two images, but the trousers should be fully respected in form and fit. all details need to be preserved, IMPORTANT is the trousers run naturally down respecting the fitmodel lenght of the trousers — render the hem at the EXACT same height as the fitmodel's hem. the model needs to stand equally on 2 feet, 50% on each foot, keeping the same position as the underwear model.`;

const SCENARIOS = [
  { id: 'white', base: 'https://storage.googleapis.com/gstar-ai-studio-assets/experiments/sole-mode/cut-white-1779255600.png' },
  { id: 'grey',  base: 'https://storage.googleapis.com/gstar-ai-studio-assets/experiments/sole-mode/cut-grey-1779255600.png' },
];

async function main() {
  for (const s of SCENARIOS) {
    const outDir = path.join(projectRoot, `test_outputs/sole-mode/cut-shoes/${s.id}-contor-v2`);
    fs.mkdirSync(outDir, { recursive: true });
    for (const i of [1, 2, 3, 4, 5]) {
      console.log(`\n[${s.id}/run${i}] Seedream…`);
      const t0 = Date.now();
      try {
        const result = await generateSeedreamImage({
          prompt: PROMPT,
          referenceImages: [{ url: s.base, label: '' }, { url: CONTOR_FITBACK, label: '' }],
          aspectRatio: '1:1',
        });
        const dt = ((Date.now() - t0) / 1000).toFixed(1);
        fs.writeFileSync(path.join(outDir, `run${i}.png`), result.imageData);
        console.log(`[${s.id}/run${i}] DONE in ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
      } catch (e) {
        console.error(`[${s.id}/run${i}] FAILED: ${(e as Error).message}`);
      }
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
