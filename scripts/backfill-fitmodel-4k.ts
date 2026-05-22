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

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const [category, wardrobeId, frontDSC, backDSC] = positional;
  if (!category || !wardrobeId || !frontDSC || !backDSC) {
    console.error('Usage: backfill-fitmodel-4k.ts <category> <wardrobeId> <frontDSC> <backDSC> [--front-name <file>] [--back-name <file>]');
    process.exit(1);
  }
  if (!fs.existsSync(frontDSC)) throw new Error(`Front DSC not found: ${frontDSC}`);
  if (!fs.existsSync(backDSC)) throw new Error(`Back DSC not found: ${backDSC}`);

  const frontName = opts['front-name'] || 'fitmodel_04.jpg';
  const backName = opts['back-name'] || 'fitmodel_05.jpg';

  console.log(`\n=== Backfilling ${category}/${wardrobeId} ===`);
  console.log(`  front slot: ${frontName}`);
  console.log(`  back slot: ${backName}`);

  // Front
  console.log(`\n[front]`);
  const frontTmp = `/tmp/fitmodel_4K_${wardrobeId}_front.jpg`;
  const fOut = await rerenderTo4K(frontDSC, frontTmp);
  console.log(`  out ${frontTmp}: ${fOut.width}×${fOut.height}, ${(fOut.bytes / 1024 / 1024).toFixed(1)}MB`);
  uploadToGCS(frontTmp, `wardrobe/${category}/${wardrobeId}/${frontName}`);
  fs.unlinkSync(frontTmp);

  // Back
  console.log(`\n[back]`);
  const backTmp = `/tmp/fitmodel_4K_${wardrobeId}_back.jpg`;
  const bOut = await rerenderTo4K(backDSC, backTmp);
  console.log(`  out ${backTmp}: ${bOut.width}×${bOut.height}, ${(bOut.bytes / 1024 / 1024).toFixed(1)}MB`);
  uploadToGCS(backTmp, `wardrobe/${category}/${wardrobeId}/${backName}`);
  fs.unlinkSync(backTmp);

  console.log(`\nDone. URLs unchanged — wardrobe doc doesn't need updating.`);
  console.log(`  https://storage.googleapis.com/${BUCKET}/wardrobe/${category}/${wardrobeId}/${frontName}`);
  console.log(`  https://storage.googleapis.com/${BUCKET}/wardrobe/${category}/${wardrobeId}/${backName}`);
}

main().catch(e => { console.error(e); process.exit(1); });
