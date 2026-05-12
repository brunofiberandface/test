/**
 * One-shot upload of leather brand labels for the April 28 2026 jeans shoot.
 *
 * For each garment folder, picks the appropriate TIFF, converts to JPEG via
 * Sharp at <=2000px long edge, uploads to GCS at:
 *   wardrobe/bottom/<wardrobeId>/leather_label.jpg
 * and writes leatherLabelImageUrl onto the wardrobe doc.
 *
 * TIFF selection rules:
 *   1. If a file matches /label/i in name, use it (one per folder).
 *   2. Else use the first .tif in the folder alphabetically.
 *
 * Idempotent: writes the same path each run.
 */
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ID = 'gstar-ai-studio';
const BUCKET = 'gstar-ai-studio-assets';
const SHOOT_DIR = '/sessions/gifted-kind-gates/mnt/gstar/shoot April 28 2026';

// SFC code → wardrobe ID, from the April 28 batch upload earlier in the session
const MAPPING = {
  'D02153-6553-89 52':  'shU8uNGorWXuyMqS8Iis', // Midge Straight 52
  'D15264-C052-8436 53': '5LCOIQVA7GARxf33WxCY', // Kate 8436 53
  'D15264-C052-A802 51': 'OEyZ0lrt7soRIba963pI', // Kate A802 51
  'D15264-C293-B168 62': 'PWYdwXzb61EXfjhSdulq', // Kate C293 62
  'D15264-D775-G803 61': '6aN3Hxx0GFJFCW9U2Oyj', // Kate D775 61
  'D21290-D987-H280 53': 'C8inPAjtaie8SxdMjs1s', // Flare H280 53
  'D21290-D987-H281 61': '8gr2tzr9Er8m00ZmRzLi', // Flare H281 61
  'D22889-D436-C947 52': 'IUqRKvjYj96i29RvdsbO', // Judee C947 52
  'D22889-D536-G841 53': 'ME7QswY55jaCJQXGi3lc', // Judee G841 53
  'D25372-E266-H545 53': 'Rq3K3UQGdJmVu4W0LwgK', // Bowey E266 53
};

const db = new Firestore({ projectId: PROJECT_ID });
const storage = new Storage({ projectId: PROJECT_ID });
const bucket = storage.bucket(BUCKET);

async function findLabelTif(folderPath) {
  const entries = await fs.readdir(folderPath);
  const tifs = entries.filter(f => /\.tif$/i.test(f));
  if (tifs.length === 0) return null;
  // Prefer files matching /label/i
  const labelMatch = tifs.find(f => /label/i.test(f));
  if (labelMatch) return path.join(folderPath, labelMatch);
  // Otherwise first .tif alphabetically (after sort)
  tifs.sort();
  return path.join(folderPath, tifs[0]);
}

async function tiffToJpeg(tiffPath) {
  const buf = await fs.readFile(tiffPath);
  return await sharp(buf)
    .rotate()
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

const stats = { found: 0, uploaded: 0, missing: 0, errors: 0 };

(async () => {
  for (const [sfc, wardrobeId] of Object.entries(MAPPING)) {
    // Folder name might have trailing space — normalize to entries on disk
    const dirEntries = await fs.readdir(SHOOT_DIR, { withFileTypes: true });
    const folder = dirEntries.find(e => e.isDirectory() && e.name.trim() === sfc.trim());
    if (!folder) {
      console.error(`SKIP ${sfc} — folder not found`);
      stats.missing++;
      continue;
    }
    const folderPath = path.join(SHOOT_DIR, folder.name);

    const tiffPath = await findLabelTif(folderPath);
    if (!tiffPath) {
      console.warn(`SKIP ${sfc} — no .tif file in folder`);
      stats.missing++;
      continue;
    }
    stats.found++;
    const tiffName = path.basename(tiffPath);
    console.log(`\n=== ${sfc} (${wardrobeId}) ===`);
    console.log(`  source TIF: ${tiffName}`);

    try {
      const jpegBuf = await tiffToJpeg(tiffPath);
      const gcsPath = `wardrobe/bottom/${wardrobeId}/leather_label.jpg`;
      await bucket.file(gcsPath).save(jpegBuf, { metadata: { contentType: 'image/jpeg' } });
      const url = `https://storage.googleapis.com/${BUCKET}/${gcsPath}`;
      console.log(`  uploaded ${(jpegBuf.length / 1024).toFixed(0)} KB → ${gcsPath}`);

      await db.collection('wardrobe').doc(wardrobeId).update({
        leatherLabelImageUrl: url,
        updatedAt: new Date(),
      });
      console.log(`  wardrobe doc updated with leatherLabelImageUrl`);
      stats.uploaded++;
    } catch (err) {
      console.error(`  ERROR for ${sfc}:`, err.message);
      stats.errors++;
    }
  }
  console.log('\n=== Summary ===');
  console.log(JSON.stringify(stats, null, 2));
})();
