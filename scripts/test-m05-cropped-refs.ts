/**
 * Test M05 Track A: crop visual refs to back-hip region before Seedream.
 *
 * Fixture: H6IsIQxs9n6yVTR1pbR0 (Kate Boyfriend Jeans 62 / F9 Tia).
 *
 * Refs sent in current production (after Track B deploy):
 * - MODEL CARD BACK (full body straight-back shot of the AI model)
 * - FIT MODEL BACK 45° RIGHT (full body fit model on a different person)
 * - FLAT BACK (clean product shot of jeans, no model)
 *
 * Track A: crop MODEL CARD BACK and FIT MODEL refs to the back-hip region
 * (waist to mid-thigh ~ vertical 40-80%) before sending to Seedream. The
 * cropped refs reinforce the "tight crop" intent of the rev 32 prompt.
 * Flat back stays uncropped (it's a product shot, no framing signal).
 *
 * Output saved to /tmp/m05_replay/H6Is_M05_trackA_dryrun.png.
 */
import * as path from 'path';
import * as fs from 'fs';

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

import sharp from 'sharp';
import { Storage } from '@google-cloud/storage';
import { Firestore } from '@google-cloud/firestore';
import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';

const JOB_ID = 'H6IsIQxs9n6yVTR1pbR0';

async function fetchBuffer(url: string): Promise<Buffer> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Crop image to a vertical band. fromPct/toPct in 0..1 (e.g. 0.05/0.30 = top 5-30%). */
async function cropVerticalBand(buf: Buffer, fromPct: number, toPct: number, label: string): Promise<Buffer> {
  const img = sharp(buf);
  const meta = await img.metadata();
  const w = meta.width!;
  const h = meta.height!;
  const top = Math.round(h * fromPct);
  const cropH = Math.round(h * (toPct - fromPct));
  const cropped = await img.extract({ left: 0, top, width: w, height: cropH }).jpeg({ quality: 90 }).toBuffer();
  console.log(`[crop] ${label}: ${w}x${h} → ${w}x${cropH} (vertical ${(fromPct*100).toFixed(0)}-${(toPct*100).toFixed(0)}%)`);
  return cropped;
}

async function uploadToGCS(buf: Buffer, gcsPath: string): Promise<string> {
  const storage = new Storage();
  const bucket = storage.bucket('gstar-ai-studio-assets');
  await bucket.file(gcsPath).save(buf, {
    metadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=3600' },
  });
  return `https://storage.googleapis.com/gstar-ai-studio-assets/${gcsPath}`;
}

async function main() {
  // Setup Firestore
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  // Pull job + refs
  const jobDoc = await db.collection('jobs').doc(JOB_ID).get();
  const job = jobDoc.data() as any;
  console.log(`Job: ${job.jobName} (${JOB_ID})  model=${job.modelId}`);

  // Resolve refs (same as production seedreamM05 after Track B)
  const modelDoc = await db.collection('models').doc(job.modelId).get();
  const model = modelDoc.data() as any;
  const modelBackUrl = model?.backReferenceImageUrl;

  const bottomDoc = await db.collection('wardrobe').doc(job.wardrobe.bottom.itemId).get();
  const bottom = bottomDoc.data() as any;
  const fitBack45R = bottom?.fitModels?.back45Right;
  const flatBack = bottom?.flatBackUrl;

  if (!modelBackUrl || !fitBack45R) throw new Error('Missing required refs');

  console.log(`\n=== Cropping refs (v2: smart per-ref crops) ===`);
  const stamp = Date.now();

  // MODEL CARD BACK — crop to TOP 30% (head + shoulders only). Skips compression
  // shorts styling at the lower body. Gives Seedream skin-tone reference WITHOUT
  // a lower-body styling signal that would conflict with the jeans.
  const modelBackBuf = await fetchBuffer(modelBackUrl);
  const modelBackCropped = await cropVerticalBand(modelBackBuf, 0.05, 0.30, 'MODEL CARD BACK (head/shoulders)');
  const modelBackCroppedUrl = await uploadToGCS(modelBackCropped, `m05-trackA-test/${stamp}/model_back_head.jpg`);
  console.log(`  uploaded: ${modelBackCroppedUrl}`);

  // FIT MODEL BACK 45° — crop to VERTICAL 25-60% (waist down to upper thigh).
  // Captures the actual back-hip pocket area on the jeans. Skips face at top
  // and skips feet/lower legs at bottom (where my previous attempt landed).
  const fitBackBuf = await fetchBuffer(fitBack45R);
  const fitBackCropped = await cropVerticalBand(fitBackBuf, 0.25, 0.60, 'FIT MODEL BACK 45° (hip)');
  const fitBackCroppedUrl = await uploadToGCS(fitBackCropped, `m05-trackA-test/${stamp}/fit_back45R_hip.jpg`);
  console.log(`  uploaded: ${fitBackCroppedUrl}`);

  // Build refs array (Seedream wants URL refs)
  const refs = [
    { url: modelBackCroppedUrl, label: 'MODEL CARD BACK (HEAD + SHOULDERS CROP ONLY) — source of truth for the AI model\'s SKIN TONE, complexion, and hair-edge skin reference. This crop does NOT include the lower body — that\'s deliberate. The lower body of the rendered model wears the jeans from the FIT MODEL reference, not anything visible in this crop.' },
    { url: fitBackCroppedUrl, label: 'FIT MODEL BACK 45° RIGHT (HIP / BACK-POCKET CROP) — primary garment-fit reference for the back-hip pocket geometry, stitching, pocket construction, and the framing target for THIS render. The rendered M05 frame should match this crop\'s framing — tight, hip-buttock as central composition. SKIN TONE, COMPLEXION, IDENTITY are NOT taken from this image — those come from the MODEL CARD head/shoulders crop.' },
  ];
  if (flatBack) {
    refs.push({ url: flatBack.split('?')[0], label: 'FLAT BACK — clean back-view product shot of the garment (no model). Source for fabric, color, seams, pocket construction. NOT a source for framing or model identity.' });
  }

  // Load rev 32 prompt body
  const promptBody = fs.readFileSync('/tmp/m05-rev33-body.txt', 'utf-8');
  console.log(`\nPrompt: ${promptBody.length} chars`);
  console.log(`Refs: ${refs.length} (all cropped to back-hip region)`);

  console.log(`\n=== Calling Seedream ===`);
  const t0 = Date.now();
  const result = await generateSeedreamImage({
    prompt: promptBody,
    referenceImages: refs,
    aspectRatio: '1:1',
  });
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.imageData.length} bytes`);

  const outPath = '/tmp/m05_replay/H6Is_M05_trackA_dryrun.png';
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, result.imageData);
  console.log(`\n[wrote] ${outPath}`);
  console.log(`Inspect: open ${outPath}`);
  console.log(`\nCropped refs saved at:`);
  console.log(`  ${modelBackCroppedUrl}`);
  console.log(`  ${fitBackCroppedUrl}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
