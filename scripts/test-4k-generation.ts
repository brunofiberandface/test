#!/usr/bin/env npx tsx
/**
 * Test script: Verify which Gemini models support 4K image generation.
 *
 * Usage:
 *   GEMINI_API_KEY=your-key npx tsx scripts/test-4k-generation.ts
 *
 * Tests all 3 image generation models at all resolutions (512, 1K, 2K, 4K).
 * Reports: success/fail, image dimensions, generation time, file size.
 */

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('❌ Set GEMINI_API_KEY environment variable first.');
  console.error('   GEMINI_API_KEY=your-key npx tsx scripts/test-4k-generation.ts');
  process.exit(1);
}

const MODELS = [
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
  'gemini-2.5-flash-image',
];

const SIZES = ['512', '1K', '2K', '4K'];

const PROMPT = `Generate a simple full-body photograph of a male fashion model standing in a neutral pose against a pure white background. The model wears black athletic compression leggings (above-knee length) and a plain white fitted t-shirt. Arms relaxed at sides. Front-facing. Studio lighting.`;

interface TestResult {
  model: string;
  size: string;
  success: boolean;
  width?: number;
  height?: number;
  fileSizeKB?: number;
  durationMs?: number;
  error?: string;
}

async function testGeneration(model: string, imageSize: string): Promise<TestResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

  const start = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: '3:4',
            imageSize,
          },
        },
      }),
    });

    const durationMs = Date.now() - start;

    if (!response.ok) {
      const errorText = await response.text();
      // Extract just the error message, not the full JSON
      let shortError = `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(errorText);
        shortError = parsed.error?.message?.substring(0, 120) || shortError;
      } catch { shortError += `: ${errorText.substring(0, 120)}`; }

      return { model, size: imageSize, success: false, durationMs, error: shortError };
    }

    const result = await response.json();
    const candidate = result.candidates?.[0];

    if (!candidate?.content?.parts) {
      const finishReason = candidate?.finishReason || 'unknown';
      const safetyRatings = candidate?.safetyRatings?.map((r: any) => `${r.category}:${r.probability}`).join(', ') || '';
      return {
        model, size: imageSize, success: false, durationMs,
        error: `Empty response (finishReason=${finishReason}${safetyRatings ? ', safety=' + safetyRatings : ''})`
      };
    }

    for (const part of candidate.content.parts) {
      if (part.inlineData) {
        const buf = Buffer.from(part.inlineData.data, 'base64');
        const fileSizeKB = Math.round(buf.length / 1024);

        // Try to read image dimensions from the buffer (JPEG SOF0 marker)
        let width: number | undefined;
        let height: number | undefined;

        // Quick JPEG dimension extraction
        if (buf[0] === 0xFF && buf[1] === 0xD8) {
          let offset = 2;
          while (offset < buf.length - 8) {
            if (buf[offset] === 0xFF) {
              const marker = buf[offset + 1];
              if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
                height = buf.readUInt16BE(offset + 5);
                width = buf.readUInt16BE(offset + 7);
                break;
              }
              const segLen = buf.readUInt16BE(offset + 2);
              offset += 2 + segLen;
            } else {
              offset++;
            }
          }
        }

        // PNG dimension extraction
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
          width = buf.readUInt32BE(16);
          height = buf.readUInt32BE(20);
        }

        return { model, size: imageSize, success: true, width, height, fileSizeKB, durationMs };
      }
    }

    return { model, size: imageSize, success: false, durationMs, error: 'Response had parts but no inlineData' };

  } catch (err) {
    const durationMs = Date.now() - start;
    return { model, size: imageSize, success: false, durationMs, error: (err as Error).message.substring(0, 120) };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' G-Star AI Studio — Gemini 4K Image Generation Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Prompt: "${PROMPT.substring(0, 80)}..."`);
  console.log(`Aspect ratio: 3:4`);
  console.log(`Testing ${MODELS.length} models × ${SIZES.length} sizes = ${MODELS.length * SIZES.length} calls`);
  console.log('');

  const results: TestResult[] = [];

  for (const model of MODELS) {
    console.log(`\n── ${model} ──`);

    for (const size of SIZES) {
      process.stdout.write(`  ${size.padEnd(4)} ... `);

      const result = await testGeneration(model, size);
      results.push(result);

      if (result.success) {
        const dims = result.width && result.height ? `${result.width}×${result.height}` : '?×?';
        console.log(`✅ ${dims}  ${result.fileSizeKB}KB  ${(result.durationMs! / 1000).toFixed(1)}s`);
      } else {
        console.log(`❌ ${result.error}`);
      }

      // Rate limit protection — 25s between calls
      if (size !== SIZES[SIZES.length - 1] || model !== MODELS[MODELS.length - 1]) {
        process.stdout.write('  (waiting 25s for rate limit)...');
        await new Promise(r => setTimeout(r, 25000));
        process.stdout.write('\r' + ' '.repeat(50) + '\r');
      }
    }
  }

  // Summary table
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // Header
  const modelShort = (m: string) => m.replace('gemini-', '').replace('-preview', '').replace('-image', '');
  console.log(`${'Size'.padEnd(6)} ${MODELS.map(m => modelShort(m).padEnd(28)).join('')}`);
  console.log('─'.repeat(6 + 28 * MODELS.length));

  for (const size of SIZES) {
    let row = size.padEnd(6);
    for (const model of MODELS) {
      const r = results.find(x => x.model === model && x.size === size);
      if (r?.success) {
        const dims = r.width && r.height ? `${r.width}×${r.height}` : '?×?';
        row += `✅ ${dims} ${r.fileSizeKB}KB ${(r.durationMs! / 1000).toFixed(0)}s`.padEnd(28);
      } else {
        row += `❌ ${(r?.error || 'failed').substring(0, 22)}`.padEnd(28);
      }
    }
    console.log(row);
  }

  console.log('');

  // Recommendation
  const fourKResults = results.filter(r => r.size === '4K' && r.success);
  if (fourKResults.length > 0) {
    console.log('🎯 4K WORKS on:');
    for (const r of fourKResults) {
      console.log(`   ${modelShort(r.model)}: ${r.width}×${r.height}, ${r.fileSizeKB}KB, ${(r.durationMs! / 1000).toFixed(1)}s`);
    }

    // Find the best one (current model preferred, then by speed)
    const currentModel = fourKResults.find(r => r.model === 'gemini-3.1-flash-image-preview');
    const best = currentModel || fourKResults.sort((a, b) => (a.durationMs || 0) - (b.durationMs || 0))[0];
    console.log(`\n   Recommendation for dressed bases: ${best.model} at 4K`);
  } else {
    console.log('⚠️  4K failed on ALL models. Stick with 2K for now.');
    const twoKResults = results.filter(r => r.size === '2K' && r.success);
    if (twoKResults.length > 0) {
      console.log('   2K works on: ' + twoKResults.map(r => modelShort(r.model)).join(', '));
    }
  }
}

main().catch(console.error);
