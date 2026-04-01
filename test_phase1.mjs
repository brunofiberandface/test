#!/usr/bin/env node
/**
 * Phase 1 test — generates garment template from mannequin photos.
 * Tests if the mannequin straps → overalls hallucination is fixed.
 *
 * Usage:
 *   export GEMINI_API_KEY=your-key
 *   # First save mannequin photos:
 *   mkdir -p test_inputs
 *   gsutil cp gs://gstar-ai-studio-assets/input/D27736-E358-J174/360/360_00.jpg test_inputs/
 *   gsutil cp gs://gstar-ai-studio-assets/input/D27736-E358-J174/360/360_01.jpg test_inputs/
 *   gsutil cp gs://gstar-ai-studio-assets/input/D27736-E358-J174/360/360_02.jpg test_inputs/
 *
 *   node test_phase1.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

// ── Helper: call Gemini ──
async function callGemini(model, parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
  for (let attempt = 0; attempt <= 2; attempt++) {
    console.log(`     Attempt ${attempt + 1}/3...`);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: '9:16', imageSize: '4K' },
        },
      }),
    });
    if (resp.status === 429) {
      const delay = [45, 60, 90][attempt] * 1000;
      console.log(`     ⏳ Rate limited, waiting ${delay/1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
    const result = await resp.json();
    const candidate = result.candidates?.[0];
    if (!candidate?.content?.parts) {
      if (attempt < 2) { console.log('     ⏳ Empty, retrying...'); await new Promise(r => setTimeout(r, 15000)); continue; }
      throw new Error('No image after retries');
    }
    for (const part of candidate.content.parts) {
      if (part.inlineData) return Buffer.from(part.inlineData.data, 'base64');
    }
    throw new Error('No image data');
  }
}

console.log('\n🔧 Phase 1 Test — Mannequin → Garment Template');
console.log('   Testing: does it generate JEANS or OVERALLS?\n');

// ── Load mannequin photos ──
const inputDir = path.join(__dirname, 'test_inputs');
const mannequinFiles = fs.readdirSync(inputDir).filter(f => f.startsWith('360_') && f.endsWith('.jpg')).sort();

if (mannequinFiles.length === 0) {
  console.error('No mannequin photos in test_inputs/. Download them first:');
  console.log('  gsutil cp "gs://gstar-ai-studio-assets/input/D27736-E358-J174/360/360_0*.jpg" test_inputs/');
  process.exit(1);
}

console.log(`   Found ${mannequinFiles.length} mannequin photos: ${mannequinFiles.join(', ')}`);

// ── Build parts ──
const parts = [];

// Add mannequin images
for (const file of mannequinFiles) {
  const buf = fs.readFileSync(path.join(inputDir, file));
  parts.push({ inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } });
  parts.push({ text: `MANNEQUIN 360° REFERENCE — ${file}\n\n` });
}

// Phase 1 prompt WITH the fix (garment category + mannequin straps rule)
const GARMENT_CATEGORY = 'pants';  // This is what the product actually is

parts.push({ text: `You are a fashion e-commerce photographer. Generate a FRONT VIEW garment template image. The model faces the camera.

TASK: Reproduce this EXACT garment on a generic female model.

GARMENT TYPE: This product is "${GARMENT_CATEGORY.toUpperCase()}". Generate ONLY this garment type — nothing else.

CRITICAL — GARMENT FIDELITY:
- The mannequin reference images are the GROUND TRUTH. Match the exact wash, color, fading pattern.
- Match every construction detail: pockets (shape, placement, stitching), seams, belt loops, waistband, hardware.
- Match the silhouette exactly — if it's a flare, the flare width must match. If straight, keep straight.
- Do NOT invent details. No labels, patches, or stitching that don't exist in the reference.

CRITICAL — MANNEQUIN STRAPS ARE NOT GARMENT STRAPS:
- The mannequin torso has SHOULDER STRAPS, BANDS, and SUPPORT HARDWARE that hold the form together.
- These straps are EQUIPMENT — they are NOT denim straps, NOT overall straps, NOT part of the garment.
- If you see straps on the mannequin shoulders + denim pants below, the garment is PANTS/JEANS — NOT overalls or dungarees.
- The GARMENT TYPE above tells you what this product is. Trust the category, not the mannequin hardware.
- Generating overalls/dungarees when the product is pants or jeans is a CRITICAL FAILURE.

CRITICAL — DO NOT ADD DISTRESSING:
- Do NOT add tears, rips, fraying, distressing, or worn patches UNLESS they are CLEARLY visible in the mannequin photos.
- Clean denim is CLEAN — smooth, non-distressed fabric must stay smooth and non-distressed.

MODEL: Generic anonymous female, medium build.
POSE: Standing front-facing, arms at sides, feet hip-width apart.
FOOTWEAR: Simple shoes matching the garment style.
TOP: Simple olive green crop top (just for context, not the focus).
BACKGROUND: Clean off-white studio, soft even lighting.
ASPECT: 9:16 portrait, full body head to toe visible.

The reference images show the garment from multiple angles on a mannequin. Use them ALL to understand the 3D construction, then render with photographic realism.` });

// ── Run ──
const outDir = path.join(__dirname, 'test_outputs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

console.log(`\n   Running Phase 1 with PRO (gemini-3-pro-image-preview)...`);
const start = Date.now();
try {
  const imageData = await callGemini('gemini-3-pro-image-preview', parts);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const outFile = `phase1_fixed_${Date.now()}.png`;
  fs.writeFileSync(path.join(outDir, outFile), imageData);
  console.log(`   ✅ Done in ${elapsed}s → test_outputs/${outFile}`);
  console.log(`\n   Open it — is it JEANS or OVERALLS?`);
} catch (e) {
  console.error(`   ❌ Failed: ${e.message}`);
}

process.exit(0);
