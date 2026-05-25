/**
 * Sole-mode shoe experiment (Bruno 2026-05-19).
 *
 * Hypothesis: Seedream consistently stops pant hems at the top of CLOSED
 * shoes (sneakers, ankle boots) in back-view renders. We've confirmed this
 * 100+ times. The shoe upper acts as a visual "this is where the pants end"
 * signal that no prompt can override.
 *
 * Theory: strip away the shoe upper from the matrix base. Keep only the sole
 * with bare feet/ankles standing on it — like a sandal. Without the shoe
 * upper to block, Seedream should be able to render long-hem jeans cascading
 * over the foot and onto the floor.
 *
 * Test:
 *   1. Take matrix cell 3xKezovO6eef7SJfMioC_F3 legsBack view (F3 model from
 *      back, in placeholder pants, wearing white leather low-top sneakers).
 *   2. Call Gemini-3-pro-image-preview to convert: strip the sneaker upper,
 *      keep only the sole, bare feet/ankles standing on the sole.
 *   3. Run the lean M02 paint flow with each of 3 long-hem jeans:
 *      - CONTOR 3D WIDE WMN (ZB2GMhoH1hQDjdJQbD6d)
 *      - Judee Low Waist Loose Jeans (6weuQ0caKivxaSTkr4Cw)
 *      - Midge Bootcut Jeans (Hun27VKK37Ca4EWYOsfm)
 *      …once with the closed-sneaker base (baseline) and once with the new
 *      sole-mode base (treatment). Six total Seedream renders.
 *   4. Save all outputs for visual comparison.
 *
 * If sole-mode produces hems that cascade past the foot to the floor (matching
 * the silhouette spec for long-hem trousers), this becomes the standard for
 * any closed-shoe matrix cell — the matrix sync can build a sole-mode
 * variant alongside the closed variant.
 *
 * Outputs in test_outputs/sole-mode/:
 *   sole_base.png                          — Gemini conversion result
 *   closed_base.png                        — original legsBack (for reference)
 *   closed_{contor|judee|midge}.png        — baseline lean M02 paints
 *   sole_{contor|judee|midge}.png          — treatment lean M02 paints
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
import { Storage } from '@google-cloud/storage';
import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';
import { generateImage } from '../src/lib/vertex';

const OUT_DIR = path.join(projectRoot, 'test_outputs', 'sole-mode');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Wardrobe IDs
const SHOE_ID = '3xKezovO6eef7SJfMioC';   // White leather low-top sneaker
const MODEL_ID = 'F3';

const CASES = [
  { label: 'contor', bottomId: 'ZB2GMhoH1hQDjdJQbD6d', name: 'CONTOR 3D WIDE WMN' },
  { label: 'judee',  bottomId: '6weuQ0caKivxaSTkr4Cw', name: 'Judee Low Waist Loose Jeans' },
  { label: 'midge',  bottomId: 'Hun27VKK37Ca4EWYOsfm', name: 'Midge Bootcut Jeans' },
];

const LEAN_PROMPT = `Apply the fitmodel trousers onto the AI model with shoes. so merge the two images, but the trousers should be fully respected in form and fit. all details need to be preserved, IMPORTANT is the trousers run naturally down respecting the fitmodel lenght of the trousers. the model needs to stand equally on 2 feet, 50% on each foot, keeping the same position as the underwear model.`;

const SOLE_CONVERSION_PROMPT = `Remove the shoe upper from the model's feet. Keep ONLY the sole of the shoe — a thin flat sole on the floor. The model's bare feet and bare ankles are standing on top of the sole, like the model is wearing a sandal that has only a sole and no upper. The toes and the top of the foot are visible. The sole stays exactly where the shoe was on the floor.

Preserve every other pixel of the image exactly: the model's identity, body, pose, stance, the placeholder shorts/underwear, the grey studio backdrop, the lighting, the contact shadow. Only the shoe upper area is removed — replaced with bare skin (feet + ankles) on top of the sole.`;

async function fetchAsBuffer(url: string): Promise<Buffer> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  // 1. Get matrix base legsBack URL for the closed sneaker × F3 cell
  const cellId = `${SHOE_ID}_${MODEL_ID}`;
  const cellSnap = await db.collection('qaShoeMatrix').doc(cellId).get();
  if (!cellSnap.exists) { console.error(`No cell ${cellId}`); process.exit(1); }
  const cell = cellSnap.data() as any;
  const closedBaseUrl = cell.images?.legsBack;
  if (!closedBaseUrl) { console.error(`No legsBack in cell ${cellId}`); process.exit(1); }
  console.log(`Closed legsBack: ${closedBaseUrl}`);

  // Download closed base
  const closedBaseBuf = await fetchAsBuffer(closedBaseUrl);
  fs.writeFileSync(path.join(OUT_DIR, 'closed_base.png'), closedBaseBuf);
  console.log(`Closed base saved: ${(closedBaseBuf.length / 1024).toFixed(0)}KB`);

  // 2. Convert closed → sole-mode via Gemini
  console.log(`\n=== Building sole-mode base via Gemini-3-pro-image-preview ===`);
  const t0 = Date.now();
  const soleResult = await generateImage({
    prompt: SOLE_CONVERSION_PROMPT,
    referenceImages: [{
      buffer: closedBaseBuf,
      mimeType: 'image/png',
      label: 'SOURCE',
    }],
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  const dtSole = ((Date.now() - t0) / 1000).toFixed(1);
  const soleBaseBuf = soleResult.imageData;
  fs.writeFileSync(path.join(OUT_DIR, 'sole_base.png'), soleBaseBuf);
  console.log(`Sole base saved in ${dtSole}s: ${(soleBaseBuf.length / 1024).toFixed(0)}KB`);

  // 3. Upload sole-mode base to GCS so Seedream (BytePlus) can fetch it
  const storage = new Storage({
    projectId: 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });
  const bucket = storage.bucket('gstar-ai-studio-assets');
  const tempPrefix = `experiments/sole-mode/${Date.now()}`;
  const soleBaseKey = `${tempPrefix}/sole_base.png`;
  await bucket.file(soleBaseKey).save(soleBaseBuf, { metadata: { contentType: 'image/png' } });
  const soleBaseUrl = `https://storage.googleapis.com/gstar-ai-studio-assets/${soleBaseKey}`;
  console.log(`Sole base uploaded to GCS: ${soleBaseUrl}`);

  // 4. For each jean, run M02 paint twice (closed vs sole)
  for (const c of CASES) {
    console.log(`\n========== ${c.name} ==========`);
    const bottomDoc = (await db.collection('wardrobe').doc(c.bottomId).get()).data() as any;
    const fitBack = bottomDoc.fitModels?.back;
    if (!fitBack) { console.error(`No fitModels.back for ${c.bottomId}`); continue; }
    console.log(`Fit-model back: ${fitBack}`);

    // Closed base run
    console.log(`\n[${c.label}-closed] generating…`);
    const t1 = Date.now();
    try {
      const closedResult = await generateSeedreamImage({
        prompt: LEAN_PROMPT,
        referenceImages: [
          { url: closedBaseUrl.split('?')[0], label: '' },
          { url: fitBack.split('?')[0], label: '' },
        ],
        aspectRatio: '1:1',
      });
      fs.writeFileSync(path.join(OUT_DIR, `closed_${c.label}.png`), closedResult.imageData);
      console.log(`[${c.label}-closed] DONE in ${((Date.now() - t1) / 1000).toFixed(1)}s — ${(closedResult.imageData.length / 1024).toFixed(0)}KB`);
    } catch (e) {
      console.error(`[${c.label}-closed] FAILED: ${(e as Error).message}`);
    }

    // Sole base run
    console.log(`[${c.label}-sole] generating…`);
    const t2 = Date.now();
    try {
      const soleResult2 = await generateSeedreamImage({
        prompt: LEAN_PROMPT,
        referenceImages: [
          { url: soleBaseUrl, label: '' },
          { url: fitBack.split('?')[0], label: '' },
        ],
        aspectRatio: '1:1',
      });
      fs.writeFileSync(path.join(OUT_DIR, `sole_${c.label}.png`), soleResult2.imageData);
      console.log(`[${c.label}-sole] DONE in ${((Date.now() - t2) / 1000).toFixed(1)}s — ${(soleResult2.imageData.length / 1024).toFixed(0)}KB`);
    } catch (e) {
      console.error(`[${c.label}-sole] FAILED: ${(e as Error).message}`);
    }
  }

  console.log(`\nAll outputs in: ${OUT_DIR}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
