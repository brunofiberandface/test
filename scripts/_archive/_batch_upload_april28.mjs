/**
 * Batch upload the 10 jeans from "shoot April 28 2026" into the wardrobe.
 *
 * Per-folder pipeline:
 *   - Read xlsx row matched by SFC code
 *   - Build a Seedream-friendly description via Claude Opus 4.6 from
 *     STYLE NAME + MAAT & PASVORM + BESCHRIJVING
 *   - Resize 6 fit-model jpgs (0..5) to 2000px max edge, upload to GCS
 *     at canonical names: fitmodel_<slot>.jpg
 *   - Use RF-04.jpg as flat_front (resize, upload as flat_front.jpg)
 *   - Create Firestore wardrobe doc with v2 fitModels map + legacy fitModelUrls
 *   - Trigger silhouette analysis via the deployed admin endpoint
 *
 * Image-to-slot mapping (clockwise rotation, model rotates to her right):
 *   0 → front, 1 → front45Left, 2 → back45Left,
 *   3 → back, 4 → back45Right, 5 → front45Right
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa_key.json \
 *     ANTHROPIC_API_KEY=<...> \
 *     node scripts/_batch_upload_april28.mjs [--only=<sfc>] [--dry]
 */
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ID = 'gstar-ai-studio';
const BUCKET_NAME = 'gstar-ai-studio-assets';
const SHOOT_DIR = '/sessions/gifted-kind-gates/mnt/gstar/shoot April 28 2026';
const XLSX_PATH = `${SHOOT_DIR}/AI NOOS jeans shoot - Product descriptions 2.xlsx`;
const REFRESH_URL = 'https://gstar-ai-studio-674145888056.europe-west1.run.app/api/admin/refresh-silhouette';

const args = new Map();
for (const a of process.argv.slice(2)) {
  const [k, v = true] = a.replace(/^--/, '').split('=');
  args.set(k, v);
}
const ONLY = args.get('only') || null;
const DRY = args.has('dry');

const db = new Firestore({ projectId: PROJECT_ID });
const storage = new Storage({ projectId: PROJECT_ID });
const bucket = storage.bucket(BUCKET_NAME);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Image-to-slot mapping (per Bruno: 0=front, model rotates to her right) ──
const SLOT_FOR_INDEX = {
  0: 'front',
  1: 'front45Left',
  2: 'back45Left',
  3: 'back',
  4: 'back45Right',
  5: 'front45Right',
};

// ── Rows loader ───────────────────────────────────────────────────────────
// Pre-extracted to /tmp/april28/rows.json by a Python helper because the xlsx
// parsing libs aren't installable in this sandbox right now. Same shape as
// before: { sfc, styleName, fit, description }[].
async function parseRows() {
  const raw = await fs.readFile('/tmp/april28/rows.json', 'utf8');
  return JSON.parse(raw);
}

// ── Folder match ──────────────────────────────────────────────────────────
async function findFolder(sfc) {
  const entries = await fs.readdir(SHOOT_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.trim() === sfc.trim()) return path.join(SHOOT_DIR, e.name);
  }
  return null;
}

// ── Opus description ──────────────────────────────────────────────────────
async function generateDescription({ styleName, fit, description }) {
  const prompt = `You are writing a product description for an AI image generator (Seedream) that renders e-commerce model shots of denim jeans for G-Star RAW. The description will be passed as a {silhouette}-adjacent text field that helps the generator render the garment correctly.

Source data from G-Star's product database:
- Style: ${styleName}
- Fit specs: ${fit}
- Brand description: ${description}

Write the wardrobe description in this exact two-block format:

LINE 1 (comma-separated fit specs, ending with a comma):
"<Fit Type>, <Waist>, <Leg Shape>, <Length>,"

BLANK LINE

PARAGRAPH (3–5 sentences, plain prose):
A visual description that emphasises (a) the garment's silhouette and how it sits on the body, (b) wash/colour and finish details, (c) construction details that are visible in the shot — fly type, pocket placement, panels, seams, label position. No marketing fluff, no "perfect for daily wear", no superlatives. Direct, factual, visual. Keep it under 80 words.

Output ONLY the description in that format — no preamble, no headers, no quotes around it.`;
  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });
  return resp.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

// ── Resize + upload ───────────────────────────────────────────────────────
async function uploadResized(srcPath, gcsPath, longEdge = 2000, quality = 88) {
  const buf = await fs.readFile(srcPath);
  const out = await sharp(buf)
    .rotate()
    .resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  if (DRY) {
    console.log(`[dry] would upload ${(out.length / 1024).toFixed(0)} KiB → ${gcsPath}`);
    return `https://storage.googleapis.com/${BUCKET_NAME}/${gcsPath}`;
  }
  await bucket.file(gcsPath).save(out, { metadata: { contentType: 'image/jpeg' } });
  return `https://storage.googleapis.com/${BUCKET_NAME}/${gcsPath}`;
}

