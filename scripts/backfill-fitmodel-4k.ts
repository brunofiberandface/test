/**
 * Backfill wardrobe fit-model fitmodel_04 (front) + fitmodel_05 (back)
 * with 4K versions sourced from DSLR originals in /000 run 09 april/.
 *
 * Workflow per (wardrobeId, frontDSC, backDSC):
 *   1. Read DSLR original (typically 5504×8256 after EXIF rotation)
 *   2. Apply EXIF rotation
 *   3. Resize so height = 4096px, preserve aspect (e.g. 2731×4096)
 *   4. JPEG quality 92
 *   5. Upload to gs://gstar-ai-studio-assets/wardrobe/{category}/{wardrobeId}/fitmodel_NN.jpg
 *      (overwrites the existing 1333×2000 file at the same URL — no wardrobe
 *       doc update needed because the URL is unchanged)
 *
 * IMPORTANT: This script ONLY replaces the two canonical slots (front + back).
 * The 45° variants (fitmodel_00, _01, _02, _03) are left untouched.
 *
 * Call:
 *   npx tsx scripts/backfill-fitmodel-4k.ts <category> <wardrobeId> <frontDSC> <backDSC>
 *     [--front-name <slot.jpg>] [--back-name <slot.jpg>]
 *
 * Default slot names: fitmodel_04.jpg (front), fitmodel_05.jpg (back).
 * Override when the wardrobe uses v2 slot keys (fitmodel_front.jpg / fitmodel_back.jpg)
 * or other legacy slot keys observed in production (00/03/05).
 *
 * Example:
 *   npx tsx scripts/backfill-fitmodel-4k.ts bottom 4nyMHh7ICQLrpxBX8zmP \
 *     "/Users/.../JUDEE LOOSE WMN/_DSC4714.JPG" \
 *     "/Users/.../JUDEE LOOSE WMN/_DSC4753.JPG"
 *
 *   npx tsx scripts/backfill-fitmodel-4k.ts bottom C8inPAjtaie8SxdMjs1s \
 *     /path/front.jpg /path/back.jpg \
 *     --front-name fitmodel_front.jpg --back-name fitmodel_back.jpg
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import sharp from 'sharp';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

const TARGET_HEIGHT = 4096;
const JPEG_QUALITY = 92;
const BUCKET = 'gstar-ai-studio-assets';

async function rerenderTo4K(srcPath: string, destTmp: string): Promise<{ width: number; height: number; bytes: number }> {
  const meta = await sharp(srcPath).metadata();
  console.log(`  src ${path.basename(srcPath)}: ${meta.width}×${meta.height} orient=${meta.orientation}`);
  const outBuf = await sharp(srcPath)
    .rotate() // apply EXIF orientation
    .resize({ height: TARGET_HEIGHT, withoutEnlargement: false })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  fs.writeFileSync(destTmp, outBuf);
  const outMeta = await sharp(destTmp).metadata();
  return { width: outMeta.width || 0, height: outMeta.height || 0, bytes: outBuf.length };
}

function uploadToGCS(localPath: string, gcsPath: string): void {
  const gcsUrl = `gs://${BUCKET}/${gcsPath}`;
  console.log(`  uploading → ${gcsUrl}`);
  const r = spawnSync('gcloud', [
    'storage', 'cp', localPath, gcsUrl,
    '--project', 'gstar-ai-studio',
  ], { stdio: 'pipe' });
  if (r.status !== 0) {
    console.error('  stderr:', r.stderr.toString().slice(0, 400));
    throw new Error(`gcloud storage cp failed: status ${r.status}`);
  }
}

function parseArgs(argv: string[]): { positional: string[]; opts: Record<string, string> } {
  const positional: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) throw new Error(`Missing value for --${key}`);
      opts[key] = val;
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, opts };
}

/**
 * Resolve the actual GCS destination path for a wardrobe slot by reading
 * the URL from the wardrobe doc's `fitModels[<slotKey>]` field. This is
 * the source of truth — categories on the doc may differ from the GCS
 * path (e.g., doc.category='bottom' but the slot URL is at
 * `wardrobe/pants/...` from when the item was created under the legacy
 * 'pants' category).
 *
 * Returns the bucket-relative path (e.g. `wardrobe/pants/abc/fitmodel_00.jpg`)
 * extracted from the doc URL. Throws if the slot has no URL.
 */
