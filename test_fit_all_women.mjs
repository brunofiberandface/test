#!/usr/bin/env node
/**
 * Fit model test — all 5 women's products, front + back views.
 * Two variants per product per view:
 *   F = Fit model only (8 photos)
 *   FM = Fit model (4) + Mannequin (4) combined
 *
 * Total: 5 products × 2 views × 2 variants = 20 generations
 *
 * Usage:
 *   export GEMINI_API_KEY=your-key
 *   node test_fit_all_women.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const MODEL = 'gemini-3-pro-image-preview';
const SHOOT_DIR = path.join(__dirname, '..', 'AI shoot 24-3-26', 'WOMEN');

const PRODUCTS = [
  { sfc: 'D26163-E205-H918', name: 'G-Straight Jeans', fit: 'Straight fit, mid waist, full length, straight leg' },
  { sfc: 'D25372-E267-H544', name: 'Bowey Barrel Jeans', fit: 'Boyfriend fit, low waist, relaxed at hips/thighs, long length' },
  { sfc: 'D15264-D931-H095', name: 'Kate Boyfriend Jeans', fit: 'Boyfriend fit, low waist, relaxed at hips/thighs, dropped crotch' },
  { sfc: 'D21290-A634-G730', name: '3301 Flare Jeans', fit: 'Bootcut fit, mid waist, tight through thigh, flared towards hem' },
  { sfc: 'D22889-E353-H487', name: 'Judee Low Waist Loose Jeans', fit: 'Loose fit, low waist, straight leg fitting loosely' },
];

// ── Helper: call Gemini ──
async function callGemini(parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  for (let attempt = 0; attempt <= 2; attempt++) {
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
      if (attempt < 2) { console.log('     ⏳ Empty, retrying in 15s...'); await new Promise(r => setTimeout(r, 15000)); continue; }
      throw new Error('No image after retries');
    }
    for (const part of candidate.content.parts) {
      if (part.inlineData) return Buffer.from(part.inlineData.data, 'base64');
    }
    throw new Error('No image data');
  }
}

// ── Load images from directory ──
function loadImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /\.(jpg|JPG|jpeg|png)$/i.test(f)).sort()
    .map(f => ({ name: f, buffer: fs.readFileSync(path.join(dir, f)) }));
}

// ── Build prompt ──
function buildPrompt(view, fitDesc) {
  const isBack = view === 'back';
  return `You are a fashion e-commerce photographer. Generate a ${isBack ? 'BACK' : 'FRONT'} VIEW garment template image. The model faces ${isBack ? 'AWAY from' : 'the'} camera${isBack ? ', showing the back of the garment' : ''}.

TASK: Reproduce this EXACT garment on a generic female model.

GARMENT TYPE: This product is "PANTS" (jeans). Generate ONLY jeans — nothing else.
FIT: ${fitDesc}

CRITICAL — GARMENT FIDELITY:
- The reference images are the GROUND TRUTH. Match the exact wash, color, fading pattern.
- Match every construction detail: pockets, seams, belt loops, waistband, hardware.
- Match the silhouette exactly.
- Do NOT invent details.

CRITICAL — MANNEQUIN STRAPS ARE NOT GARMENT STRAPS:
- Any mannequin reference may show shoulder straps/support bands — these are EQUIPMENT, NOT part of the garment.
- This product is JEANS — NOT overalls or dungarees.

CRITICAL — DO NOT ADD DISTRESSING:
- Do NOT add tears, rips, fraying, or worn patches UNLESS clearly visible in the reference photos.

MODEL: Generic anonymous female, medium build.
POSE: Standing ${isBack ? 'back to camera' : 'front-facing'}, arms at sides, feet hip-width apart.
FOOTWEAR: Simple shoes.
TOP: Simple olive green crop top.
BACKGROUND: Clean off-white studio, soft even lighting.
ASPECT: 9:16 portrait, full body head to toe visible.`;
}

// ── Build reference parts ──
function buildFitOnlyParts(fitImgs, view, fitDesc) {
  const parts = [];
  for (let i = 0; i < fitImgs.length; i++) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: fitImgs[i].buffer.toString('base64') } });
    parts.push({ text: `FIT MODEL REFERENCE #${i+1}: Shows the jeans on a real human body (top-down photo). Use for: fabric DRAPE, FIT, SILHOUETTE, WASH COLOR, and construction details. Ignore white socks and t-shirt — not part of the product.\n\n` });
  }
  parts.push({ text: buildPrompt(view, fitDesc) });
  return parts;
}

function buildCombinedParts(fitImgs, mannImgs, view, fitDesc) {
  const parts = [];
  // 4 mannequin for construction
  const mannSample = mannImgs.slice(0, 4);
  for (let i = 0; i < mannSample.length; i++) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: mannSample[i].buffer.toString('base64') } });
    parts.push({ text: `MANNEQUIN CONSTRUCTION REFERENCE #${i+1}: Use ONLY for: pocket shape/placement, stitching, hardware (buttons, rivets), belt loops, waistband. IGNORE mannequin shoulder straps — those are equipment.\n\n` });
  }
  // 4 fit model for drape
  const fitSample = fitImgs.slice(0, 4);
  for (let i = 0; i < fitSample.length; i++) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: fitSample[i].buffer.toString('base64') } });
    parts.push({ text: `FIT MODEL DRAPE REFERENCE #${i+1}: Shows jeans on a real body (top-down). Use for: fabric DRAPE, FIT on hips/thighs/knees, natural CREASES, true WASH COLOR. Ignore white socks and t-shirt.\n\n` });
  }
  parts.push({ text: buildPrompt(view, fitDesc) });
  return parts;
}

// ══════════════════════════════════
console.log('\n🔬 All Women — Fit Model Test (Front + Back)');
console.log('══════════════════════════════════════════════');
console.log(`   Products: ${PRODUCTS.length}`);
console.log(`   Views: front + back`);
console.log(`   Variants: F (fit only), FM (fit + mannequin)`);
console.log(`   Total generations: ${PRODUCTS.length * 2 * 2}`);
console.log('');

const outDir = path.join(__dirname, 'test_outputs', 'fit_all_women');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

let completed = 0;
const total = PRODUCTS.length * 2 * 2;

for (const product of PRODUCTS) {
  const fitDir = path.join(SHOOT_DIR, product.sfc, 'Fit model');
  const mannDir = path.join(SHOOT_DIR, product.sfc, 'Mannequin');

  const fitImgs = loadImages(fitDir);
  const mannImgs = loadImages(mannDir);

  console.log(`\n━━ ${product.sfc} — ${product.name} ━━`);
  console.log(`   Fit model: ${fitImgs.length}, Mannequin: ${mannImgs.length}`);

  if (fitImgs.length === 0) {
    console.log(`   ❌ No fit model photos — skipping`);
    continue;
  }

  for (const view of ['front', 'back']) {
    for (const variant of ['F', 'FM']) {
      const label = `${product.sfc}_${view}_${variant}`;
      completed++;
      console.log(`\n   [${completed}/${total}] ${label} — ${view} ${variant === 'F' ? 'fit only' : 'fit+mannequin'}...`);

      const parts = variant === 'F'
        ? buildFitOnlyParts(fitImgs, view, product.fit)
        : buildCombinedParts(fitImgs, mannImgs, view, product.fit);

      const start = Date.now();
      try {
        const imageData = await callGemini(parts);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const outFile = `${label}_${Date.now()}.png`;
        fs.writeFileSync(path.join(outDir, outFile), imageData);
        console.log(`   ✅ ${elapsed}s → ${outFile} (${(imageData.length/1024).toFixed(0)}KB)`);
      } catch (e) {
        console.error(`   ❌ Failed: ${e.message}`);
      }

      // Small delay between generations to avoid rate limits
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

console.log('\n══════════════════════════════════════════════');
console.log(`✅ Done! Check test_outputs/fit_all_women/`);
console.log('   Files named: {SFC}_{front|back}_{F|FM}_{timestamp}.png');
console.log('   F = fit model only, FM = fit + mannequin combined');
console.log('══════════════════════════════════════════════\n');
process.exit(0);
