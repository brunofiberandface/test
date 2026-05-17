/**
 * Programmatically derive a CROPPED region asset (legs-only OR top-only)
 * from the existing full-body asset. Bypasses Gemini's "render full body
 * in 1:1" framing prior that proved resistant to prompt-only fixes
 * (LEARNINGS #97).
 *
 * Two crop modes:
 *   - region='legs': y = 0.36..1.0 → waist-down, M01-style. Center-square
 *     to ~2620×2620 then upscale to 4096×4096 via Lanczos.
 *   - region='top':  y = 0..0.58  → head-to-mid-hip, top-focus M01-style
 *     (for jobs whose focus garment is a TOP — jacket, tee, etc.). Center-
 *     square to ~2376×2376 then upscale to 4096×4096 via Lanczos.
 *
 * Output fields per model doc:
 *   legs → assets4K_legsFront, assets4K_legsBack
 *   top  → assets4K_topFront,  assets4K_topBack
 * Plus matching `assetsThumb_*` for 512×512 JPEG thumbnails.
 *
 * Why programmatic crops, not Gemini renders:
 *   When the source reference image shows a full-body composition,
 *   Gemini's visual prior anchors to that framing regardless of textual
 *   "render waist-down" or "head-to-waist" instructions. Visual cues
 *   beat text. Programmatic sharp crops are deterministic, $0, and never
 *   misframe.
 *
 * Usage:
 *   npx tsx scripts/crop-region-from-fullbody.ts <modelId> <region> [side]
 *     region: 'legs' | 'top'
 *     side:   'front' | 'back' | 'both'  (default 'both')
 *
 * Examples:
 *   npx tsx scripts/crop-region-from-fullbody.ts M15 legs front
 *   npx tsx scripts/crop-region-from-fullbody.ts F9 top both
 *   npx tsx scripts/crop-region-from-fullbody.ts F9 legs both
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

type Region = 'legs' | 'top';
type Side = 'front' | 'back';

const args = process.argv.slice(2);
const modelId = args[0];
const region = (args[1] as Region) || undefined;
const which = (args[2] || 'both') as Side | 'both';

if (!modelId || !region || !['legs', 'top'].includes(region)) {
  console.error('Usage: npx tsx scripts/crop-region-from-fullbody.ts <modelId> <legs|top> [front|back|both]');
  process.exit(1);
}

async function fetchBuf(url: string): Promise<Buffer> {
  const r = await fetch(url.split('?')[0]);
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/**
 * Compute the crop window (top y-coord and height) for the requested region.
 * - legs: from y = 0.36 × H to bottom (waist-down, covers waistband to feet)
 * - top:  from y = 0 to y = 0.58 × H (head-to-mid-hip, covers full top
 *         garment area — includes shoulders + arms + torso + waistband)
 *
 * Tuned for our standardised full-body 4K pose:
 *   - hipbone ≈ y=0.45–0.50
 *   - waistband (top of hot-pants/boxer-briefs) ≈ y=0.50
 *   - top of head with 10-15% headroom ≈ y=0.05
 *   - mid-thigh ≈ y=0.65
 *
 * Top crop ends at y=0.58 to capture the full top garment including
 * waistband area where a tucked-in tee or jacket hem might land. Legs crop
 * starts at y=0.36 to capture the bottom edge of a top garment + a small
 * band of midriff above the waistband for visual continuity.
 */
function getCropWindow(region: Region, H: number): { topStart: number; cropHeight: number } {
  if (region === 'legs') {
    const topStart = Math.round(H * 0.36);
    return { topStart, cropHeight: H - topStart };
  }
  // region === 'top'
  const topStart = 0;
  const cropHeight = Math.round(H * 0.58);
  return { topStart, cropHeight };
}

async function processSide(
  db: Firestore,
  modelId: string,
  region: Region,
  side: Side,
): Promise<void> {
  const fullKey = side === 'front' ? 'fullBodyFront' : 'fullBodyBack';
  const outKey = region === 'legs'
    ? (side === 'front' ? 'legsFront' : 'legsBack')
    : (side === 'front' ? 'topFront' : 'topBack');

  console.log(`\n── ${modelId} ${outKey} (cropping ${region} from ${fullKey}) ──`);
  const snap = await db.collection('models').doc(modelId).get();
  if (!snap.exists) throw new Error(`Model ${modelId} not found`);
  const model = snap.data() as Record<string, string | undefined>;
  const srcUrl = model[`assets4K_${fullKey}`];
  if (!srcUrl) throw new Error(`Model ${modelId} has no ${fullKey} asset`);

  const srcBuf = await fetchBuf(srcUrl);
  const meta = await sharp(srcBuf).metadata();
  const W = meta.width || 4096;
  const H = meta.height || 4096;
  console.log(`  Source: ${W}×${H}`);

  // Step 1: extract the vertical region (full width).
  const { topStart, cropHeight } = getCropWindow(region, H);
  const verticalRegion = await sharp(srcBuf)
    .extract({ left: 0, top: topStart, width: W, height: cropHeight })
    .toBuffer();
  console.log(`  Region: ${W}×${cropHeight} (y=${topStart}..${topStart + cropHeight})`);

  // Step 2: center-crop horizontally to a square. The square side = the
  // shorter of (cropHeight, W). Both legs and top crops have cropHeight < W
  // for our 4K full-body source, so the square side equals cropHeight.
  const squareSide = Math.min(cropHeight, W);
  const xOff = Math.floor((W - squareSide) / 2);
  const yOff = Math.floor((cropHeight - squareSide) / 2);
  const square = await sharp(verticalRegion)
    .extract({ left: xOff, top: yOff, width: squareSide, height: squareSide })
    .toBuffer();
  console.log(`  Center-squared: ${squareSide}×${squareSide} (xOff=${xOff}, yOff=${yOff})`);

  // Step 3: resize to 4096×4096 via Lanczos.
  const finalBuf = await sharp(square)
    .resize(4096, 4096, { kernel: 'lanczos3', fit: 'fill' })
    .png({ compressionLevel: 6 })
    .toBuffer();
  console.log(`  Resized to 4096×4096: ${(finalBuf.length / 1024 / 1024).toFixed(1)}MB`);

  // Upload 4K + thumb.
  const url = await uploadGeneratedImage(`model-assets/${modelId}`, `${outKey}.png`, finalBuf);
  const thumbBuf = await sharp(finalBuf)
    .resize(512, 512, { fit: 'cover', kernel: 'lanczos3' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const thumbUrl = await uploadGeneratedImage(
    `model-assets/${modelId}`,
    `${outKey}_thumb.jpg`,
    thumbBuf,
    'image/jpeg',
  );

  // Patch Firestore with cache-busted URLs so Next.js Image optimizer +
  // browser cache refetch the freshly-uploaded files.
  const v = Date.now();
  await db.collection('models').doc(modelId).update({
    [`assets4K_${outKey}`]: `${url}?v=${v}`,
    [`assetsThumb_${outKey}`]: `${thumbUrl}?v=${v}`,
    assets4K_updatedAt: new Date().toISOString(),
    assetsThumb_updatedAt: new Date().toISOString(),
  });
  console.log(`  ✓ Uploaded + Firestore patched (${outKey})`);
}

(async () => {
  const db = new Firestore();
  if (which === 'front' || which === 'both') await processSide(db, modelId, region!, 'front');
  if (which === 'back' || which === 'both') await processSide(db, modelId, region!, 'back');
  console.log(`\n════ DONE: ${modelId} ${region} (${which}) ════`);
})().catch(e => { console.error(e); process.exit(1); });
