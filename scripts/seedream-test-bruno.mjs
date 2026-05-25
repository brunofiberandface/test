import { writeFileSync } from 'node:fs';
import { Firestore } from '@google-cloud/firestore';

const apiKey = process.env.BYTEPLUS_API_KEY;
if (!apiKey) { console.error('BYTEPLUS_API_KEY required'); process.exit(1); }

// Fetch the matrix legsBack URL (only Firestore call needed)
const db = new Firestore({ projectId: 'gstar-ai-studio' });
const CELL_ID = process.env.CELL_ID || 'fYUJOCJuUo5fFeTb4fNH_F1';
const cell = (await db.collection('qaShoeMatrix').doc(CELL_ID).get()).data();
if (!cell) { console.error(`cell ${CELL_ID} not found`); process.exit(1); }
const baseUrl = cell.images.legsBack.split('?')[0];
const garmentUrl = process.env.GARMENT_URL || 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/Rq3K3UQGdJmVu4W0LwgK/fitmodel_back.jpg';
const tag = process.env.TAG || '';

console.log(`base:    ${baseUrl}`);
console.log(`garment: ${garmentUrl}`);

const body = {
  model: 'seedream-4-5-251128',
  prompt: process.env.PROMPT || `Apply the fitmodel trousers onto the AI model with shoes. so merge the two images, but the trousers should be fully respected in form and fit. all details need to be preserved, IMPORTANT is the trousers run naturally down OVER the shoes, respecting the fitmodel lenght of the trousers. the trousers run all the way to the soles of the shoes, long length and covering the back of the shoes as they run over. the model needs to stand equally on 2 feet, 50% on each foot, keeping the same position as the underwear model`,
  image: [baseUrl, garmentUrl],
  size: '4096x4096',     // Production-equivalent 4K. ~45-60s generation.
  response_format: 'url',
  watermark: false,
};

console.log(`POST → seedream (4K, ~45-60s)…`);
const t0 = Date.now();
const heartbeat = setInterval(() => process.stdout.write(`  ${Math.round((Date.now() - t0) / 1000)}s…\n`), 10_000);
const res = await fetch('https://ark.ap-southeast.bytepluses.com/api/v3/images/generations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(180_000),
});
clearInterval(heartbeat);
if (!res.ok) { console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`); process.exit(2); }
const json = await res.json();
const url = json?.data?.[0]?.url;
if (!url) { console.error('no url:', JSON.stringify(json).slice(0, 400)); process.exit(3); }
console.log(`generated in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
const bytes = Buffer.from(await img.arrayBuffer());
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outPath = `./seedream-bruno-test-${CELL_ID}${tag ? '-' + tag : ''}-${stamp}.png`;
writeFileSync(outPath, bytes);
console.log(`saved ${bytes.length} bytes → ${process.cwd()}/${outPath.slice(2)}`);
process.exit(0);
