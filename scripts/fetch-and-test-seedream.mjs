#!/usr/bin/env node
/**
 * Look up the two image URLs from Firestore + call Seedream 4.5 with Bruno's
 * raw "merge the two images" prompt. Saves the result image locally.
 *
 * Run from /sessions/nifty-dreamy-cori/mnt/gstar/gstar-studio with
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa_key.json
 *   BYTEPLUS_API_KEY=...
 *   node scripts/fetch-and-test-seedream.mjs
 */
import { writeFileSync } from 'node:fs';
import { Firestore } from '@google-cloud/firestore';

const CELL_ID = 'PiLqQo7ObRvPrwBvbwZS_F1';     // shoe_model from /qa/shoe-matrix link
const BOTTOM_NAME_NEEDLE = 'bowey barrel';      // case-insensitive match on item name

const apiKey = process.env.BYTEPLUS_API_KEY;
if (!apiKey) { console.error('BYTEPLUS_API_KEY required'); process.exit(1); }

const db = new Firestore({ projectId: 'gstar-ai-studio' });

// 1. Matrix cell → images.legsBack
const cellSnap = await db.collection('qaShoeMatrix').doc(CELL_ID).get();
if (!cellSnap.exists) { console.error(`cell ${CELL_ID} not found`); process.exit(2); }
const cell = cellSnap.data();
const baseUrl = cell?.images?.legsBack;
if (!baseUrl) { console.error('legsBack missing on cell. images keys:', Object.keys(cell?.images || {})); process.exit(3); }
console.log(`[lookup] matrix base (legsBack): ${baseUrl.slice(0, 90)}...`);

// 2. Wardrobe item by name match → fitModels.back
const wsnap = await db.collection('wardrobe').get();
let bottomDoc = null;
wsnap.forEach(d => {
  const n = (d.data().name || '').toLowerCase();
  if (n.includes(BOTTOM_NAME_NEEDLE)) {
    if (!bottomDoc || n.includes('53')) bottomDoc = { id: d.id, ...d.data() };
  }
});
if (!bottomDoc) { console.error(`no wardrobe item matching "${BOTTOM_NAME_NEEDLE}"`); process.exit(4); }
console.log(`[lookup] wardrobe: ${bottomDoc.id} "${bottomDoc.name}"`);
const garmentUrl = bottomDoc?.fitModels?.back || bottomDoc?.fitModelBack || bottomDoc?.flatBackUrl;
if (!garmentUrl) {
  console.error('no back fit-model on item. keys:', Object.keys(bottomDoc));
  console.error('fitModels keys:', Object.keys(bottomDoc.fitModels || {}));
  process.exit(5);
}
console.log(`[lookup] garment back: ${garmentUrl.slice(0, 90)}...`);

// 3. Seedream call
const BRUNO_PROMPT = `I want to apply the fitmodel jeans onto the AI model with shoes. so merge the two images, but the jeans should be fully respected in form and fit. all details need to be preserved`;
const body = {
  model: 'seedream-4-5-251128',
  prompt: BRUNO_PROMPT,
  image: [baseUrl.split('?')[0], garmentUrl.split('?')[0]],
  size: '4096x4096',
  response_format: 'url',
  watermark: false,
};
console.log(`[seedream] POST size=${body.size}, refs=2`);
const t0 = Date.now();
const res = await fetch('https://ark.ap-southeast.bytepluses.com/api/v3/images/generations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(180_000),
});
if (!res.ok) { console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`); process.exit(6); }
const json = await res.json();
const resultUrl = json?.data?.[0]?.url;
if (!resultUrl) { console.error('no url in response:', JSON.stringify(json).slice(0, 400)); process.exit(7); }
console.log(`[seedream] generated in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const img = await fetch(resultUrl, { signal: AbortSignal.timeout(30_000) });
const bytes = Buffer.from(await img.arrayBuffer());
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outPath = `/sessions/nifty-dreamy-cori/mnt/gstar/test_seedream_bruno_${stamp}.png`;
writeFileSync(outPath, bytes);
console.log(`[done] ${bytes.length} bytes → ${outPath}`);
console.log(`[done] base URL: ${baseUrl.split('?')[0]}`);
console.log(`[done] garment URL: ${garmentUrl.split('?')[0]}`);