// ── One garment ───────────────────────────────────────────────────────────
async function uploadOne(row) {
  const folder = await findFolder(row.sfc);
  if (!folder) throw new Error(`Folder not found for SFC ${row.sfc}`);
  console.log(`\n=== ${row.sfc} — ${row.styleName} ===`);
  console.log(`Folder: ${folder}`);

  // 1. Description via Opus
  console.log('Generating description with Opus...');
  const description = await generateDescription(row);
  console.log('Description:\n', description, '\n');

  // 2. Find files. The fit-model jpgs end with " <N>.jpg" (e.g., "... 0.jpg").
  // Most folders have 0..5; one has 0,1,2,3,4,7 (a 5 was skipped). Take all
  // numbered jpgs sorted, use first 6 as the rotation sequence.
  const entries = await fs.readdir(folder);
  const numberedAll = [];
  for (const f of entries) {
    const m = f.match(/ (\d)\.jpg$/);
    if (m) numberedAll.push({ idx: parseInt(m[1], 10), path: path.join(folder, f) });
  }
  numberedAll.sort((a, b) => a.idx - b.idx);
  const numbered = numberedAll.slice(0, 6);
  if (numbered.length < 6) {
    throw new Error(`Expected at least 6 numbered jpgs, found ${numbered.length}`);
  }
  // Flat reference: lenient matcher — any jpg that's NOT a numbered fitmodel
  // photo AND contains either "RF" or "M04" in its name. Covers seen variants:
  //   D02153-...-RF-04.jpg, D15264-...-M04.jpg, D25372-...-M04_RF.jpg
  const flatCandidates = entries
    .filter(f => /\.jpg$/i.test(f))
    .filter(f => !/ \d\.jpg$/.test(f))
    .filter(f => /(?:RF|M04)/i.test(f));
  const flatPath = flatCandidates.length > 0 ? path.join(folder, flatCandidates[0]) : null;
  if (!flatPath) {
    throw new Error(`No flat reference (.*RF.* or .*M04.*) found in ${folder}`);
  }
  console.log(`Flat ref: ${path.basename(flatPath)}`);
  console.log(`Numbered jpgs: ${numbered.map(n => n.idx).join(',')}`);

  // 3. Create Firestore doc first to get an ID
  const designNumber = row.sfc;
  const name = row.styleName + ' ' + (designNumber.split(' ')[1] || ''); // "Midge Straight jeans 52"
  const docData = {
    name: name.trim(),
    designNumber,
    category: 'bottom',
    description,
    gender: 'female',
    isPrimary: true,
    fitModelUrls: [],
    thumbnailUrl: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  let wardrobeId;
  if (DRY) {
    wardrobeId = 'dryrun-' + row.sfc.replace(/\s+/g, '-');
    console.log('[dry] would create wardrobe doc with id', wardrobeId);
  } else {
    const ref = await db.collection('wardrobe').add(docData);
    wardrobeId = ref.id;
    await db.collection('wardrobe').doc(wardrobeId).update({ wardrobeId });
    console.log('Created wardrobe doc:', wardrobeId);
  }

  // 4. Upload images. Map by sequence position (0,1,2,3,4,5) regardless of
  // the actual filename digit — handles folders where one number was skipped
  // (e.g., 0,1,2,3,4,7).
  const fitModels = {};
  const fitModelUrls = [];
  const canonicalOrder = ['front', 'front45Left', 'front45Right', 'back', 'back45Left', 'back45Right'];
  for (let pos = 0; pos < 6; pos++) {
    const slot = SLOT_FOR_INDEX[pos];
    const gcsPath = `wardrobe/bottom/${wardrobeId}/fitmodel_${slot}.jpg`;
    const url = await uploadResized(numbered[pos].path, gcsPath, 2000);
    fitModels[slot] = url;
    console.log(`  fitmodel.${slot} (file idx ${numbered[pos].idx}) → ${gcsPath}`);
  }
  for (const slot of canonicalOrder) if (fitModels[slot]) fitModelUrls.push(fitModels[slot]);

  // 5. Upload flat front (-RF-*.jpg or -M04.jpg)
  const flatFrontGcs = `wardrobe/bottom/${wardrobeId}/flat_front.jpg`;
  const flatFrontUrl = await uploadResized(flatPath, flatFrontGcs, 2000);
  console.log(`  flat_front → ${flatFrontGcs}`);

  // 6. Update Firestore doc with image URLs
  if (!DRY) {
    await db.collection('wardrobe').doc(wardrobeId).update({
      fitModels,
      fitModelUrls,
      flatFrontUrl,
      flatBackUrl: '', // not in this shoot — back-handler falls back to flat_front
      thumbnailUrl: fitModels.front,
      updatedAt: new Date(),
    });
    console.log(`Updated doc ${wardrobeId} with image URLs.`);
  }

  // 7. Trigger silhouette analysis
  if (!DRY) {
    console.log('Triggering silhouette analysis (background)...');
    const r = await fetch(REFRESH_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: wardrobeId }),
    });
    const j = await r.json();
    console.log('Silhouette refresh:', j.success ? `✓ front=${j.frontChars}c back=${j.backChars}c` : `FAIL: ${JSON.stringify(j)}`);
  }

  return { wardrobeId, name: docData.name };
}

// ── Driver ────────────────────────────────────────────────────────────────
(async () => {
  const rows = await parseRows();
  console.log(`Parsed ${rows.length} rows from xlsx.`);
  const targets = ONLY ? rows.filter(r => r.sfc === ONLY.trim()) : rows;
  if (ONLY && targets.length === 0) {
    console.error(`No row matched --only=${ONLY}. Available SFCs:`);
    for (const r of rows) console.error('  ', r.sfc);
    process.exit(1);
  }
  console.log(`Will upload ${targets.length} garment(s)${DRY ? ' (DRY RUN)' : ''}.`);
  const results = [];
  for (const row of targets) {
    try {
      const r = await uploadOne(row);
      results.push({ sfc: row.sfc, ...r, ok: true });
    } catch (err) {
      console.error(`FAILED ${row.sfc}:`, err.message);
      results.push({ sfc: row.sfc, ok: false, error: err.message });
    }
  }
  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(r.ok ? '✓' : '✗', r.sfc, r.ok ? `→ ${r.wardrobeId} (${r.name})` : `[${r.error}]`);
  }
})();
