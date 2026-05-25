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

import { Storage } from '@google-cloud/storage';
import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';

const LOCAL_BASE = path.join(projectRoot, 'test_outputs/sole-mode/half-sneaker/halfsneaker_base.png');
const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/half-sneaker');
const CONTOR_FITBACK = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/pants/ZB2GMhoH1hQDjdJQbD6d/fitmodel_04.jpg';
const LEAN_PROMPT = `Apply the fitmodel trousers onto the AI model with shoes. so merge the two images, but the trousers should be fully respected in form and fit. all details need to be preserved, IMPORTANT is the trousers run naturally down respecting the fitmodel lenght of the trousers. the model needs to stand equally on 2 feet, 50% on each foot, keeping the same position as the underwear model.`;

async function main() {
  console.log('Converting PNG → JPEG to shrink size...');
  const sharp = (await import('sharp')).default;
  const pngBuf = fs.readFileSync(LOCAL_BASE);
  const jpegBuf = await sharp(pngBuf).jpeg({ quality: 92 }).toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, 'halfsneaker_base.jpg'), jpegBuf);
  console.log(`PNG=${(pngBuf.length / 1024 / 1024).toFixed(1)}MB → JPEG=${(jpegBuf.length / 1024 / 1024).toFixed(1)}MB`);

  console.log('Uploading via non-resumable single-PUT...');
  const sa = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const storage = new Storage({ projectId: sa.project_id, credentials: { client_email: sa.client_email, private_key: sa.private_key } });
  const bucket = storage.bucket('gstar-ai-studio-assets');
  const gcsKey = `experiments/sole-mode/halfsneaker-${Date.now()}/base.jpg`;
  await bucket.file(gcsKey).save(jpegBuf, {
    metadata: { contentType: 'image/jpeg' },
    resumable: false,  // single-PUT — much more resilient on flaky networks
  });
  await bucket.file(gcsKey).makePublic().catch(() => {});
  const baseUrl = `https://storage.googleapis.com/gstar-ai-studio-assets/${gcsKey}`;
  console.log(`Base uploaded: ${baseUrl}`);

  for (const i of [1, 2, 3]) {
    console.log(`\n[run${i}] Seedream paint…`);
    const t0 = Date.now();
    const result = await generateSeedreamImage({
      prompt: LEAN_PROMPT,
      referenceImages: [
        { url: baseUrl, label: '' },
        { url: CONTOR_FITBACK, label: '' },
      ],
      aspectRatio: '1:1',
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const out = path.join(OUT_DIR, `contor_run${i}.png`);
    fs.writeFileSync(out, result.imageData);
    console.log(`[run${i}] DONE in ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
  }
  console.log(`\nAll outputs in: ${OUT_DIR}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
