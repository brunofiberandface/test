/**
 * Test how high Seedream will go on output resolution.
 *
 * BytePlus has a minimum (3.69M pixels — already enforced empirically). We
 * don't know the MAX, and our pipeline currently caps at 2048×2048 (4.2M).
 * If Seedream accepts e.g. 4096×4096 (16.8M), we can render at native 4K
 * without AI super-resolution downstream.
 *
 * This script fires a minimal Seedream request at progressively larger sizes
 * and reports which succeed. We use a generic photo prompt + a backdrop ref
 * to make it a realistic call (BytePlus rejects empty ref arrays).
 *
 * Usage:
 *   BYTEPLUS_API_KEY=<key> npx tsx scripts/test-seedream-max-resolution.ts
 *
 * Cost: each successful call ~$0.04 (Seedream 4.5 pricing) × N sizes ≈ $0.20.
 */
import * as fs from 'fs';
import * as path from 'path';

const API_KEY = process.env.BYTEPLUS_API_KEY;
if (!API_KEY) {
  console.error('Set BYTEPLUS_API_KEY in env. Get it from Cloud Run env or 1Password.');
  process.exit(1);
}

const OUT_DIR = path.join(process.cwd(), 'test_outputs', 'seedream-resolution');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Plain prompt + a backdrop ref. Realistic enough that BytePlus won't reject
// the request structure; the prompt is irrelevant to the resolution test.
const TEST_PROMPT = `Photorealistic studio e-commerce photograph, 1:1 square. Fashion model standing front-view on a clean light-grey studio backdrop (#D9DAD2). Soft diffused 5500K studio lighting. The model wears plain black sports bra + simple plain blue denim jeans + simple black low-heel shoes. Bilaterally symmetric pose, both feet flat at shoulder width, weight 50/50, arms hanging straight at sides.`;

const BACKDROP_REF = 'https://storage.googleapis.com/gstar-ai-studio-assets/backdrops/clean-studio-grey.jpg';

const TEST_SIZES = [
  // Current production sizes (baseline) — should always work
  '2048x2048', // 1:1 — current
  // Production aspects at 4K (the target)
  '4096x4096', // 1:1 4K — used by M06 + future native M01/M02
  '2304x4096', // 9:16 4K — used by M03/M04
  '3072x4096', // 3:4 4K — used by M01/M02 if we keep 3:4
];

async function testSize(size: string): Promise<{ size: string; ok: boolean; bytes?: number; error?: string; timeMs?: number }> {
  const t0 = Date.now();
  try {
    const resp = await fetch('https://ark.ap-southeast.bytepluses.com/api/v3/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'seedream-4-5-251128',  // production default (4.5)
        prompt: TEST_PROMPT,
        image: [BACKDROP_REF],
        sequential_image_generation: 'disabled',
        response_format: 'url',
        size,
        stream: false,
        watermark: false,
      }),
    });

    const text = await resp.text();
    if (!resp.ok) {
      return { size, ok: false, error: `${resp.status}: ${text.slice(0, 300)}`, timeMs: Date.now() - t0 };
    }
    const data = JSON.parse(text);
    const imageUrl = data?.data?.[0]?.url;
    if (!imageUrl) {
      return { size, ok: false, error: `no image url in response: ${text.slice(0, 300)}`, timeMs: Date.now() - t0 };
    }

    // Download + save so Bruno can inspect each size
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) {
      return { size, ok: true, error: `image url fetch failed: ${imgResp.status}`, timeMs: Date.now() - t0 };
    }
    const buf = Buffer.from(await imgResp.arrayBuffer());
    const outPath = path.join(OUT_DIR, `seedream_${size}.png`);
    fs.writeFileSync(outPath, buf);

    return { size, ok: true, bytes: buf.length, timeMs: Date.now() - t0 };
  } catch (e) {
    return { size, ok: false, error: e instanceof Error ? e.message : String(e), timeMs: Date.now() - t0 };
  }
}

async function main() {
  console.log(`Testing Seedream max output resolution\nOut dir: ${OUT_DIR}\n`);
  for (const size of TEST_SIZES) {
    process.stdout.write(`Trying ${size} ... `);
    const result = await testSize(size);
    if (result.ok) {
      console.log(`✓ ${(result.bytes! / 1024 / 1024).toFixed(2)} MB in ${(result.timeMs! / 1000).toFixed(1)}s`);
    } else {
      console.log(`✗ ${result.timeMs ? `(${(result.timeMs / 1000).toFixed(1)}s) ` : ''}${result.error}`);
      // If we got an explicit "size too big" error, no point trying bigger
      if (result.error?.toLowerCase().includes('size') || result.error?.includes('400')) {
        console.log(`  → stopping (size rejected by API; bigger sizes will also fail)`);
        break;
      }
    }
  }
  console.log(`\nDone. Check ${OUT_DIR} for outputs.`);
}

main().catch(e => { console.error(e); process.exit(1); });
