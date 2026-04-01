#!/usr/bin/env node
/**
 * Local M01/M02 test script — calls Gemini Developer API directly.
 * No deploy needed. Iterate on prompts in minutes.
 *
 * Usage:
 *   node scripts/test-m01-local.mjs
 *
 * Outputs saved to: /tmp/gstar-test/
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Use locally-installed sharp for arm64
const sharp = require('/tmp/sharp-local/node_modules/sharp');

// ── Config ──
const API_KEY = fs.readFileSync(path.join(import.meta.dirname, '.gemini-key'), 'utf8').trim();
const MODEL = 'gemini-3.1-flash-image-preview'; // Same model as production
const OUTPUT_DIR = '/tmp/gstar-test';

// GCS URLs for the current test job's reference images
const REFS = {
  // M03 anchor (Phase 1 garment template) — front view
  garmentTemplate: 'https://storage.googleapis.com/gstar-ai-studio-assets/output/3301%20Slim%20Jeans%20[D25742-8968-89]/phase1-anchor-FHizVZYLvMwkeUqrarZU.png',
  // Wardrobe shoe reference
  shoe: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/White%20sneaker%202.png',
};

// ── Helpers ──
async function downloadImage(url) {
  console.log(`  Downloading: ${url.split('/').pop()}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download ${url}: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function callGemini(prompt, referenceImages, aspectRatio = '3:4') {
  const parts = [];

  // Add reference images with labels
  for (const ref of referenceImages) {
    parts.push({
      inlineData: {
        mimeType: ref.mimeType || 'image/png',
        data: ref.buffer.toString('base64'),
      },
    });
    parts.push({ text: ref.label + '\n\n' });
  }

  // Add the main prompt
  parts.push({ text: prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  console.log(`  Calling Gemini ${MODEL} (${referenceImages.length} refs, ${aspectRatio})...`);
  const startTime = Date.now();

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(300_000), // 5 min timeout
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio },
      },
    }),
  });

  const elapsed = Math.round((Date.now() - startTime) / 1000);

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini ${response.status} (${elapsed}s): ${err.substring(0, 500)}`);
  }

  const result = await response.json();
  const candidate = result.candidates?.[0];
  if (!candidate?.content?.parts) {
    throw new Error(`Empty response (safety filter?) after ${elapsed}s`);
  }

  for (const part of candidate.content.parts) {
    if (part.inlineData) {
      console.log(`  ✓ Image generated in ${elapsed}s`);
      return Buffer.from(part.inlineData.data, 'base64');
    }
  }

  throw new Error('No image data in response');
}

// ── Main ──
async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('\n=== G-Star M01 Local Test ===\n');

  // 1. Download garment template
  console.log('1. Downloading reference images...');
  let garmentTemplate;
  try {
    garmentTemplate = await downloadImage(REFS.garmentTemplate);
  } catch (e) {
    console.log('   M03 anchor not available, trying M03 output image...');
    // Fallback: use M03 output image
    garmentTemplate = await downloadImage(
      'https://storage.googleapis.com/gstar-ai-studio-assets/output/3301%20Slim%20Jeans%20[D25742-8968-89]/F15_M03_v1.png'
    );
  }

  let shoeRef;
  try {
    shoeRef = await downloadImage(REFS.shoe);
  } catch (e) {
    console.log('   Shoe ref not available, skipping');
    shoeRef = null;
  }

  // 2. Pre-crop garment template to waist-to-shoes
  console.log('\n2. Pre-cropping garment template (35% from top)...');
  const meta = await sharp(garmentTemplate).metadata();
  const tH = meta.height || 2400;
  const tW = meta.width || 1800;
  const cropFromTop = Math.round(tH * 0.35);
  const croppedTemplate = await sharp(garmentTemplate)
    .extract({ left: 0, top: cropFromTop, width: tW, height: tH - cropFromTop })
    .jpeg({ quality: 95 })
    .toBuffer();
  console.log(`   Original: ${tW}x${tH} → Cropped: ${tW}x${tH - cropFromTop} (top ${cropFromTop}px removed)`);

  // Save cropped template for inspection
  fs.writeFileSync(path.join(OUTPUT_DIR, 'cropped-template.jpg'), croppedTemplate);

  // 3. Build Phase 2 references
  console.log('\n3. Building Phase 2 references...');
  const phase2Refs = [
    {
      buffer: croppedTemplate,
      mimeType: 'image/jpeg',
      label: `GARMENT TEMPLATE (CROPPED) — This shows the garment from WAISTBAND to SHOES. The image is ALREADY cropped to the correct framing. Copy this garment pixel-perfectly: wash, color, pockets, silhouette, stitching, fading pattern. Your output MUST have the SAME composition — waistband at top, shoes at bottom, NO head visible.`,
    },
  ];

  if (shoeRef) {
    phase2Refs.push({
      buffer: shoeRef,
      mimeType: 'image/png',
      label: `WARDROBE — SHOES: "White sneaker 2". Match this item exactly (color, style, material).`,
    });
  }

  // 4. Build the shared background/rules block
  const BG_RULES = `- BACKGROUND — THIS IS CRITICAL:
  The background must be a PERFECTLY UNIFORM, SOLID, FLAT color.
  The color is a light warm grey: RGB(213, 211, 204) / hex #D5D3CC.
  Think of a freshly painted, smooth, matte studio wall and floor — ZERO texture.
  NO patterns. NO gradients. NO vignetting. NO concrete texture. NO plaster texture. NO brush strokes. NO distressed look. NO industrial aesthetic. NO grunge. NO splatter. NO noise.
  The background should look like a single flat color fill — as if you opened Photoshop and filled the entire background layer with #D5D3CC.
  ONE very soft, barely visible floor shadow directly under the model's feet. Nothing else.
  If there is ANY visible texture, pattern, or variation in the background, the image is WRONG.

- SKIN TONE: Neutral studio lighting (5500K daylight balanced). NOT golden hour. NOT warm/orange.
- LIGHTING: Professional studio with daylight-balanced strobes. Clean, neutral whites.
- ASPECT: 3:4 portrait format.
- PHOTOGRAPHIC REALISM: This must look like a real studio photograph.

CRITICAL — SHOES: The model MUST wear "White sneaker 2" — white low-top sneakers. Match the shoe reference. Do NOT substitute with boots, Chelsea boots, leather shoes, or any other footwear. IGNORE any footwear visible in the garment template — use ONLY the wardrobe shoe specification.

The most critical thing: the GARMENT must be IDENTICAL to the garment template, and the BACKGROUND must be perfectly flat and uniform.`;

  // ── M01: Cropped Front ──
  const m01Prompt = `PHASE 2: Generate a CROPPED e-commerce photograph for G-Star RAW.

You are given reference images:
1. GARMENT TEMPLATE (CROPPED) — the EXACT garment to reproduce, already cropped to waist-to-shoes framing.

TASK: Generate a cropped product photograph showing ONLY the lower body (waist to shoes) of a male model wearing this EXACT garment.

RULES:
- GARMENT: Copy the jeans/pants EXACTLY from the garment template. Same wash, same color, same pockets, same silhouette, same fading. Do not reinterpret.
- MODEL: Generic anonymous male model (cropped shot — no face visible).
- POSE: CROPPED FRONT VIEW — MATCH THE GARMENT TEMPLATE COMPOSITION EXACTLY. The garment template is already cropped to show waistband-to-shoes. Your output MUST have the SAME framing: waistband with belt loops clearly visible at TOP of frame, shoes at BOTTOM, NO head, NO chest, NO face. Front-facing. Relaxed stance, thumbs hooked in pockets or at sides — masculine and confident.

${BG_RULES}`;

  // ── M02: Cropped Back ──
  const m02Prompt = `PHASE 2: Generate a CROPPED e-commerce photograph for G-Star RAW.

You are given reference images:
1. GARMENT TEMPLATE (CROPPED) — the EXACT garment to reproduce, already cropped to waist-to-shoes framing.

TASK: Generate a cropped product photograph showing ONLY the lower body (waist to shoes) of a male model wearing this EXACT garment, VIEWED FROM THE BACK.

RULES:
- GARMENT: Copy the jeans/pants EXACTLY from the garment template. Same wash, same color, same pockets, same silhouette, same fading. Do not reinterpret.
- MODEL: Generic anonymous male model (cropped shot — no face visible). Model faces AWAY from camera.
- POSE: CROPPED BACK VIEW — MATCH THE GARMENT TEMPLATE COMPOSITION EXACTLY. The garment template is already cropped to show waistband-to-shoes. Your output MUST have the SAME framing: waistband with belt loops clearly visible at TOP of frame, shoes at BOTTOM, NO head, NO chest, NO face. Model faces AWAY from camera — showing the BACK of the jeans. Relaxed stance, masculine and confident.

${BG_RULES}`;

  // 5. Generate both!
  for (const [shotName, prompt] of [['m01-front', m01Prompt], ['m02-back', m02Prompt]]) {
    console.log(`\n4. Generating ${shotName}...`);
    try {
      const result = await callGemini(prompt, phase2Refs, '3:4');
      const outPath = path.join(OUTPUT_DIR, `${shotName}-${Date.now()}.png`);
      fs.writeFileSync(outPath, result);
      console.log(`✓ SAVED: ${outPath}`);

      const outMeta = await sharp(result).metadata();
      console.log(`  Dimensions: ${outMeta.width}x${outMeta.height}`);
    } catch (err) {
      console.error(`✗ ${shotName} failed:`, err.message);
    }
  }

  console.log('\n=== Done ===\n');
}

main().catch(console.error);
