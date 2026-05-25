#!/usr/bin/env node
/**
 * One-shot Seedream 4.5 test with Bruno's "merge the two images" prompt.
 *
 * Usage:
 *   BYTEPLUS_API_KEY=... node scripts/test-seedream-bruno-prompt.mjs <matrixBaseUrl> <fitModelBackUrl>
 *
 * Saves the result to /tmp/seedream-bruno-test-<timestamp>.png
 * and prints the path on stdout.
 */
import { writeFileSync } from 'node:fs';

const [, , baseUrl, garmentUrl] = process.argv;
if (!baseUrl || !garmentUrl) {
  console.error('Usage: node test-seedream-bruno-prompt.mjs <matrixBaseUrl> <fitModelBackUrl>');
  process.exit(1);
}

const apiKey = process.env.BYTEPLUS_API_KEY;
if (!apiKey) {
  console.error('BYTEPLUS_API_KEY env var required');
  process.exit(1);
}

const BRUNO_PROMPT = `I want to apply the fitmodel jeans onto the AI model with shoes. so merge the two images, but the jeans should be fully respected in form and fit. all details need to be preserved`;

const body = {
  model: 'seedream-4-5-251128',
  prompt: BRUNO_PROMPT,
  image: [baseUrl, garmentUrl],
  size: '4096x4096',
  response_format: 'url',
  watermark: false,
};

console.log('[test] POST → ark.ap-southeast.bytepluses.com/api/v3/images/generations');
console.log(`[test] base: ...${baseUrl.slice(-60)}`);
console.log(`[test] garment: ...${garmentUrl.slice(-60)}`);
console.log(`[test] prompt: ${BRUNO_PROMPT}`);

const t0 = Date.now();
const res = await fetch('https://ark.ap-southeast.bytepluses.com/api/v3/images/generations', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(180_000),
});

if (!res.ok) {
  const txt = await res.text();
  console.error(`[test] ${res.status}: ${txt.slice(0, 500)}`);
  process.exit(2);
}
const json = await res.json();
const resultUrl = json?.data?.[0]?.url;
if (!resultUrl) {
  console.error('[test] no url in response:', JSON.stringify(json).slice(0, 500));
  process.exit(3);
}
console.log(`[test] generation done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`[test] result url: ${resultUrl}`);

const img = await fetch(resultUrl, { signal: AbortSignal.timeout(30_000) });
const bytes = Buffer.from(await img.arrayBuffer());
const outPath = `/tmp/seedream-bruno-test-${Date.now()}.png`;
writeFileSync(outPath, bytes);
console.log(`[test] saved ${bytes.length} bytes → ${outPath}`);
