#!/usr/bin/env node
/**
 * Flash vs Pro Phase 2 comparison test.
 * NO Firebase dependency — downloads assets via the deployed app's GCS public URLs.
 *
 * Usage:
 *   export GEMINI_API_KEY=AIzaSy...
 *   node test_flash_vs_pro.mjs
 *
 * What it does:
 *   1. Downloads the Phase 1 garment anchor + dressed base from GCS
 *   2. Runs Phase 2 with FLASH and PRO
 *   3. Saves both to test_outputs/ for comparison
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('❌ Set GEMINI_API_KEY env var'); process.exit(1); }

// ── GCS asset URLs for job Ea0dYSLLtikQN0lJYcGC (D27736-E358-J174, model M1) ──
// These are the exact assets the production app used.
// If you want to test a different job, replace these URLs.
const ASSETS = {
  // Phase 1 garment anchor (Pro-generated garment template)
  phase1Anchor: 'https://storage.googleapis.com/gstar-ai-studio-assets/output/D27736-E358-J174/phase1-anchor-Ea0dYSLLtikQN0lJYcGC.png',
  // Dressed base for M1 (wardrobe hash 036275b87e12, front view)
  // If this fails, we fall back to model card
  dressedBase: null, // will try to discover
  // Model card fallback
  modelCard: null,
};

// ── Helper: download image to buffer ──
async function downloadImage(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed ${resp.status}: ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

// ── Helper: call Gemini API ──
async function callGemini(modelName, parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${API_KEY}`;

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
      console.log(`     ⏳ Rate limited, waiting ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Gemini ${resp.status}: ${errText.substring(0, 200)}`);
    }

    const result = await resp.json();
    const candidate = result.candidates?.[0];
    if (!candidate?.content?.parts) {
      if (attempt < 2) {
        console.log('     ⏳ Empty response (safety filter?), retrying in 15s...');
        await new Promise(r => setTimeout(r, 15000));
        continue;
      }
      throw new Error('No image after retries (likely safety filter)');
    }
    for (const part of candidate.content.parts) {
      if (part.inlineData) return Buffer.from(part.inlineData.data, 'base64');
    }
    throw new Error('No image data in response');
  }
  throw new Error('Failed after retries');
}

// ══════════════════════════════════════════════════
console.log('\n🔧 Flash vs Pro — Phase 2 Comparison Test');
console.log('═══════════════════════════════════════════\n');

// ── Step 1: Get assets ──
// Option A: Images already saved locally (from a previous run or manual download)
// Option B: Download from GCS
let phase1Buffer, identityBuffer, identityType;

const localPhase1 = path.join(__dirname, 'test_inputs', 'phase1_anchor.png');
const localDressed = path.join(__dirname, 'test_inputs', 'dressed_base.jpg');
const localModelCard = path.join(__dirname, 'test_inputs', 'model_card.png');

if (fs.existsSync(localPhase1)) {
  console.log('1. Loading assets from test_inputs/...');
  phase1Buffer = fs.readFileSync(localPhase1);
  console.log(`   ✅ Phase 1 anchor: ${(phase1Buffer.length / 1024).toFixed(0)}KB`);

  if (fs.existsSync(localDressed)) {
    identityBuffer = fs.readFileSync(localDressed);
    identityType = 'dressed';
    console.log(`   ✅ Dressed base: ${(identityBuffer.length / 1024).toFixed(0)}KB`);
  } else if (fs.existsSync(localModelCard)) {
    identityBuffer = fs.readFileSync(localModelCard);
    identityType = 'card';
    console.log(`   ✅ Model card: ${(identityBuffer.length / 1024).toFixed(0)}KB`);
  }
} else {
  console.log('1. Downloading assets from GCS...');
  try {
    phase1Buffer = await downloadImage(ASSETS.phase1Anchor);
    console.log(`   ✅ Phase 1 anchor: ${(phase1Buffer.length / 1024).toFixed(0)}KB`);
  } catch (e) {
    console.error(`   ❌ Can't download Phase 1 anchor: ${e.message}`);
    console.log('\n   → Save assets manually to test_inputs/ folder:');
    console.log('     mkdir -p test_inputs');
    console.log('     gsutil cp gs://gstar-ai-studio-assets/output/D27736-E358-J174/phase1-anchor-Ea0dYSLLtikQN0lJYcGC.png test_inputs/phase1_anchor.png');
    console.log('     # Also save dressed base or model card as test_inputs/dressed_base.jpg or test_inputs/model_card.png');
    process.exit(1);
  }
}

if (!identityBuffer) {
  console.log('   ⚠️ No dressed base or model card found. Running without identity reference.');
  console.log('   (To include: save as test_inputs/dressed_base.jpg or test_inputs/model_card.png)');
}

// ── Step 2: Build Phase 2 prompt + refs ──
function buildParts() {
  const parts = [];

  // 1. Garment template
  parts.push({
    inlineData: { mimeType: 'image/png', data: phase1Buffer.toString('base64') },
  });
  parts.push({
    text: `GARMENT TEMPLATE — This is the GROUND TRUTH for the garment. Copy it pixel-perfectly: wash, color, pockets, silhouette, stitching, labels, fading pattern. Do NOT deviate from this garment in ANY way. The garment template is sacred.\n\n`,
  });

  // 2. Identity reference
  if (identityBuffer && identityType === 'dressed') {
    parts.push({
      inlineData: { mimeType: 'image/jpeg', data: identityBuffer.toString('base64') },
    });
    parts.push({
      text: `MODEL DRESSED REFERENCE — this is the model for this shot. Match EXACTLY: face, hair, skin tone, body type, shoes, and all visible outfit items not covered by the focus garment.

CRITICAL — COMPLETELY IGNORE ALL LEGWEAR on this dressed reference. The model wears short black compression shorts for modesty only — these are NOT a garment reference. The ENTIRE lower body from waist to shoes will be dressed by the FOCUS GARMENT from the garment template. Only match: face, hair, skin tone, body type, shoes, and any UPPER BODY clothing.

CRITICAL — MATCH UPPER BODY CLOTHING EXACTLY: If this reference shows a white t-shirt, the output MUST show the SAME white t-shirt — same color, same neckline, same fit. DO NOT replace it with a tank top, crop top, or any other garment.\n\n`,
    });
  } else if (identityBuffer && identityType === 'card') {
    parts.push({
      inlineData: { mimeType: 'image/png', data: identityBuffer.toString('base64') },
    });
    parts.push({
      text: `MODEL CARD — Use this model's face, skin tone, hair style, body proportions. The model is just the carrier — garment accuracy from the template is what matters.\n\n`,
    });
  }

  // 3. Main prompt
  parts.push({
    text: `PHASE 2: COMBINE garment template with model identity.

You are given reference images:
1. GARMENT TEMPLATE — the EXACT garment to reproduce. Copy it pixel-perfectly. This is sacred.
${identityBuffer ? '2. MODEL CARD/DRESSED BASE — the model whose identity to use.' : ''}

TASK: Generate a final e-commerce photograph for G-Star RAW.

RULES:
- GARMENT: Copy the jeans/pants EXACTLY from the garment template. Same wash, same color, same pockets, same silhouette, same fading. Do not reinterpret.
- MODEL: ${identityBuffer ? 'Use the model card for face, skin tone, hair, body proportions only.' : 'Use a generic female model.'}
- POSE: FULL BODY front-facing DYNAMIC pose. Natural lifestyle energy — one hip relaxed, slight weight shift, body language candid and editorial. NOT rigid. Model faces camera.
- BACKGROUND: Pure white (#FFFFFF) studio, soft even lighting.
- ASPECT: 9:16 portrait format.
- PHOTOGRAPHIC REALISM: This must look like a real studio photograph, not a rendering or illustration.

CRITICAL — DENIM INTEGRITY:
- The garment template is the SOLE source of truth for the denim.
- Do NOT add ANY tears, rips, fraying, distressing, or worn patches that are NOT in the garment template.
- If the garment template shows CLEAN, SMOOTH denim — the output MUST be clean and smooth.
- Adding hallucinated tears, pocket fraying, knee rips, or distressed patches is a CRITICAL FAILURE.
- Every pocket, seam, and fabric texture must match the template EXACTLY.

The most critical thing: the GARMENT must be IDENTICAL to the garment template. If there's any conflict between model appearance and garment accuracy, garment accuracy wins.`,
  });

  return parts;
}

// ── Step 3: Run both models ──
const outDir = path.join(__dirname, 'test_outputs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const models = [
  { name: 'flash', model: 'gemini-3.1-flash-image-preview' },
  { name: 'pro', model: 'gemini-3-pro-image-preview' },
];

for (const { name, model } of models) {
  console.log(`\n2. Phase 2 → ${name.toUpperCase()} (${model})`);
  const start = Date.now();
  try {
    const parts = buildParts();
    const imageData = await callGemini(model, parts);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const outFile = `M05_${name}_${Date.now()}.png`;
    const outPath = path.join(outDir, outFile);
    fs.writeFileSync(outPath, imageData);
    console.log(`   ✅ Done in ${elapsed}s → test_outputs/${outFile} (${(imageData.length / 1024).toFixed(0)}KB)`);
  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`   ❌ Failed after ${elapsed}s: ${e.message}`);
  }
}

console.log('\n═══════════════════════════════════════════');
console.log('✅ Done! Compare test_outputs/M05_flash_*.png vs M05_pro_*.png');
console.log('═══════════════════════════════════════════\n');
process.exit(0);
