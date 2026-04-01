#!/usr/bin/env node
/**
 * Bulk upload garments from "AI shoot 24-3-26" folder to the platform.
 * Step 1: Upload images to GCS via gsutil (bypasses Cloud Run body limit)
 * Step 2: Create wardrobe items via API with GCS URLs
 *
 * Usage:
 *   node bulk_upload_garments.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');
const API_BASE = 'https://gstar-ai-studio-674145888056.europe-west1.run.app';
const SHOOT_DIR = path.join(__dirname, '..', 'AI shoot 24-3-26');
const GCS_BUCKET = 'gstar-ai-studio-assets';

// ── Product descriptions from Excel ──
const PRODUCTS = {
  // MEN
  'D25742-8968-89': {
    name: '3301 Slim Jeans',
    gender: 'male',
    description: 'Slim Fit. Mid waist. Narrow from thigh to hem. Regular length. Featuring a timeless construction and a slim fit, the 3301 jeans are a true classic wardrobe staple. Made to last. Perfect for every day. Button fly, 5 pockets. 92% Cotton (Regenerative), 7% Elastomultiester (T400 EcoMade), 1% LYCRA Elastane. Superstretch, 11 oz denim, 3x1 right hand twill. Color: dark aged.',
  },
  'D26141-D775-H139': {
    name: 'Morry FWD Regular Tapered Jeans',
    gender: 'male',
    description: 'Tapered Fit. Mid waist. Straight around the hip, tapered from the knee down. Regular length. The Morry features a mid-waist fit with a tapered leg. Angled belt loops at the sides and inset pocket. Coin pocket with a small flap on the opposite side. Button fly, inset pockets, back pockets, angled belt loops. Cow leather G-STAR label at the back. 99% Regenerative cotton, 1% Elastane. Comfortable stretch, 12.75 oz denim, 3x1 right hand twill. Color: worn in glace.',
  },
  'D23699-E266-H794': {
    name: 'G-STAR Elwood Regular Jeans',
    gender: 'male',
    description: 'Straight Fit. Mid waist. Regular fit from waist to hem. Long length. First introduced in 1996, the pioneering design of the G-STAR Elwood has been reinvented in a regular straight fit. Anatomic Denim collection with diagonal seams across the thighs, knee pads, and reinforced heel guards. Button closure, inset pockets, back pockets. 100% Cotton (Regenerative). Rigid, 12 oz denim, 3x1 right hand twill. Color: vintage mayin.',
  },
  'D23692-D316-D926': {
    name: 'Mosa Straight Neo Raw Jeans',
    gender: 'male',
    description: 'Straight Fit. Mid waist. Straight leg. Regular length. The Mosa sits mid-waist with a timeless construction and narrow leg. Coin pocket moved inside with only rivets visible. Zip closure, 5 pockets. 74% Cotton (Regenerative), 25% Cotton (Recycled), 1% Elastane. Comfort stretch, 12 oz denim, 3x1 right hand twill. NEO RAW treatment preserves crisp raw denim look and slows fading. Color: Neo Raw Denim.',
  },
  'D23691-D930-G804': {
    name: 'Dakota Regular Straight Jeans',
    gender: 'male',
    description: 'Straight Fit. Mid waist. Straight from top to bottom. Regular length. The Dakota is a straight-leg classic sitting at mid-waist with more room at top for comfortable fit and relaxed look. Button fly, rivet reinforced inset pockets, coin pocket inside waistband. Back pockets. 94% Cotton, 5% Elastomultiester, 1% LYCRA Elastane. Comfortable stretch, 12.3 oz denim, 3x1 right hand twill.',
  },
  // WOMEN
  'D26163-E205-H918': {
    name: 'G-Straight Jeans',
    gender: 'female',
    description: 'Straight fit. Mid waist. Full length. Straight leg. The G-Straight offers a mid waist jean with a regular straight leg. Classic 5-pocket design with zip fly. Button and zip closure. 79% Regenerative Cotton, 20% Recycled Cotton, 1% Elastane. Comfort stretch fabric, durable and soft hand feel. Color: sun faded blue galena.',
  },
  'D25372-E267-H544': {
    name: 'Bowey Barrel Jeans',
    gender: 'female',
    description: 'Boyfriend Fit. Low waist. Relaxed fit at hips and thighs. Long length. The Bowey 3D jean is part of the Anatomic Denim offer. Low-rise fit with a loose leg. Strategically placed darts around the knee create a bow-leg shape, adding extra volume. Button fly, 3D construction, 5 pockets. 100% Cotton (Regenerative). Rigid, 12 oz, 3x1 right hand twill. Color: faded blue chrome.',
  },
  'D15264-D931-H095': {
    name: 'Kate Boyfriend Jeans',
    gender: 'female',
    description: 'Boyfriend Fit. Low waist. Relaxed fit at hips and thighs. Long length. The Kate has a boyfriend fit with a low waist and dropped crotch. Relaxed leg and folded-up hem for a perfect casual look. Front zip closure, five pockets, back logo label. 98% Cotton (Regenerative), 2% Elastane (Lycra). Comfortable stretch, 11.3 oz denim, 3x1 right hand twill. Color: sun faded gunmetal.',
  },
  'D21290-A634-G730': {
    name: '3301 Flare Jeans',
    gender: 'female',
    description: 'Bootcut Fit. Mid waist. Tight through the thigh, flared leg towards hem. Regular length. Inspired by the 70s, reimagined for today. The 3301 Flare sits mid waist, fitted at thigh and flared from knee towards hem. Zip fly, 5 pockets. 91% Cotton (Regenerative), 8% Elastomultiester (T400 EcoMade), 1% Elastane (Lycra). Superstretch, 10.2 oz denim, 3x1 right hand twill. Color: worn in black vortex.',
  },
  'D22889-E353-H487': {
    name: 'Judee Low Waist Loose Jeans',
    gender: 'female',
    description: 'Loose Fit. Low waist. Straight leg, fitting loosely. Longer length. The Judee features a loose fit with a low waist, perfect for daily wear. Updated with less width around hips and shorter leg for more defined fit. Zip fly, rivet reinforced inset pockets, coin pocket moved inside. 100% Cotton (Regenerative). Rigid, 13 oz denim, 3x1 right hand twill. Color: worn in indigo veil.',
  },
};

// ── Helper: upload file to GCS via gsutil, return public URL ──
function uploadToGCS(localPath, gcsPath) {
  const fullGcsPath = `gs://${GCS_BUCKET}/${gcsPath}`;
  execSync(`gsutil -q cp "${localPath}" "${fullGcsPath}"`, { stdio: 'pipe' });
  return `https://storage.googleapis.com/${GCS_BUCKET}/${gcsPath}`;
}

// ── Main ──
async function main() {
  console.log(`\n📦 Bulk Upload — AI Shoot 24-3-26`);
  console.log(`   API: ${API_BASE}`);
  console.log(`   GCS: gs://${GCS_BUCKET}`);
  console.log(`   Source: ${SHOOT_DIR}`);
  console.log(`   Products: ${Object.keys(PRODUCTS).length}`);
  if (DRY_RUN) console.log(`   🔶 DRY RUN — no uploads`);
  console.log('');

  const results = [];

  for (const [sfc, info] of Object.entries(PRODUCTS)) {
    console.log(`\n── ${sfc} — ${info.name} (${info.gender}) ──`);

    const genderDir = info.gender === 'male' ? 'MEN' : 'WOMEN';
    const productDir = path.join(SHOOT_DIR, genderDir, sfc);

    if (!fs.existsSync(productDir)) {
      console.log(`   ❌ Folder not found`);
      results.push({ sfc, name: info.name, status: 'FOLDER_NOT_FOUND' });
      continue;
    }

    // Find flat image
    const flatFile = fs.readdirSync(productDir).find(f => f.match(/-M04\.(jpg|JPG)$/i));

    // Find mannequin photos
    const mannequinDir = path.join(productDir, 'Mannequin');
    const mannequinFiles = fs.existsSync(mannequinDir)
      ? fs.readdirSync(mannequinDir).filter(f => /\.(jpg|JPG)$/i.test(f)).sort()
      : [];

    console.log(`   📸 Flat: ${flatFile || 'none'}`);
    console.log(`   📸 Mannequin: ${mannequinFiles.length} photos`);

    if (mannequinFiles.length === 0) {
      console.log(`   ❌ No mannequin photos — skipping`);
      results.push({ sfc, name: info.name, status: 'NO_MANNEQUIN' });
      continue;
    }

    if (DRY_RUN) {
      results.push({ sfc, name: info.name, status: 'DRY_RUN' });
      continue;
    }

    // Step 1: Upload images to GCS via gsutil (full resolution)
    console.log(`   📤 Uploading ${mannequinFiles.length} mannequin photos to GCS...`);
    const imageUrls = [];
    for (let i = 0; i < mannequinFiles.length; i++) {
      const localFile = path.join(mannequinDir, mannequinFiles[i]);
      const gcsPath = `input/${sfc}/360/360_${String(i).padStart(2, '0')}.jpg`;
      const url = uploadToGCS(localFile, gcsPath);
      imageUrls.push(url);
      process.stdout.write('.');
    }
    console.log(' done');

    let flatImageUrl;
    if (flatFile) {
      console.log(`   📤 Uploading flat image to GCS...`);
      const localFlat = path.join(productDir, flatFile);
      flatImageUrl = uploadToGCS(localFlat, `input/${sfc}/flat/flat.jpg`);
      console.log('   done');
    }

    // Step 2: Create wardrobe item via API (just URLs, no base64)
    const payload = {
      name: `${info.name} [${sfc}]`,
      category: 'pants',
      gender: info.gender,
      description: info.description,
      isPrimary: true,
      openShoes: false,
      imageUrls,
      ...(flatImageUrl ? { flatImageUrl } : {}),
    };

    console.log(`   📝 Creating wardrobe item via API...`);
    const start = Date.now();
    try {
      const resp = await fetch(`${API_BASE}/api/wardrobe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText.substring(0, 200)}`);
      }

      const result = await resp.json();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`   ✅ Wardrobe item: ${result.wardrobeId} (${elapsed}s)`);
      results.push({ sfc, name: info.name, status: 'OK', wardrobeId: result.wardrobeId });
    } catch (e) {
      console.error(`   ❌ API failed: ${e.message}`);
      results.push({ sfc, name: info.name, status: 'API_FAILED', error: e.message });
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  // Summary
  console.log('\n\n═══════════════════════════════════════════');
  console.log('📊 UPLOAD SUMMARY');
  console.log('═══════════════════════════════════════════');
  const ok = results.filter(r => r.status === 'OK').length;
  const failed = results.filter(r => !['OK', 'DRY_RUN'].includes(r.status)).length;
  console.log(`   ✅ Success: ${ok}   ❌ Failed: ${failed}   Total: ${results.length}\n`);

  for (const r of results) {
    const icon = r.status === 'OK' ? '✅' : r.status === 'DRY_RUN' ? '🔶' : '❌';
    console.log(`   ${icon} ${r.sfc} — ${r.name} — ${r.status}${r.wardrobeId ? ` → ${r.wardrobeId}` : ''}`);
  }
  console.log('');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
