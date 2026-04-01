#!/usr/bin/env node
/**
 * Test: Mannequin only vs Fit model only vs Combined
 * Runs Phase 1 (garment template) with three different reference sets.
 *
 * Usage:
 *   export GEMINI_API_KEY=your-key
 *   # Copy fit model + mannequin photos to test_inputs/:
 *   cp "/path/to/AI shoot 24-3-26/WOMEN/D26163-E205-H918/Mannequin/"*.JPG test_inputs/mannequin/
 *   cp "/path/to/AI shoot 24-3-26/WOMEN/D26163-E205-H918/Fit model/"*.JPG test_inputs/fitmodel/
 *
 *   node test_fit_vs_mannequin.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const MODEL = 'gemini-3-pro-image-preview';
const GARMENT_CATEGORY = 'pants';

// ── Helper: call Gemini ──
async function callGemini(parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
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

// ── Load images from a directory ──
function loadImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.(jpg|JPG|jpeg|png)$/i.test(f))
    .sort()
    .map(f => ({
      name: f,
      buffer: fs.readFileSync(path.join(dir, f)),
    }));
}

// ── Build Phase 1 prompt ──
function buildPrompt() {
  return `You are a fashion e-commerce photographer. Generate a FRONT VIEW garment template image. The model faces the camera.

TASK: Reproduce this EXACT garment on a generic female model.

GARMENT TYPE: This product is "${GARMENT_CATEGORY.toUpperCase()}". Generate ONLY this garment type — nothing else.

CRITICAL — GARMENT FIDELITY:
- The reference images are the GROUND TRUTH. Match the exact wash, color, fading pattern.
- Match every construction detail: pockets (shape, placement, stitching), seams, belt loops, waistband, hardware.
- Match the silhouette exactly — if it's a flare, the flare width must match. If straight, keep straight.
- Do NOT invent details. No labels, patches, or stitching that don't exist in the reference.

CRITICAL — MANNEQUIN STRAPS ARE NOT GARMENT STRAPS:
- The mannequin torso has SHOULDER STRAPS and SUPPORT HARDWARE — these are EQUIPMENT, NOT part of the garment.
- If you see straps on the mannequin shoulders + denim pants below, the garment is PANTS/JEANS — NOT overalls.
- Trust the GARMENT TYPE above, not the mannequin hardware.

CRITICAL — DO NOT ADD DISTRESSING:
- Do NOT add tears, rips, fraying, or worn patches UNLESS clearly visible in the reference photos.
- Clean denim must stay clean and smooth.

MODEL: Generic anonymous female, medium build.
POSE: Standing front-facing, arms at sides, feet hip-width apart.
FOOTWEAR: Simple shoes.
TOP: Simple olive green crop top.
BACKGROUND: Clean off-white studio, soft even lighting.
ASPECT: 9:16 portrait, full body head to toe visible.`;
}

// ══════════════════════════════════
console.log('\n🔬 Fit Model vs Mannequin — Phase 1 Comparison');
console.log('════════════════════════════════════════════════\n');

const mannequinDir = path.join(__dirname, 'test_inputs', 'mannequin');
const fitmodelDir = path.join(__dirname, 'test_inputs', 'fitmodel');

const mannequinImgs = loadImages(mannequinDir);
const fitmodelImgs = loadImages(fitmodelDir);

console.log(`   Mannequin photos: ${mannequinImgs.length}`);
console.log(`   Fit model photos: ${fitmodelImgs.length}`);

if (mannequinImgs.length === 0 && fitmodelImgs.length === 0) {
  console.error('\n   No images found. Copy them first:');
  console.error('   mkdir -p test_inputs/mannequin test_inputs/fitmodel');
  console.error('   cp "AI shoot .../Mannequin/"*.JPG test_inputs/mannequin/');
  console.error('   cp "AI shoot .../Fit model/"*.JPG test_inputs/fitmodel/');
  process.exit(1);
}

const outDir = path.join(__dirname, 'test_outputs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// ── Define the 3 test variants ──
const tests = [];

if (mannequinImgs.length > 0) {
  tests.push({
    name: 'A_mannequin_only',
    label: 'Mannequin Only (current approach)',
    images: mannequinImgs.map((img, i) => ({
      buffer: img.buffer,
      label: `MANNEQUIN 360° REFERENCE #${i + 1} — ${img.name}: Shows garment construction details (pockets, stitching, hardware, wash, seams). Use for CONSTRUCTION ACCURACY.`,
    })),
  });
}

if (fitmodelImgs.length > 0) {
  tests.push({
    name: 'B_fitmodel_only',
    label: 'Fit Model Only (no mannequin)',
    images: fitmodelImgs.map((img, i) => ({
      buffer: img.buffer,
      label: `FIT MODEL REFERENCE #${i + 1} — ${img.name}: Shows the jeans on a real human body. The model is lying down (top-down photo). Use for: fabric DRAPE, FIT (how the jeans sit on hips/thighs/knees), SILHOUETTE, and WASH COLOR. Ignore the white socks and white t-shirt — those are not part of the product.`,
    })),
  });
}

if (mannequinImgs.length > 0 && fitmodelImgs.length > 0) {
  // Take 4 mannequin + 4 fit model to stay within token limits
  const mannSample = mannequinImgs.slice(0, 4);
  const fitSample = fitmodelImgs.slice(0, 4);
  tests.push({
    name: 'C_combined',
    label: 'Combined (4 mannequin + 4 fit model)',
    images: [
      ...mannSample.map((img, i) => ({
        buffer: img.buffer,
        label: `MANNEQUIN CONSTRUCTION REFERENCE #${i + 1}: Shows garment on a mannequin form. Use ONLY for: pocket shape/placement, stitching patterns, hardware (buttons, rivets), belt loops, waistband construction. IGNORE the mannequin shoulder straps — those are equipment, not garment features.`,
      })),
      ...fitSample.map((img, i) => ({
        buffer: img.buffer,
        label: `FIT MODEL DRAPE REFERENCE #${i + 1}: Shows the same jeans on a real human body (top-down photo). Use for: how the fabric DRAPES and FALLS, the actual FIT on hips/thighs/knees, natural CREASES and WRINKLES, and the true WASH COLOR on fabric. Ignore white socks and t-shirt.`,
      })),
    ],
  });
}

// ── Run tests ──
for (const test of tests) {
  console.log(`\n── Test ${test.name}: ${test.label} ──`);
  console.log(`   Reference images: ${test.images.length}`);

  const parts = [];
  for (const img of test.images) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: img.buffer.toString('base64') } });
    parts.push({ text: img.label + '\n\n' });
  }
  parts.push({ text: buildPrompt() });

  const start = Date.now();
  try {
    const imageData = await callGemini(parts);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const outFile = `${test.name}_${Date.now()}.png`;
    fs.writeFileSync(path.join(outDir, outFile), imageData);
    console.log(`   ✅ Done in ${elapsed}s → test_outputs/${outFile}`);
  } catch (e) {
    console.error(`   ❌ Failed: ${e.message}`);
  }
}

console.log('\n════════════════════════════════════════════════');
console.log('✅ Done! Compare A vs B vs C in test_outputs/');
console.log('════════════════════════════════════════════════\n');
process.exit(0);
