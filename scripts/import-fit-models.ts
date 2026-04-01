/**
 * Import fit model images from local folder into GCS + Firestore.
 *
 * For each design number folder in the AI shoot directory:
 * 1. Finds the matching wardrobe item by name (design number)
 * 2. Resizes fit model images to 1400px width
 * 3. Uploads to GCS under wardrobe/{category}/{wardrobeId}/fitmodel-{n}.jpg
 * 4. Patches the wardrobe item with fitModelUrls
 *
 * Usage (from gstar-studio root):
 *   npx tsx scripts/import-fit-models.ts --folder "../AI shoot 24-3-26/MEN/fit model"
 *   npx tsx scripts/import-fit-models.ts --folder "../AI shoot 24-3-26/WOMEN" --subfolder "Fit model"
 *
 * Requires:
 *   - Application Default Credentials (gcloud auth application-default login)
 *   - Or GOOGLE_APPLICATION_CREDENTIALS env var
 */

import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const PROJECT_ID = 'gstar-ai-studio';
const BUCKET_NAME = 'gstar-ai-studio-assets';
const TARGET_WIDTH = 1400;

const db = new Firestore({ projectId: PROJECT_ID });
const storage = new Storage({ projectId: PROJECT_ID });
const wardrobeCol = db.collection('wardrobe');

// Parse CLI args
const args = process.argv.slice(2);
const folderIdx = args.indexOf('--folder');
const subfolderIdx = args.indexOf('--subfolder');
const dryRun = args.includes('--dry-run');

const folder = folderIdx >= 0 ? args[folderIdx + 1] : null;
const subfolderName = subfolderIdx >= 0 ? args[subfolderIdx + 1] : 'Fit model';

if (!folder) {
  console.error('Usage: npx tsx scripts/import-fit-models.ts --folder <path> [--subfolder <name>] [--dry-run]');
  console.error('  --folder     Path to the parent folder containing design number subfolders');
  console.error('  --subfolder  Name of subfolder within each design folder (default: "Fit model")');
  console.error('  --dry-run    Show what would happen without uploading');
  process.exit(1);
}

const basePath = path.resolve(folder);

async function findWardrobeItem(designNumber: string) {
  // Try exact match on name field
  let snap = await wardrobeCol.where('name', '==', designNumber).limit(1).get();
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };

  // Try partial match — design number might be part of the name
  // Firestore doesn't support LIKE, so fetch all and filter
  const allSnap = await wardrobeCol.get();
  for (const doc of allSnap.docs) {
    const data = doc.data();
    const name = (data.name || '').toUpperCase();
    const desc = (data.description || '').toUpperCase();
    const dn = designNumber.toUpperCase();
    if (name.includes(dn) || desc.includes(dn)) {
      return { id: doc.id, ...data };
    }
  }
  return null;
}

async function processDesignFolder(designPath: string, designNumber: string) {
  const fitModelDir = path.join(designPath, subfolderName);

  if (!fs.existsSync(fitModelDir)) {
    // Check if fit model images are loose in the design folder (like D25742)
    const looseImages = fs.readdirSync(designPath)
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f) && !f.includes('M04'));
    if (looseImages.length === 0) {
      console.log(`  ⚠ No "${subfolderName}" subfolder and no loose images — skipping`);
      return;
    }
    console.log(`  📁 No "${subfolderName}" subfolder, using ${looseImages.length} loose images`);
    return processImages(designPath, looseImages, designNumber);
  }

  const images = fs.readdirSync(fitModelDir)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .sort();

  if (images.length === 0) {
    console.log(`  ⚠ No images in ${subfolderName} — skipping`);
    return;
  }

  console.log(`  📷 Found ${images.length} fit model images`);
  return processImages(fitModelDir, images, designNumber);
}

async function processImages(dir: string, images: string[], designNumber: string) {
  // Find matching wardrobe item
  const item = await findWardrobeItem(designNumber);
  if (!item) {
    console.log(`  ❌ No matching wardrobe item found for "${designNumber}"`);
    return;
  }
  console.log(`  ✅ Matched wardrobe item: "${item.name}" (${item.id}) — category: ${item.category}`);

  if (dryRun) {
    console.log(`  🔍 DRY RUN — would upload ${images.length} images and patch wardrobe item`);
    return;
  }

  // Upload each image resized
  const fitModelUrls: string[] = [];
  const bucket = storage.bucket(BUCKET_NAME);

  for (let i = 0; i < images.length; i++) {
    const imgPath = path.join(dir, images[i]);
    const imgBuffer = fs.readFileSync(imgPath);

    // ALWAYS upload at original resolution — never resize or re-encode
    const resized = imgBuffer;

    const gcsPath = `wardrobe/${item.category}/${item.id}/fitmodel-${i}.jpg`;
    const file = bucket.file(gcsPath);
    await file.save(resized, { metadata: { contentType: 'image/jpeg' } });

    const url = `https://storage.googleapis.com/${BUCKET_NAME}/${gcsPath}`;
    fitModelUrls.push(url);
    console.log(`    📤 Uploaded fitmodel-${i}.jpg (${(resized.length / 1024).toFixed(0)}KB)`);
  }

  // Patch Firestore
  await wardrobeCol.doc(item.id).update({
    fitModelUrls,
    updatedAt: new Date(),
  });
  console.log(`  ✅ Updated wardrobe item with ${fitModelUrls.length} fit model URLs`);
}

async function main() {
  console.log(`\n🔍 Scanning: ${basePath}`);
  console.log(`📂 Looking for "${subfolderName}" subfolders in each design folder`);
  if (dryRun) console.log('🔍 DRY RUN MODE — no uploads will happen\n');
  else console.log('');

  const entries = fs.readdirSync(basePath, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .filter(e => /^[Dd]\d/.test(e.name)) // Design numbers start with D + digit
    .sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) {
    console.log('❌ No design number folders found');
    process.exit(1);
  }

  console.log(`Found ${entries.length} design folders:\n`);

  let matched = 0;
  let skipped = 0;

  for (const entry of entries) {
    console.log(`📦 ${entry.name}`);
    try {
      await processDesignFolder(path.join(basePath, entry.name), entry.name);
      matched++;
    } catch (err: any) {
      console.log(`  ❌ Error: ${err.message}`);
      skipped++;
    }
    console.log('');
  }

  console.log(`\n✅ Done. Processed: ${matched}, Skipped/Errored: ${skipped}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
