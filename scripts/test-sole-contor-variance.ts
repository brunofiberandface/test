/**
 * Variance check: sole-mode + CONTOR 3D WIDE WMN × F3.
 * Run 3 more generations to see whether the mid-calf truncation is
 * stochastic (1/4 outlier from prior run) or systematic (Seedream
 * truncates because the sole-base exposes bare ankles → "pants end here").
 *
 * Uses the same sole-base PNG from the prior sole-mode experiment so
 * we're only varying the Seedream RNG, not the input.
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

import { Storage } from '@google-cloud/storage';
import { Firestore } from '@google-cloud/firestore';
import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';

const OUT_DIR = path.join(projectRoot, 'test_outputs', 'sole-mode', 'variance');
fs.mkdirSync(OUT_DIR, { recursive: true });

const LEAN_PROMPT = `Apply the fitmodel trousers onto the AI model with shoes. so merge the two images, but the trousers should be fully respected in form and fit. all details need to be preserved, IMPORTANT is the trousers run naturally down respecting the fitmodel lenght of the trousers. the model needs to stand equally on 2 feet, 50% on each foot, keeping the same position as the underwear model.`;

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));

  // Upload the existing sole_base.png from the prior run to GCS for Seedream
  const soleBaseLocal = path.join(projectRoot, 'test_outputs', 'sole-mode', 'sole_base.png');
  if (!fs.existsSync(soleBaseLocal)) { console.error(`Missing ${soleBaseLocal}`); process.exit(1); }
  const soleBaseBuf = fs.readFileSync(soleBaseLocal);
  const storage = new Storage({
    projectId: 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });
  const bucket = storage.bucket('gstar-ai-studio-assets');
  const soleBaseKey = `experiments/sole-mode/variance-${Date.now()}/sole_base.png`;
  await bucket.file(soleBaseKey).save(soleBaseBuf, { metadata: { contentType: 'image/png' } });
  const soleBaseUrl = `https://storage.googleapis.com/gstar-ai-studio-assets/${soleBaseKey}`;

  // Get the CONTOR fit-model.back URL
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });
  const contor = (await db.collection('wardrobe').doc('ZB2GMhoH1hQDjdJQbD6d').get()).data() as any;
  const fitBack = contor.fitModels?.back;
  if (!fitBack) { console.error('No CONTOR fitModels.back'); process.exit(1); }

  console.log(`Sole base: ${soleBaseUrl}`);
  console.log(`Fit back: ${fitBack}`);

  for (const i of [1, 2, 3]) {
    console.log(`\n[variance-${i}] generating…`);
    const t0 = Date.now();
    const result = await generateSeedreamImage({
      prompt: LEAN_PROMPT,
      referenceImages: [
        { url: soleBaseUrl, label: '' },
        { url: fitBack.split('?')[0], label: '' },
      ],
      aspectRatio: '1:1',
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const out = path.join(OUT_DIR, `run${i}.png`);
    fs.writeFileSync(out, result.imageData);
    console.log(`[variance-${i}] DONE in ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB → ${out}`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
