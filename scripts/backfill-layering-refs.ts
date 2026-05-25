/**
 * Backfill `layeringRefBackUrl` on every bottom-category wardrobe item.
 *
 * For each entry in `scripts/layering-refs-manifest.json`:
 *   1. Download the M02 back-view image from img1.g-star.com (Cloudinary CDN)
 *   2. Re-upload to gs://gstar-ai-studio-assets/layering-refs/{wardrobeId}.jpg
 *      (durable copy — g-star.com can take the image offline without breaking us)
 *   3. Patch the wardrobe doc with:
 *        layeringRefBackUrl:     'https://storage.googleapis.com/.../layering-refs/{wardrobeId}.jpg'
 *        layeringRefSource: {
 *          sku, pdp,
 *          substitute,                // true when wardrobe SKU not on public site
 *          substituteFor,             // SKU we used as a stand-in (when substitute)
 *          note,                       // free-text justification
 *          capturedAt                 // ISO timestamp of this backfill
 *        }
 *        updatedAt:                Firestore server time
 *
 * Idempotent: skips items that already have a layeringRefBackUrl pointing to our
 * GCS bucket UNLESS --force is passed.
 *
 * Usage:
 *   npx tsx scripts/backfill-layering-refs.ts --dry          # preview only
 *   npx tsx scripts/backfill-layering-refs.ts                # commit
 *   npx tsx scripts/backfill-layering-refs.ts --force        # overwrite existing
 *   npx tsx scripts/backfill-layering-refs.ts --only=<wid>   # one item only
 *
 * Source manifest: scripts/layering-refs-manifest.json
 *   Built 2026-05-24 by scraping g-star.com PDPs against the wardrobe SKUs.
 *   24 direct matches + 7 substitutes (1 colorway, 6 silhouette). See
 *   layering-refs-proposal/BACK_VIEWS_PROPOSAL.md for the substitution table.
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

import { Firestore, FieldValue } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';

const BUCKET_NAME = 'gstar-ai-studio-assets';
const GCS_PREFIX = 'layering-refs';
const MANIFEST_PATH = path.join(__dirname, 'layering-refs-manifest.json');

interface ManifestEntry {
  wardrobeId: string;
  name: string;
  sku: string | null;
  pdp: string | null;
  m02Url: string | null;
  substitute?: boolean;
  substituteFor?: string;
  note?: string;
}

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const FORCE = args.includes('--force');
const ONLY = (args.find(a => a.startsWith('--only=')) || '').replace('--only=', '') || null;

async function fetchBuffer(url: string): Promise<Buffer> {
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!resp.ok) throw new Error(`fetch ${url.slice(0, 80)} -> ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function uploadToGcs(
  storage: Storage,
  buf: Buffer,
  destPath: string,
): Promise<string> {
  const bucket = storage.bucket(BUCKET_NAME);
  const file = bucket.file(destPath);
  await file.save(buf, {
    metadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=3600' },
    resumable: false,
  });
  return `https://storage.googleapis.com/${BUCKET_NAME}/${destPath}?v=${Date.now()}`;
}

async function main() {
  console.log(`Mode: ${DRY ? 'DRY RUN (no writes)' : 'LIVE COMMIT'}${FORCE ? ' [--force]' : ''}${ONLY ? ` [--only=${ONLY}]` : ''}`);
  console.log(`Manifest: ${MANIFEST_PATH}`);

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found at ${MANIFEST_PATH}`);
    process.exit(1);
  }
  const manifest: ManifestEntry[] = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  console.log(`Loaded ${manifest.length} entries.`);

  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });
  const storage = new Storage({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const stats = { processed: 0, written: 0, skipped: 0, failed: 0, missingManifest: 0 };

  for (const entry of manifest) {
    if (ONLY && entry.wardrobeId !== ONLY) continue;
    stats.processed++;
    const tag = entry.substitute ? '[SUB]' : '[DIR]';
    console.log(`\n${tag} ${entry.wardrobeId}  ${entry.name}`);

    if (!entry.m02Url) {
      console.log(`     ⚠️  no m02Url in manifest — skipping`);
      stats.missingManifest++;
      continue;
    }

    // Read current wardrobe state
    const ref = db.collection('wardrobe').doc(entry.wardrobeId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`     ⚠️  wardrobe doc not found — skipping`);
      stats.failed++;
      continue;
    }
    const data = snap.data() as Record<string, unknown>;
    const existing = data.layeringRefBackUrl as string | undefined;

    if (existing && existing.includes(`${BUCKET_NAME}/${GCS_PREFIX}/${entry.wardrobeId}`) && !FORCE) {
      console.log(`     already populated (use --force to overwrite)`);
      stats.skipped++;
      continue;
    }

    const destPath = `${GCS_PREFIX}/${entry.wardrobeId}.jpg`;
    const planned = `https://storage.googleapis.com/${BUCKET_NAME}/${destPath}`;
    console.log(`     source: ${entry.m02Url.slice(0, 100)}`);
    console.log(`     dest:   gs://${BUCKET_NAME}/${destPath}`);
    if (entry.substitute) {
      console.log(`     sub-for: ${entry.substituteFor} (${entry.note || ''})`);
    }

    if (DRY) {
      console.log(`     [DRY] would download + upload + Firestore.update`);
      continue;
    }

    try {
      const buf = await fetchBuffer(entry.m02Url);
      const gcsUrl = await uploadToGcs(storage, buf, destPath);
      await ref.update({
        layeringRefBackUrl: gcsUrl,
        layeringRefSource: {
          sku: entry.sku,
          pdp: entry.pdp,
          substitute: !!entry.substitute,
          ...(entry.substituteFor ? { substituteFor: entry.substituteFor } : {}),
          ...(entry.note ? { note: entry.note } : {}),
          capturedAt: new Date().toISOString(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.log(`     ✓ written (${(buf.length / 1024).toFixed(0)} KB)`);
      stats.written++;
    } catch (e) {
      console.log(`     ❌ failed: ${(e as Error).message}`);
      stats.failed++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Processed:        ${stats.processed}`);
  console.log(`Written:          ${stats.written}`);
  console.log(`Skipped (exists): ${stats.skipped}`);
  console.log(`Missing m02Url:   ${stats.missingManifest}`);
  console.log(`Failed:           ${stats.failed}`);

  if (DRY) {
    console.log(`\n💡 Re-run without --dry to commit.`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
