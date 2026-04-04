/**
 * Integration test: Simulate the FULL reference assembly pipeline for M02 (cropped back)
 * using real CONTOR 3D EXTREME LOOSE fit model images + flat front + flat back.
 *
 * Outputs:
 * 1. All Phase 1 references (numbered, in order)
 * 2. All Phase 2 references (numbered, in order)
 * 3. Summary: image count, total size, per-ref sizes
 * 4. Panoramic strips saved as individual files for visual review
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { generatePanoramicStrips, resizeForFeed } from './src/lib/zone-grids';
import { extractFlatColor, extractFlatSilhouette } from './src/lib/flat-reference';

const OUT_DIR = '/sessions/focused-nifty-faraday/mnt/gstar/pipeline_test_m02';
const CONTOR_DIR = '/sessions/focused-nifty-faraday/mnt/gstar/new ai shoot 01042026/D27690-D315-001 CONTOR 3D EXTREME LOOSE WMN';

interface Ref {
  buffer: Buffer;
  mimeType: string;
  label: string;
  name: string; // short filename for saving
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  PIPELINE TEST: M02 (Cropped Back) — CONTOR 3D EXTREME     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── Load fit model images (8 angles, front→rotating right) ──
  const fitFiles = [
    'G-Star AI test jeans 4.png', 'G-Star AI test jeans 5.png',
    'G-Star AI test jeans 6.png', 'G-Star AI test jeans 7.png',
    'G-Star AI test jeans 8.png', 'G-Star AI test jeans 9.png',
    'G-Star AI test jeans 10.png', 'G-Star AI test jeans 11.png',
  ];

  const fitModelBuffers: Array<{ buffer: Buffer; index: number }> = [];
  for (let i = 0; i < fitFiles.length; i++) {
    fitModelBuffers.push({
      buffer: readFileSync(`${CONTOR_DIR}/${fitFiles[i]}`),
      index: i,
    });
  }
  console.log(`✓ Loaded ${fitModelBuffers.length} fit model images`);

  // ── Load flat images ──
  const rawFlatFrontBuffer = readFileSync(`${CONTOR_DIR}/G-Star AI test jeans flat front.png`);
  const rawFlatBackBuffer = readFileSync(`${CONTOR_DIR}/G-Star AI test jeans flat back.png`);
  console.log('✓ Loaded flat front + flat back');

  // ── Extract flat color (ground truth) ──
  let flatColorHex = '';
  try {
    const flatColor = await extractFlatColor(rawFlatFrontBuffer);
    flatColorHex = flatColor.hex;
    console.log(`✓ Flat color extracted: ${flatColor.hex} (LAB L=${flatColor.lab.l.toFixed(0)} a=${flatColor.lab.a.toFixed(1)} b=${flatColor.lab.b.toFixed(1)})`);
  } catch (e) {
    console.warn('⚠ Flat color extraction failed');
  }

  // ══════════════════════════════════════════════
  // PHASE 1 REFERENCES (what Pro model receives)
  // ══════════════════════════════════════════════
  console.log('\n━━━ PHASE 1 REFERENCES (Gemini Pro 4K) ━━━');
  const phase1Refs: Ref[] = [];

  // 1. Flat front image (1400px)
  const resizedFlat = await resizeForFeed(rawFlatFrontBuffer, 1400);
  phase1Refs.push({
    buffer: resizedFlat,
    mimeType: 'image/jpeg',
    label: 'GARMENT FLAT IMAGE — #1 reference for width and proportions',
    name: 'p1_01_flat_front',
  });

  // 2. Fit model images (1200px each)
  for (let i = 0; i < fitModelBuffers.length; i++) {
    const resized = await resizeForFeed(fitModelBuffers[i].buffer, 1200);
    const angleDesc = i === 0 ? 'front' : `angle ${i + 1}/8, rotating right`;
    const colorAnchor = i === 0 ? ` COLOR ANCHOR. EXTRACTED GARMENT COLOR: ${flatColorHex}.` : '';
    phase1Refs.push({
      buffer: resized,
      mimeType: 'image/jpeg',
      label: `FIT MODEL REFERENCE (${i + 1}/8, ${angleDesc}).${colorAnchor}`,
      name: `p1_${String(i + 2).padStart(2, '0')}_fitmodel_${i}`,
    });
  }

  // 3. Panoramic zone strips
  const strips = await generatePanoramicStrips(
    fitModelBuffers, rawFlatFrontBuffer, rawFlatBackBuffer, 'M02', 'pants'
  );
  for (const strip of strips) {
    phase1Refs.push({
      buffer: strip.buffer,
      mimeType: 'image/jpeg',
      label: `360° ZONE STRIP: ${strip.label}`,
      name: `p1_${String(phase1Refs.length + 1).padStart(2, '0')}_strip_${strip.zoneName}`,
    });
  }

  // Save Phase 1 refs
  let totalP1 = 0;
  for (let i = 0; i < phase1Refs.length; i++) {
    const ref = phase1Refs[i];
    const meta = await sharp(ref.buffer).metadata();
    const sizeKB = (ref.buffer.length / 1024).toFixed(0);
    totalP1 += ref.buffer.length;
    writeFileSync(`${OUT_DIR}/${ref.name}.jpg`, ref.buffer);
    console.log(`  ${i + 1}. ${ref.name} — ${meta.width}x${meta.height} (${sizeKB}KB) — ${ref.label.substring(0, 80)}...`);
  }
  console.log(`  ─── PHASE 1 TOTAL: ${phase1Refs.length} refs, ${(totalP1 / 1024 / 1024).toFixed(1)}MB ───`);

  // ══════════════════════════════════════════════
  // PHASE 2 REFERENCES (what Flash model receives)
  // ══════════════════════════════════════════════
  console.log('\n━━━ PHASE 2 REFERENCES (Gemini Flash 2K) ━━━');
  const phase2Refs: Ref[] = [];

  // 1. Garment template (simulated — would be Phase 1 output, cropped to waist-down)
  // We'll use the flat front as a stand-in since we can't run Phase 1 generation
  const templateStandin = await resizeForFeed(rawFlatFrontBuffer, 1400);
  phase2Refs.push({
    buffer: templateStandin,
    mimeType: 'image/jpeg',
    label: 'GARMENT TEMPLATE (CROPPED) — [stand-in: would be Phase 1 output cropped 35% from top]',
    name: 'p2_01_garment_template',
  });

  // 2. M03 color anchor (simulated — would be M03's Phase 1 output)
  phase2Refs.push({
    buffer: templateStandin,
    mimeType: 'image/jpeg',
    label: 'GARMENT COLOR ANCHOR (from front view) — The back view garment MUST match this color precisely.',
    name: 'p2_02_color_anchor',
  });

  // 3. Dressed base (cropped) — would come from model DB
  // Skip — requires Firestore. Just note the slot.
  console.log('  [3. DRESSED BASE (CROPPED) — would be injected from model DB, skipped in test]');

  // 4. Panoramic strips — THE NEW ADDITION
  for (const strip of strips) {
    phase2Refs.push({
      buffer: strip.buffer,
      mimeType: 'image/jpeg',
      label: `PHASE 2 360° ZONE STRIP: ${strip.label}`,
      name: `p2_${String(phase2Refs.length + 1).padStart(2, '0')}_strip_${strip.zoneName}`,
    });
  }

  // NOTE: In the new code, flat back is NOT injected separately — it's already in the panoramic strips.
  // This is a key difference from the old code.

  // Save Phase 2 refs
  let totalP2 = 0;
  for (let i = 0; i < phase2Refs.length; i++) {
    const ref = phase2Refs[i];
    const meta = await sharp(ref.buffer).metadata();
    const sizeKB = (ref.buffer.length / 1024).toFixed(0);
    totalP2 += ref.buffer.length;
    writeFileSync(`${OUT_DIR}/${ref.name}.jpg`, ref.buffer);
    console.log(`  ${i + 1}. ${ref.name} — ${meta.width}x${meta.height} (${sizeKB}KB) — ${ref.label.substring(0, 80)}...`);
  }
  console.log(`  ─── PHASE 2 TOTAL: ${phase2Refs.length} refs, ${(totalP2 / 1024 / 1024).toFixed(1)}MB ───`);

  // ══════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════
  const grandTotal = totalP1 + totalP2;
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  SUMMARY                                                     ║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Phase 1: ${phase1Refs.length} references, ${(totalP1 / 1024 / 1024).toFixed(1)}MB`);
  console.log(`║  Phase 2: ${phase2Refs.length} references, ${(totalP2 / 1024 / 1024).toFixed(1)}MB (+ dressed base ~200KB)`);
  console.log(`║  Grand total: ${(grandTotal / 1024 / 1024).toFixed(1)}MB`);
  console.log(`║  Gemini budget: ~20MB inline → ${((grandTotal / (20 * 1024 * 1024)) * 100).toFixed(0)}% used`);
  console.log('║');
  console.log('║  OLD pipeline for M02 back shots:');
  console.log('║    Phase 2 zones: hip grid (FRONT angles 0,1,2,4) + knee grid (FRONT angles)');
  console.log('║    Back zone: SILENTLY DROPPED (filter bug)');
  console.log('║    Flat back: last ref, deprioritized');
  console.log('║    Side views (left/right): MISSING');
  console.log('║');
  console.log('║  NEW pipeline for M02 back shots:');
  console.log('║    Phase 2 zones: 3 panoramic strips (waist+knee+ankle)');
  console.log('║    Each strip: ALL 8 fit model angles + flat front + flat back');
  console.log('║    Back angles: CENTER of strip (highest attention)');
  console.log('║    Side views (90°+270°): INCLUDED in every strip');
  console.log('║    Flat back: FIRST panel in every strip (highest priority)');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  console.log(`\n✓ All refs saved to ${OUT_DIR}/`);
  console.log('  Review Phase 2 strips (p2_*_strip_*.jpg) — these are what Gemini sees for M02.');
}

main().catch(console.error);
