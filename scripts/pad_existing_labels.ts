/**
 * One-shot backfill: re-pad every existing labelAssets PNG with surrounding
 * transparency so Seedance reads them as small details, not hero subjects.
 *
 * Run:
 *   cd ~/[gstar-studio path] && npx tsx scripts/pad_existing_labels.ts
 *
 * Idempotent: padLabelForSeedance() is a no-op when a PNG is already at or
 * below the target fill ratio. Safe to re-run.
 *
 * Backup: writes the original to gs://gstar-ai-studio-assets/label-assets-raw/
 * before overwriting the live path. If a backup already exists at that path,
 * we skip the backup write (assume previous run did it).
 */
import { Storage } from '@google-cloud/storage';
import { Firestore } from '@google-cloud/firestore';
import { padLabelForSeedance } from '../src/lib/label-padding';

const BUCKET = 'gstar-ai-studio-assets';

async function main() {
  const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID });
  const fs = new Firestore({ projectId: process.env.FIRESTORE_PROJECT_ID || process.env.GCP_PROJECT_ID });
  const bucket = storage.bucket(BUCKET);

  const snap = await fs.collection('labelAssets').get();
  console.log(`Found ${snap.size} labelAssets docs.`);

  for (const doc of snap.docs) {
    const data = doc.data();
    const id = doc.id;
    const type = data.type;
    const imageUrl: string | undefined = data.imageUrl;
    if (!imageUrl) {
      console.log(`  [skip] ${id} — no imageUrl`);
      continue;
    }

    // Resolve GCS path from public URL.
    const prefix = `https://storage.googleapis.com/${BUCKET}/`;
    if (!imageUrl.startsWith(prefix)) {
      console.log(`  [skip] ${id} — imageUrl is not in our bucket: ${imageUrl}`);
      continue;
    }
    const gcsPath = imageUrl.substring(prefix.length);
    const file = bucket.file(gcsPath);

    // Backup original if not already backed up.
    const backupPath = gcsPath.replace(/^label-assets\//, 'label-assets-raw/');
    const backupFile = bucket.file(backupPath);
    const [backupExists] = await backupFile.exists();
    if (!backupExists) {
      await file.copy(backupFile);
      console.log(`  [backup] ${gcsPath} → ${backupPath}`);
    }

    // Download, pad, overwrite.
    const [buffer] = await file.download();
    const padded = await padLabelForSeedance(buffer);
    if (padded === buffer) {
      console.log(`  [no-op] ${id} — already padded enough`);
      continue;
    }
    await file.save(padded, { metadata: { contentType: 'image/png' } });
    console.log(`  [padded] ${id} (${type})  ${buffer.length} → ${padded.length} bytes`);
  }

  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