async function resolveGcsPath(
  wardrobeId: string,
  slotKey: 'front' | 'front45Left' | 'front45Right' | 'back' | 'back45Left' | 'back45Right',
): Promise<string> {
  const { Firestore } = await import('@google-cloud/firestore');
  const db = new Firestore();
  const snap = await db.collection('wardrobe').doc(wardrobeId).get();
  if (!snap.exists) throw new Error(`Wardrobe doc ${wardrobeId} not found`);
  const fm = ((snap.data() as Record<string, unknown>).fitModels || {}) as Record<string, string>;
  const url = fm[slotKey];
  if (!url) throw new Error(`Wardrobe ${wardrobeId} has no fitModels.${slotKey} URL`);
  // URL format: https://storage.googleapis.com/<bucket>/<path>
  const m = url.split('?')[0].match(new RegExp(`^https://storage\\.googleapis\\.com/${BUCKET}/(.+)$`));
  if (!m) throw new Error(`Could not parse GCS path from URL: ${url}`);
  return m[1];
}

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const [category, wardrobeId, frontDSC, backDSC] = positional;
  if (!category || !wardrobeId || !frontDSC || !backDSC) {
    console.error('Usage: backfill-fitmodel-4k.ts <category> <wardrobeId> <frontDSC> <backDSC>');
    console.error('  Optional flags (override slot inference from the doc URL):');
    console.error('    --front-slot <key> --back-slot <key>     (resolve path from wardrobe doc)');
    console.error('    --front-name <file> --back-name <file>   (force a filename; falls back to legacy `wardrobe/{category}/{wardrobeId}/`)');
    console.error('');
    console.error('  Default behaviour: looks up the front + back slot URLs from the wardrobe');
    console.error('  doc and overwrites those exact GCS paths (the URLs the app actually loads).');
    process.exit(1);
  }
  if (!fs.existsSync(frontDSC)) throw new Error(`Front DSC not found: ${frontDSC}`);
  if (!fs.existsSync(backDSC)) throw new Error(`Back DSC not found: ${backDSC}`);

  // Default: resolve target paths from the wardrobe doc's `fitModels.front`
  // and `fitModels.back` URLs. This is the source of truth — Bruno's app
  // loads whatever URL the doc references, so we must write THERE, not at
  // a path we guess from --category.
  let frontPath: string;
  let backPath: string;
  const frontSlotKey = opts['front-slot'] || 'front';
  const backSlotKey = opts['back-slot'] || 'back';
  if (opts['front-name'] || opts['back-name']) {
    // Legacy override: caller specifies filenames; path is built from --category.
    const frontName = opts['front-name'] || 'fitmodel_04.jpg';
    const backName = opts['back-name'] || 'fitmodel_05.jpg';
    frontPath = `wardrobe/${category}/${wardrobeId}/${frontName}`;
    backPath = `wardrobe/${category}/${wardrobeId}/${backName}`;
    console.log(`\n=== Backfilling ${wardrobeId} (manual paths) ===`);
    console.log(`  front: ${frontPath}`);
    console.log(`  back:  ${backPath}`);
  } else {
    // Read from doc — the safe default.
    frontPath = await resolveGcsPath(wardrobeId, frontSlotKey as 'front');
    backPath = await resolveGcsPath(wardrobeId, backSlotKey as 'back');
    console.log(`\n=== Backfilling ${wardrobeId} (paths resolved from wardrobe doc) ===`);
    console.log(`  ${frontSlotKey} slot → ${frontPath}`);
    console.log(`  ${backSlotKey} slot → ${backPath}`);
  }

  // Front
  console.log(`\n[front]`);
  const frontTmp = `/tmp/fitmodel_4K_${wardrobeId}_front.jpg`;
  const fOut = await rerenderTo4K(frontDSC, frontTmp);
  console.log(`  out ${frontTmp}: ${fOut.width}×${fOut.height}, ${(fOut.bytes / 1024 / 1024).toFixed(1)}MB`);
  uploadToGCS(frontTmp, frontPath);
  fs.unlinkSync(frontTmp);

  // Back
  console.log(`\n[back]`);
  const backTmp = `/tmp/fitmodel_4K_${wardrobeId}_back.jpg`;
  const bOut = await rerenderTo4K(backDSC, backTmp);
  console.log(`  out ${backTmp}: ${bOut.width}×${bOut.height}, ${(bOut.bytes / 1024 / 1024).toFixed(1)}MB`);
  uploadToGCS(backTmp, backPath);
  fs.unlinkSync(backTmp);

  console.log(`\nDone. URLs unchanged — wardrobe doc doesn't need updating.`);
  console.log(`  https://storage.googleapis.com/${BUCKET}/${frontPath}`);
  console.log(`  https://storage.googleapis.com/${BUCKET}/${backPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
