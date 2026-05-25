/**
 * Test the "recomposite crisp subject on top of Gemini grounding-shadow regen"
 * approach Bruno proposed (2026-05-18).
 *
 * Flow:
 *   1. Invoke matte job with the new DST_MATTE_GCS_URL output — gets back
 *      both the composited variants (grey/white with procedural shadow) AND
 *      the raw RGBA subject matte (transparent bg, alpha edges from rembg).
 *   2. Run Gemini grounding-shadow regen on the procedural-shadow output
 *      (current production behavior — softens the subject).
 *   3. NEW: composite the rembg matte (crisp subject + alpha) on top of the
 *      Gemini regen output. Backdrop + Gemini shadow stays, subject swaps
 *      back to crisp version.
 *   4. Save all variants for visual comparison.
 *
 * Output:
 *   test_outputs/matte-recomposite/source.png          — input (teeedit stage)
 *   test_outputs/matte-recomposite/matte.png           — rembg RGBA subject
 *   test_outputs/matte-recomposite/grey_raw.png        — rembg + procedural shadow (no Gemini)
 *   test_outputs/matte-recomposite/grey_regen.png      — after Gemini regen (production)
 *   test_outputs/matte-recomposite/grey_recomposite.png — NEW: regen backdrop + crisp subject
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

import { Storage } from '@google-cloud/storage';
import { GoogleAuth } from 'google-auth-library';
import { addGroundingShadowGemini } from '../src/lib/subject-matte';
import sharp from 'sharp';

const SOURCE_URL = 'https://storage.googleapis.com/gstar-ai-studio-assets/output/Kate%20Boyfriend%20Jeans/debug/F6_M06_v1_teeedit.png';
const OUT_BASE = path.join(projectRoot, 'test_outputs', 'matte-recomposite');
const BUCKET = 'gstar-ai-studio-assets';
const TEMP_PREFIX = 'matte-tmp';
const JOB_NAME = 'subject-matte-job';
const PROJECT = 'gstar-ai-studio';
const REGION = 'europe-west1';
const RUN_API_BASE = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}`;

async function main() {
  fs.mkdirSync(OUT_BASE, { recursive: true });

  // 0. Pull source (the F6 M06 teeedit stage — crisp denim)
  console.log(`Fetching source: ${SOURCE_URL}`);
  const r = await fetch(SOURCE_URL);
  if (!r.ok) { console.error(`fetch failed: ${r.status}`); process.exit(1); }
  const sourceBuffer = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(path.join(OUT_BASE, 'source.png'), sourceBuffer);
  console.log(`Source: ${(sourceBuffer.length / 1024).toFixed(0)} KB`);

  // 1. Upload to GCS + invoke matte job with DST_MATTE_GCS_URL set
  const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const srcKey = `${TEMP_PREFIX}/${tempId}/src.png`;
  const whiteKey = `${TEMP_PREFIX}/${tempId}/white.png`;
  const greyKey = `${TEMP_PREFIX}/${tempId}/grey.png`;
  const matteKey = `${TEMP_PREFIX}/${tempId}/matte.png`;

  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const storage = new Storage({
    projectId: saKey.project_id,
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });
  const bucket = storage.bucket(BUCKET);

  console.log(`Uploading source → gs://${BUCKET}/${srcKey}`);
  await bucket.file(srcKey).save(sourceBuffer, { metadata: { contentType: 'image/png' } });

  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });
  const client = await auth.getClient();
  const tokenResp = await client.getAccessToken();
  const token = tokenResp.token!;

  console.log(`Invoking matte job (with DST_MATTE_GCS_URL)`);
  const runResp = await fetch(`${RUN_API_BASE}/jobs/${JOB_NAME}:run`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      overrides: {
        containerOverrides: [{
          env: [
            { name: 'SRC_GCS_URL',       value: `gs://${BUCKET}/${srcKey}` },
            { name: 'DST_WHITE_GCS_URL', value: `gs://${BUCKET}/${whiteKey}` },
            { name: 'DST_GREY_GCS_URL',  value: `gs://${BUCKET}/${greyKey}` },
            { name: 'DST_MATTE_GCS_URL', value: `gs://${BUCKET}/${matteKey}` },
          ],
        }],
      },
    }),
  });
  if (!runResp.ok) { console.error(`job run failed: ${runResp.status} ${await runResp.text()}`); process.exit(1); }
  const operation = await runResp.json() as { name: string };
  console.log(`Operation: ${operation.name}`);

  // 2. Poll operation
  const opUrl = `https://run.googleapis.com/v2/${operation.name}`;
  const deadline = Date.now() + 600_000;
  let done = false, lastStatus: any = null;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    const pollResp = await fetch(opUrl, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!pollResp.ok) { console.error(`poll failed: ${pollResp.status}`); process.exit(1); }
    lastStatus = await pollResp.json();
    if (lastStatus.done) { done = true; break; }
  }
  if (!done) { console.error('job timed out'); process.exit(1); }
  if (lastStatus.error) { console.error(`job error: ${JSON.stringify(lastStatus.error)}`); process.exit(1); }
  console.log(`Matte job done`);

  // 3. Download 3 outputs
  const [greyRaw, whiteRaw, matteRaw] = await Promise.all([
    bucket.file(greyKey).download().then(([b]) => b),
    bucket.file(whiteKey).download().then(([b]) => b),
    bucket.file(matteKey).download().then(([b]) => b),
  ]);
  fs.writeFileSync(path.join(OUT_BASE, 'grey_raw.png'), greyRaw);
  fs.writeFileSync(path.join(OUT_BASE, 'white_raw.png'), whiteRaw);
  fs.writeFileSync(path.join(OUT_BASE, 'matte.png'), matteRaw);
  console.log(`Downloaded: grey=${(greyRaw.length / 1024).toFixed(0)}KB, white=${(whiteRaw.length / 1024).toFixed(0)}KB, matte=${(matteRaw.length / 1024).toFixed(0)}KB`);

  // 4. Run Gemini grounding-shadow regen on grey + white
  console.log(`Running Gemini grounding-shadow regen (grey + white in parallel)`);
  const [greyRegen, whiteRegen] = await Promise.all([
    addGroundingShadowGemini(greyRaw, 'grey'),
    addGroundingShadowGemini(whiteRaw, 'white'),
  ]);
  fs.writeFileSync(path.join(OUT_BASE, 'grey_regen.png'), greyRegen.buffer);
  fs.writeFileSync(path.join(OUT_BASE, 'white_regen.png'), whiteRegen.buffer);
  console.log(`Regen: grey ok=${greyRegen.ok} ${(greyRegen.buffer.length / 1024).toFixed(0)}KB, white ok=${whiteRegen.ok} ${(whiteRegen.buffer.length / 1024).toFixed(0)}KB`);

  // 5. NEW: recomposite — paste RGBA matte (crisp subject + alpha) on top of
  //    the regen output. The result: regen's backdrop + Gemini shadow under
  //    feet, subject pixels = original crisp denim/skin/etc.
  console.log(`Recompositing: matte on top of regen`);
  const matteMeta = await sharp(matteRaw).metadata();
  console.log(`Matte: ${matteMeta.width}x${matteMeta.height}, channels=${matteMeta.channels}, alpha=${matteMeta.hasAlpha}`);

  // Match the regen image dimensions for compositing (sharp will refuse if mismatched).
  const regenGreyMeta = await sharp(greyRegen.buffer).metadata();
  console.log(`Regen grey: ${regenGreyMeta.width}x${regenGreyMeta.height}`);

  // Resize the matte to match the regen dimensions if needed (rare — should be same).
  const matteResized = matteMeta.width === regenGreyMeta.width && matteMeta.height === regenGreyMeta.height
    ? matteRaw
    : await sharp(matteRaw).resize(regenGreyMeta.width!, regenGreyMeta.height!).png().toBuffer();

  const greyRecomposite = await sharp(greyRegen.buffer)
    .composite([{ input: matteResized, blend: 'over' }])
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(OUT_BASE, 'grey_recomposite.png'), greyRecomposite);
  console.log(`grey_recomposite saved: ${(greyRecomposite.length / 1024).toFixed(0)}KB`);

  const regenWhiteMeta = await sharp(whiteRegen.buffer).metadata();
  const matteResizedW = matteMeta.width === regenWhiteMeta.width && matteMeta.height === regenWhiteMeta.height
    ? matteRaw
    : await sharp(matteRaw).resize(regenWhiteMeta.width!, regenWhiteMeta.height!).png().toBuffer();

  const whiteRecomposite = await sharp(whiteRegen.buffer)
    .composite([{ input: matteResizedW, blend: 'over' }])
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(OUT_BASE, 'white_recomposite.png'), whiteRecomposite);
  console.log(`white_recomposite saved: ${(whiteRecomposite.length / 1024).toFixed(0)}KB`);

  console.log(`\nInspect: ${OUT_BASE}`);
  console.log(`Compare:`);
  console.log(`  grey_raw.png       — rembg + procedural shadow only (crisp subject)`);
  console.log(`  grey_regen.png     — production after Gemini regen (smooth subject + nice shadow)`);
  console.log(`  grey_recomposite.png — NEW: nice shadow + crisp subject`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
