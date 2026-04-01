#!/usr/bin/env node
/**
 * Test: Verify which Gemini models support 4K image generation.
 * Pure Node.js — no dependencies, no tsx.
 *
 * Usage:   GEMINI_API_KEY=your-key node scripts/test-4k.mjs
 */

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('❌ Set GEMINI_API_KEY first:  GEMINI_API_KEY=xxx node scripts/test-4k.mjs');
  process.exit(1);
}

const MODELS = [
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
  'gemini-2.5-flash-image',
];

const SIZES = ['1K', '2K', '4K'];

const PROMPT = `Generate a simple full-body photograph of a male fashion model standing in a neutral pose against a pure white background. The model wears black athletic compression leggings (above-knee length) and a plain white fitted t-shirt. Arms relaxed at sides. Front-facing. Studio lighting.`;

function readJpegDims(buf) {
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let offset = 2;
    while (offset < buf.length - 8) {
      if (buf[offset] === 0xFF) {
        const marker = buf[offset + 1];
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
        }
        const segLen = buf.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      } else { offset++; }
    }
  }
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  return null;
}

async function test(model, imageSize) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: '3:4', imageSize },
        },
      }),
    });

    const ms = Date.now() - start;

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); msg = (j.error?.message || msg).substring(0, 100); } catch {}
      return { ok: false, ms, error: msg };
    }

    const json = await res.json();
    const parts = json.candidates?.[0]?.content?.parts;
    if (!parts) {
      const reason = json.candidates?.[0]?.finishReason || 'empty';
      return { ok: false, ms, error: `No image (${reason})` };
    }

    for (const p of parts) {
      if (p.inlineData) {
        const buf = Buffer.from(p.inlineData.data, 'base64');
        const dims = readJpegDims(buf);
        return {
          ok: true, ms,
          width: dims?.width, height: dims?.height,
          kb: Math.round(buf.length / 1024),
        };
      }
    }
    return { ok: false, ms, error: 'No inlineData in parts' };

  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: e.message?.substring(0, 100) };
  }
}

async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log(' G-Star AI Studio — 4K Image Generation Test');
  console.log('══════════════════════════════════════════════════════\n');

  const results = [];

  for (const model of MODELS) {
    const short = model.replace('gemini-', '').replace('-preview', '').replace('-image', '');
    console.log(`── ${short} ──`);

    for (const size of SIZES) {
      process.stdout.write(`  ${size.padEnd(4)} ... `);

      const r = await test(model, size);
      r.model = model;
      r.size = size;
      results.push(r);

      if (r.ok) {
        console.log(`✅ ${r.width}×${r.height}  ${r.kb}KB  ${(r.ms / 1000).toFixed(1)}s`);
      } else {
        console.log(`❌ ${r.error}  (${(r.ms / 1000).toFixed(1)}s)`);
      }

      // Rate limit gap
      const isLast = model === MODELS[MODELS.length - 1] && size === SIZES[SIZES.length - 1];
      if (!isLast) {
        process.stdout.write('  (25s rate limit wait)');
        await new Promise(r => setTimeout(r, 25000));
        process.stdout.write('\r' + ' '.repeat(40) + '\r');
      }
    }
    console.log('');
  }

  // Summary
  console.log('══════════════════════════════════════════════════════');
  console.log(' SUMMARY\n');

  const fourK = results.filter(r => r.size === '4K' && r.ok);
  if (fourK.length) {
    console.log('🎯 4K WORKS on:');
    for (const r of fourK) {
      const short = r.model.replace('gemini-', '').replace('-preview', '').replace('-image', '');
      console.log(`   ${short}: ${r.width}×${r.height}, ${r.kb}KB, ${(r.ms / 1000).toFixed(1)}s`);
    }
  } else {
    console.log('⚠️  4K failed on ALL models.');
  }
}

main().catch(console.error);
