/**
 * Backfill 512×512 JPEG thumbnails for the 4K model assets so the model
 * detail page can load fast (thumbs in grid, 4K only on click).
 *
 * For each model with `assets4K_*` URLs already set:
 *   1. Download each 4K PNG (~17 MB) from GCS.
 *   2. Resize via sharp to 512×512 JPEG (quality 82) → ~50-80 KB each.
 *   3. Upload as model-assets/{modelId}/{view}_thumb.jpg.
 *   4. Patch Firestore with the new `assetsThumb_*` URL fields.
 *
 * Idempotent — running again overwrites existing thumbs (cheap, ~1-2s per
 * asset). No Gemini calls, no model regen.
 *
 * Usage:
 *   npx tsx scripts/backfill-model-thumbs.ts <modelId> [<modelId2> ...]
 *   npx tsx scripts/backfill-model-thumbs.ts --all       # all active models
 */
import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  const c = fs.readFileSync(envPath, 'utf-8');
  for (const line of c.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { Firestore } from '@google-cloud/firestore';
import { uploadGeneratedImage } from '../src/lib/gcs';
import sharp from 'sharp';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npx tsx scripts/backfill-model-thumbs.ts <modelId> [...] OR --all');
  process.exit(1);
}

const THUMB_SIZE = 512;
const THUMB_QUALITY = 82;

type ViewKey = 'fullBodyFront' | 'fullBodyBack' | 'legsFront' | 'legsBack';
const VIEWS: ViewKey[] = ['fullBodyFront', 'fullBodyBack', 'legsFront', 'legsBack'];

async function fetchBuf(url: string): Promise<Buffer> {
  const r = await fetch(url.split('?')[0]);
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function generateThumb(srcBuf: Buffer): Promise<Buffer> {
  return sharp(srcBuf)
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', kernel: 'lanczos3' })
    .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
    .toBuffer();
}

async function processModel(db: Firestore, modelId: string): Promise<void> {
  console.log(`\n════ ${modelId} ════`);
  const snap = await db.collection('models').doc(modelId).get();
  if (!snap.exists) { console.error(`  Model ${modelId} not found`); return; }
  const model = snap.data() as Record<string, string | undefined>;

  const update: Record<string, string> = {};
  for (const view of VIEWS) {
    const srcUrl = model[`assets4K_${view}`];
    if (!srcUrl) {
      console.log(`  ${view}: no 4K asset, skipping`);
      continue;
    }
    try {
      const t0 = Date.now();
      const srcBuf = await fetchBuf(srcUrl);
      const thumbBuf = await generateThumb(srcBuf);
      const thumbUrl = await uploadGeneratedImage(
        `model-assets/${modelId}`,
        `${view}_thumb.jpg`,
        thumbBuf,
        'image/jpeg',
      );
      update[`assetsThumb_${view}`] = thumbUrl;
      console.log(`  ✓ ${view}: ${(srcBuf.length / 1024 / 1024).toFixed(1)}MB → ${(thumbBuf.length / 1024).toFixed(0)}KB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      console.error(`  ✗ ${view} failed:`, e instanceof Error ? e.message : e);
    }
  }

  if (Object.keys(update).length > 0) {
    update['assetsThumb_updatedAt'] = new Date().toISOString();
    await db.collection('models').doc(modelId).update(update);
    console.log(`  ✓ Firestore patched with ${Object.keys(update).length - 1} thumb URLs`);
  }
}

async function main() {
  const db = new Firestore();
  let modelIds: string[];
  if (args[0] === '--all') {
    const snap = await db.collection('models').where('active', '==', true).get();
    modelIds = snap.docs.map(d => d.id);
    console.log(`Found ${modelIds.length} active models`);
  } else {
    modelIds = args;
  }
  // Process sequentially — each model is 4 quick downloads/uploads, no need for parallelism.
  for (const id of modelIds) {
    await processModel(db, id);
  }
  console.log(`\n════ DONE: ${modelIds.length} model(s) processed ════`);
}

main().catch(e => { console.error(e); process.exit(1); });
