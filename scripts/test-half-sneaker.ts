/**
 * Bruno 2026-05-19 iteration: half-sneaker base.
 *
 * Sole-only base had bare ankles exposed → Seedream stopped pants at the
 * ankle 3/4 of the time. The bare-skin reveal was acting as the "feet end
 * here" signal even after the shoe upper was removed.
 *
 * This test: keep the LOWER HALF of the sneaker. The sole + the bottom
 * ~50% of the upper (heel cup + lower vamp). No bare ankle, no bare instep
 * showing. The shoe is still recognizable as a shoe, but the upper portion
 * (where the pant hem would drape over) is cut away — giving Seedream
 * "permission" to render the pant cascading over what's left.
 *
 * Outputs in test_outputs/sole-mode/half-sneaker/:
 *   halfsneaker_base.png             — converted base
 *   halfsneaker_contor_{1,2,3}.png   — 3 Seedream CONTOR runs
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

const OUT_DIR = path.join(projectRoot, 'test_outputs', 'sole-mode', 'half-sneaker');
fs.mkdirSync(OUT_DIR, { recursive: true });

const LEAN_PROMPT = `Apply the fitmodel trousers onto the AI model with shoes. so merge the two images, but the trousers should be fully respected in form and fit. all details need to be preserved, IMPORTANT is the trousers run naturally down respecting the fitmodel lenght of the trousers. the model needs to stand equally on 2 feet, 50% on each foot, keeping the same position as the underwear model.`;

const HALF_SNEAKER_PROMPT = `Edit the model's footwear: cut the white leather low-top sneaker in half horizontally. Keep ONLY the bottom half of the shoe — the sole plus roughly the lower half of the upper (the heel cup base, the lower vamp, the bottom of the lacing area). Remove the top half of the upper — the part that wraps over the instep and around the ankle.

The model's instep, ankle, and lower leg above the new shoe-cut line are completely covered by smooth grey fabric (same colour and texture as the placeholder shorts) extending from the placeholder shorts down to where the lower half of the sneaker begins. NO BARE SKIN visible on the instep, ankle, or lower leg. The fabric meets the cut sneaker cleanly.

The sneaker's sole and lower half remain exactly as in the source — same white leather material, same shape, same position on the floor, same contact shadow.

Preserve every other pixel of the source image: model identity, body, pose, stance, placeholder shorts (waist + upper thigh), grey studio backdrop, lighting, contact shadow under each foot.`;

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

  console.log(`Building half-sneaker base via Gemini…`);
  const t0 = Date.now();
  const conv = await generateImage({
    prompt: HALF_SNEAKER_PROMPT,
    referenceImages: [{ buffer: closedBuf, mimeType: 'image/png', label: 'SOURCE' }],
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  const halfBuf = conv.imageData;
  fs.writeFileSync(path.join(OUT_DIR, 'halfsneaker_base.png'), halfBuf);
  console.log(`Half-sneaker base saved in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const key = `experiments/sole-mode/half-sneaker-${Date.now()}/base.png`;
  await bucket.file(key).save(halfBuf, { metadata: { contentType: 'image/png' } });
  const halfUrl = `https://storage.googleapis.com/gstar-ai-studio-assets/${key}`;
  console.log(`Uploaded to ${halfUrl}`);

  const contor = (await db.collection('wardrobe').doc('ZB2GMhoH1hQDjdJQbD6d').get()).data() as any;
  const fitBack = contor.fitModels.back;

  for (const i of [1, 2, 3]) {
    console.log(`\n[halfsneaker-contor-${i}] generating…`);
    const t1 = Date.now();
    const result = await generateSeedreamImage({
      prompt: LEAN_PROMPT,
      referenceImages: [
        { url: halfUrl, label: '' },
        { url: fitBack.split('?')[0], label: '' },
      ],
      aspectRatio: '1:1',
    });
    fs.writeFileSync(path.join(OUT_DIR, `halfsneaker_contor_${i}.png`), result.imageData);
    console.log(`[halfsneaker-contor-${i}] DONE in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
