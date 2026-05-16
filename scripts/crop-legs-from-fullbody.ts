/**
 * Programmatically derive a legs-only (M01-style) asset by cropping the
 * existing full-body asset. Bypasses Gemini's "render full body in 1:1"
 * framing prior that has been resistant to prompt-only fixes.
 *
 * Algorithm:
 *   1. Download the source fullBody asset (4096×4096).
 *   2. Take the bottom-half region: y = 1500..4096 (covers waist down to
 *      feet + floor margin), full width.
 *   3. Center-crop to a square (height = 2596 → take a 2596×2596 region
 *      centered horizontally).
 *   4. Resize back to 4096×4096 via Lanczos.
 *   5. Upload as the legs asset + generate thumb + patch Firestore.
 *
 * Usage:
 *   npx tsx scripts/crop-legs-from-fullbody.ts <modelId> [front|back|both]
 *
 * Defaults to 'front' (legsFront from fullBodyFront).
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

import { Firestore, FieldValue } from '@google-cloud/firestore';
import { uploadGeneratedImage } from '../src/lib/gcs';
import sharp from 'sharp';

const args = process.argv.slice(2);
const modelId = args[0];
const which = (args[1] || 'front') as 'front' | 'back' | 'both';
if (!modelId) {
  console.error('Usage: npx tsx scripts/crop-legs-from-fullbody.ts <modelId> [front|back|both]');
  process.exit(1);
}

async function fetchBuf(url: string): Promise<Buffer> {
  const r = await fetch(url.split('?')[0]);
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function processSide(
  db: Firestore,
  modelId: string,
  side: 'front' | 'back',
): Promise<void> {
  const fullKey = side === 'front' ? 'fullBodyFront' : 'fullBodyBack';
  const legsKey = side === 'front' ? 'legsFront' : 'legsBack';

  console.log(`\n── ${modelId} ${legsKey} (cropping from ${fullKey}) ──`);
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

  // Step 1: take bottom region — y starts at ~36% from top (just above
  // hipbone in our standardised full-body pose) so we capture top edge of
  // waistband. Full width is kept.
  const topStart = Math.round(H * 0.36);
  const bottomHeight = H - topStart;
  const bottomRegion = await sharp(srcBuf)
    .extract({ left: 0, top: topStart, width: W, height: bottomHeight })
    .toBuffer();
  console.log(`  Bottom region: ${W}×${bottomHeight} (y=${topStart}..${H})`);

  // Step 2: center-crop horizontally to a square. The square side = the
  // shorter of (bottomHeight, W). Since W=4096 and bottomHeight is ~2620,
  // we end up with a 2620×2620 square (bottomHeight is shorter).
  const squareSide = Math.min(bottomHeight, W);
  const xOff = Math.floor((W - squareSide) / 2);
  const yOff = Math.floor((bottomHeight - squareSide) / 2); // 0 since bottomHeight ≤ W
  const square = await sharp(bottomRegion)
    .extract({ left: xOff, top: yOff, width: squareSide, height: squareSide })
    .toBuffer();
  console.log(`  Center-squared: ${squareSide}×${squareSide} (xOff=${xOff})`);

  // Step 3: resize back to 4096×4096 via Lanczos (~1.56× upscale).
  const finalBuf = await sharp(square)
    .resize(4096, 4096, { kernel: 'lanczos3', fit: 'fill' })
    .png({ compressionLevel: 6 })
    .toBuffer();
  console.log(`  Resized to 4096×4096: ${(finalBuf.length / 1024 / 1024).toFixed(1)}MB`);

  // Upload 4K + thumb
  const url = await uploadGeneratedImage(`model-assets/${modelId}`, `${legsKey}.png`, finalBuf);
  const thumbBuf = await sharp(finalBuf)
    .resize(512, 512, { fit: 'cover', kernel: 'lanczos3' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const thumbUrl = await uploadGeneratedImage(
    `model-assets/${modelId}`,
    `${legsKey}_thumb.jpg`,
    thumbBuf,
    'image/jpeg',
  );

  // Patch Firestore with cache-busted URLs so the client/Next.js image
  // optimizer treats the asset as new and fetches the fresh upload.
  const v = Date.now();
  await db.collection('models').doc(modelId).update({
    [`assets4K_${legsKey}`]: `${url}?v=${v}`,
    [`assetsThumb_${legsKey}`]: `${thumbUrl}?v=${v}`,
    assets4K_updatedAt: new Date().toISOString(),
    assetsThumb_updatedAt: new Date().toISOString(),
  });
  console.log(`  ✓ Uploaded + Firestore patched (${legsKey})`);
}

(async () => {
  const db = new Firestore();
  if (which === 'front' || which === 'both') await processSide(db, modelId, 'front');
  if (which === 'back' || which === 'both') await processSide(db, modelId, 'back');
  console.log(`\n════ DONE: ${modelId} (${which}) ════`);
})().catch(e => { console.error(e); process.exit(1); });
