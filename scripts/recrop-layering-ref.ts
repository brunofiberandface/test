/**
 * Re-crop a layering ref to the hem ↔ shoe region only.
 *
 * Motivation (2026-05-24): Cargo trouser test scored 2/6 because the
 * substitute layering ref (Rovic Cargo) differs from the actual cargo
 * on wash + silhouette + cut. Seedream pulled those conflicting signals
 * from the ref instead of using it only for hem-vs-shoe geometry.
 *
 * Crop to bottom 40% (below-knee → floor) keeps the ONLY signal we
 * actually want — the geometric relationship between trouser hem and
 * shoe — and drops the noise. Floor stays visible at the bottom of
 * the crop so Seedream reads it as a hem detail, not a cropped pant.
 *
 * Overwrites the same GCS path (gs://gstar-ai-studio-assets/layering-refs/
 * {wardrobeId}.jpg) so no other code needs to change — test-m02-tier2-arch.ts
 * picks up the new image automatically on the next run.
 *
 * Usage:
 *   npx tsx scripts/recrop-layering-ref.ts <wardrobeId> [--region=below-knee]
 *   npx tsx scripts/recrop-layering-ref.ts --all-substitutes [--region=below-knee]
 *
 * Regions:
 *   below-knee (default) — bottom 40% of source. Knee → hem → shoe → floor.
 *   tight                 — bottom 28%. Mid-calf → shoe → floor. More aggressive.
 *
 * Backed up to gs://gstar-ai-studio-assets/layering-refs/full/{wardrobeId}.jpg
 * before overwrite so restore is one gsutil mv away.
 */
import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';

const BUCKET = 'gstar-ai-studio-assets';
const ARCHIVE_PREFIX = 'layering-refs/full';
const LIVE_PREFIX = 'layering-refs';

const args = process.argv.slice(2);
const allSubstitutes = args.includes('--all-substitutes');
const regionArg = args.find(a => a.startsWith('--region=')) || '--region=below-knee';
const region = regionArg.split('=')[1] as 'below-knee' | 'tight';
const wardrobeId = !allSubstitutes ? args[0] : null;

if (!wardrobeId && !allSubstitutes) {
  console.error('Usage: npx tsx scripts/recrop-layering-ref.ts <wardrobeId> [--region=below-knee|tight]');
  console.error('   or: npx tsx scripts/recrop-layering-ref.ts --all-substitutes [--region=below-knee|tight]');
  process.exit(1);
}

const REGION_BOTTOM = { 'below-knee': 0.40, 'tight': 0.28 }[region];
if (!REGION_BOTTOM) {
  console.error(`Unknown region: ${region}. Use 'below-knee' or 'tight'.`);
  process.exit(1);
}

async function process(db: Firestore, storage: Storage, wid: string): Promise<{ok: boolean; note?: string}> {
  const docRef = db.collection('wardrobe').doc(wid);
  const snap = await docRef.get();
  if (!snap.exists) return { ok: false, note: 'wardrobe doc not found' };
  const data = snap.data() as any;
  const livePath = `${LIVE_PREFIX}/${wid}.jpg`;
  const archivePath = `${ARCHIVE_PREFIX}/${wid}.jpg`;

  const bucket = storage.bucket(BUCKET);
  const liveFile = bucket.file(livePath);
  const [exists] = await liveFile.exists();
  if (!exists) return { ok: false, note: 'GCS file not found' };

  // 1. Archive the current full image (idempotent — skips if already archived)
  const archiveFile = bucket.file(archivePath);
  const [archived] = await archiveFile.exists();
  if (!archived) {
    await liveFile.copy(archiveFile);
    console.log(`  archived → gs://${BUCKET}/${archivePath}`);
  } else {
    console.log(`  already archived (skip archive step)`);
  }

  // 2. Download, crop, re-upload
  const [buf] = await liveFile.download();
  const meta = await sharp(buf).metadata();
  const w = meta.width!, h = meta.height!;
  const cropH = Math.round(h * REGION_BOTTOM);
  const topY = h - cropH;
  const cropped = await sharp(buf)
    .extract({ left: 0, top: topY, width: w, height: cropH })
    .jpeg({ quality: 92 })
    .toBuffer();
  await liveFile.save(cropped, {
    metadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=3600' },
    resumable: false,
  });

  // 3. Update Firestore with a cache-buster + flag
  const newUrl = `https://storage.googleapis.com/${BUCKET}/${livePath}?v=${Date.now()}`;
  const existingSource = data.layeringRefSource || {};
  await docRef.update({
    layeringRefBackUrl: newUrl,
    layeringRefSource: {
      ...existingSource,
      cropped: true,
      cropRegion: region,
      croppedAt: new Date().toISOString(),
    },
    updatedAt: new Date(),
  });

  console.log(`  ✓ recropped ${region} (${w}×${h} → ${w}×${cropH}, ${(cropped.length/1024).toFixed(0)} KB)`);
  return { ok: true };
}

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });
  const storage = new Storage({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  console.log(`Mode: ${allSubstitutes ? 'ALL substitutes' : `single (${wardrobeId})`} | region: ${region} (bottom ${(REGION_BOTTOM*100).toFixed(0)}%)`);

  if (allSubstitutes) {
    // Iterate wardrobe items where layeringRefSource.substitute === true
    const snap = await db.collection('wardrobe').where('category', '==', 'bottom').get();
    let processed = 0, skipped = 0, failed = 0;
    for (const doc of snap.docs) {
      const data = doc.data() as any;
      const src = data.layeringRefSource || {};
      if (!src.substitute) { skipped++; continue; }
      console.log(`\n${doc.id}  ${data.name}  (substitute for ${src.substituteFor})`);
      try {
        const r = await process(db, storage, doc.id);
        if (r.ok) processed++; else { failed++; console.log(`  ⚠️  ${r.note}`); }
      } catch (e) {
        failed++;
        console.log(`  ❌ ${(e as Error).message}`);
      }
    }
    console.log(`\nSummary: ${processed} cropped, ${skipped} skipped (not substitutes), ${failed} failed.`);
  } else {
    console.log(`\n${wardrobeId}`);
    const r = await process(db, storage, wardrobeId!);
    if (!r.ok) {
      console.error(`Failed: ${r.note}`);
      process.exit(1);
    }
  }
  console.log(`\n💡 Re-run test-m02-tier2-arch.ts against the same job(s) to see if the cropped ref improves stability.`);
  console.log(`💡 To restore originals: gsutil cp gs://${BUCKET}/${ARCHIVE_PREFIX}/<wardrobeId>.jpg gs://${BUCKET}/${LIVE_PREFIX}/<wardrobeId>.jpg`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
