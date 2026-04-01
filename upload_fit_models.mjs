#!/usr/bin/env node
/**
 * Upload fit model photos for women's products and PATCH wardrobe items.
 *
 * Step 1: Find wardrobe items by name (women's jeans)
 * Step 2: Upload fit model photos to GCS via gsutil
 * Step 3: PATCH wardrobe items with fitModelUrls
 *
 * Usage:
 *   node upload_fit_models.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = 'https://gstar-ai-studio-674145888056.europe-west1.run.app';
const SHOOT_DIR = path.join(__dirname, '..', 'AI shoot 24-3-26', 'WOMEN');
const GCS_BUCKET = 'gstar-ai-studio-assets';

// Women's products with SFC codes
const WOMEN_PRODUCTS = [
  { sfc: 'D26163-E205-H918', name: 'G-Straight Jeans' },
  { sfc: 'D25372-E267-H544', name: 'Bowey Barrel Jeans' },
  { sfc: 'D15264-D931-H095', name: 'Kate Boyfriend Jeans' },
  { sfc: 'D21290-A634-G730', name: '3301 Flare Jeans' },
  { sfc: 'D22889-E353-H487', name: 'Judee Low Waist Loose Jeans' },
];

async function main() {
  console.log('=== Fit Model Photo Upload ===\n');

  // Step 1: Get all wardrobe items to find matching IDs
  console.log('Fetching wardrobe items...');
  const res = await fetch(`${API_BASE}/api/wardrobe?category=pants`);
  const data = await res.json();
  const items = data.items || [];
  console.log(`Found ${items.length} pants items\n`);

  for (const product of WOMEN_PRODUCTS) {
    console.log(`\n── ${product.name} [${product.sfc}] ──`);

    // Find matching wardrobe item — try exact name match first, then partial (contains) match
    let item = items.find(i => i.name === product.name && (i.gender === 'female' || i.gender === 'unisex'));
    if (!item) {
      // Partial match: wardrobe name contains the product name (or vice versa), case-insensitive
      const searchName = product.name.toLowerCase();
      item = items.find(i =>
        (i.gender === 'female' || i.gender === 'unisex') &&
        (i.name?.toLowerCase().includes(searchName) || searchName.includes(i.name?.toLowerCase()))
      );
    }
    if (!item) {
      // List available women's items to help debug
      const womenItems = items.filter(i => i.gender === 'female' || i.gender === 'unisex');
      console.log(`  ⚠ No matching wardrobe item found — skipping`);
      console.log(`    Available women's items: ${womenItems.map(i => `"${i.name}"`).join(', ')}`);
      continue;
    }
    const wardrobeId = item.wardrobeId || item.id;
    console.log(`  Wardrobe ID: ${wardrobeId}`);

    // Check fit model directory
    const fitDir = path.join(SHOOT_DIR, product.sfc, 'Fit model');
    if (!fs.existsSync(fitDir)) {
      console.log(`  ⚠ No Fit model directory: ${fitDir}`);
      continue;
    }

    const files = fs.readdirSync(fitDir)
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
      .sort();
    console.log(`  Found ${files.length} fit model photos`);

    if (files.length === 0) continue;

    // Step 2: Upload to GCS
    const gcsPrefix = `wardrobe/pants/${wardrobeId}/fit`;
    const fitModelUrls = [];

    for (let i = 0; i < files.length; i++) {
      const localPath = path.join(fitDir, files[i]);
      const gcsPath = `gs://${GCS_BUCKET}/${gcsPrefix}/fit_${String(i).padStart(2, '0')}.jpg`;
      const publicUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${gcsPrefix}/fit_${String(i).padStart(2, '0')}.jpg`;

      try {
        execSync(`gsutil -q cp "${localPath}" "${gcsPath}"`, { stdio: 'pipe' });
        // Make public
        execSync(`gsutil -q acl ch -u AllUsers:R "${gcsPath}"`, { stdio: 'pipe' });
        fitModelUrls.push(publicUrl);
        process.stdout.write(`  ✓ ${files[i]} → GCS\n`);
      } catch (err) {
        console.error(`  ✗ Failed to upload ${files[i]}: ${err.message}`);
      }
    }

    if (fitModelUrls.length === 0) continue;

    // Step 3: PATCH wardrobe item with fitModelUrls
    console.log(`  Patching wardrobe item with ${fitModelUrls.length} fit model URLs...`);
    const patchRes = await fetch(`${API_BASE}/api/wardrobe/${wardrobeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fitModelUrls }),
    });

    if (patchRes.ok) {
      console.log(`  ✓ Done — ${fitModelUrls.length} fit model photos linked`);
    } else {
      const err = await patchRes.text();
      console.error(`  ✗ PATCH failed: ${err}`);
    }
  }

  console.log('\n=== Complete ===');
}

main().catch(console.error);
