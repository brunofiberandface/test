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
const BASE_URL = 'https://storage.googleapis.com/gstar-ai-studio-assets/experiments/sole-mode/halfsneaker-1779217989/base.jpg';
const CONTOR_FITBACK = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/pants/ZB2GMhoH1hQDjdJQbD6d/fitmodel_04.jpg';
const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/half-sneaker');
const LEAN_PROMPT = `Apply the fitmodel trousers onto the AI model with shoes. so merge the two images, but the trousers should be fully respected in form and fit. all details need to be preserved, IMPORTANT is the trousers run naturally down respecting the fitmodel lenght of the trousers. the model needs to stand equally on 2 feet, 50% on each foot, keeping the same position as the underwear model.`;
async function main() {
  for (const i of [2, 3]) {
    console.log(`\n[run${i}] Seedream paint…`);
    const t0 = Date.now();
    const result = await generateSeedreamImage({
      prompt: LEAN_PROMPT,
      referenceImages: [{ url: BASE_URL, label: '' }, { url: CONTOR_FITBACK, label: '' }],
      aspectRatio: '1:1',
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    fs.writeFileSync(path.join(OUT_DIR, `contor_run${i}.png`), result.imageData);
    console.log(`[run${i}] DONE in ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
