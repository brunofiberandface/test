/**
 * Option D test: no-sandal sole-base.
 *
 * Sole-mode + sandal got 1/4 CONTOR runs with hem cascading past the foot.
 * The remaining 3/4 stopped the hem at the sandal top — Seedream still
 * reading "exposed foot = pants end here". This test removes the sandal
 * ENTIRELY: bare feet directly on the studio floor, no sole.
 *
 * Outputs in test_outputs/sole-mode/no-sandal/:
 *   nosandal_base.png             — new base, no visible sole
 *   nosandal_contor_{1,2,3}.png   — 3 Seedream runs
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
import { generateImage } from '../src/lib/vertex';

const OUT_DIR = path.join(projectRoot, 'test_outputs', 'sole-mode', 'no-sandal');
fs.mkdirSync(OUT_DIR, { recursive: true });

const LEAN_PROMPT = `Apply the fitmodel trousers onto the AI model with shoes. so merge the two images, but the trousers should be fully respected in form and fit. all details need to be preserved, IMPORTANT is the trousers run naturally down respecting the fitmodel lenght of the trousers. the model needs to stand equally on 2 feet, 50% on each foot, keeping the same position as the underwear model.`;

const NO_SANDAL_CONVERSION_PROMPT = `Remove ALL footwear from the model. No sandal, no sole, no shoes whatsoever. The model has BARE FEET standing directly on the studio floor — bare skin touching the floor surface. The toes and the top of the foot are visible against the floor.

Preserve every other pixel of the image exactly: the model's identity, body, pose, stance, the placeholder shorts/underwear, the grey studio backdrop, the lighting, the contact shadow under the feet. Only the shoe/sole is removed — replaced with bare feet touching the floor directly.`;

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });
  const storage = new Storage({
    projectId: 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });
  const bucket = storage.bucket('gstar-ai-studio-assets');

  const cell = (await db.collection('qaShoeMatrix').doc('3xKezovO6eef7SJfMioC_F3').get()).data() as any;
  const closedBaseUrl = cell.images.legsBack;
  const closedBuf = Buffer.from(await (await fetch(closedBaseUrl.split('?')[0])).arrayBuffer());

  console.log(`Building no-sandal base via Gemini…`);
  const t0 = Date.now();
  const conv = await generateImage({
    prompt: NO_SANDAL_CONVERSION_PROMPT,
    referenceImages: [{ buffer: closedBuf, mimeType: 'image/png', label: 'SOURCE' }],
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  const noSandalBuf = conv.imageData;
  fs.writeFileSync(path.join(OUT_DIR, 'nosandal_base.png'), noSandalBuf);
  console.log(`No-sandal base saved in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const key = `experiments/sole-mode/no-sandal-${Date.now()}/base.png`;
  await bucket.file(key).save(noSandalBuf, { metadata: { contentType: 'image/png' } });
  const noSandalUrl = `https://storage.googleapis.com/gstar-ai-studio-assets/${key}`;
  console.log(`Uploaded to ${noSandalUrl}`);

  const contor = (await db.collection('wardrobe').doc('ZB2GMhoH1hQDjdJQbD6d').get()).data() as any;
  const fitBack = contor.fitModels.back;

  for (const i of [1, 2, 3]) {
    console.log(`\n[nosandal-contor-${i}] generating…`);
    const t1 = Date.now();
    const result = await generateSeedreamImage({
      prompt: LEAN_PROMPT,
      referenceImages: [
        { url: noSandalUrl, label: '' },
        { url: fitBack.split('?')[0], label: '' },
      ],
      aspectRatio: '1:1',
    });
    fs.writeFileSync(path.join(OUT_DIR, `nosandal_contor_${i}.png`), result.imageData);
    console.log(`[nosandal-contor-${i}] DONE in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
