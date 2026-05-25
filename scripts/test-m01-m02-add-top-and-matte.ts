/**
 * Step 3-5 of native M01/M02: take the Step 2 outputs (waist-down with jeans
 * + bare midriff at top of frame) and apply the rest of the production
 * pipeline:
 *   Step 3 — Gemini tee-edit (waist-down variant): paint the top hem sliver
 *            tucked into the jeans waistband, preserving everything below.
 *   Step 4 — subject-matte Cloud Run Job: rembg matte + procedural shadow,
 *            composite onto pure-white + brand-grey backdrops.
 *   Step 5 — Gemini grounding-shadow regen (runs inside produceBackdropVariants).
 *
 * Reuses existing Step 2 outputs from test_outputs/3-jeans-comparison/<id>/.
 * Does NOT re-run Step 1 or Step 2.
 *
 * Usage:
 *   npx tsx scripts/test-m01-m02-add-top-and-matte.ts <topId> <itemId1> [<itemId2> ...]
 *
 * topId is the wardrobe ID of the top to tuck. For tests, use:
 *   ciMAoyYe3A936GSU2ItN  (Grey melange small fit t-shirt — j7RnJwg job's top)
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
import { generateImage, type ReferenceImage } from '../src/lib/vertex';
import { produceBackdropVariants } from '../src/lib/subject-matte';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: npx tsx scripts/test-m01-m02-add-top-and-matte.ts <topId> <itemId1> [<itemId2> ...]');
  process.exit(1);
}
const topId = args[0];
const itemIds = args.slice(1);

const ROOT = path.join(projectRoot, 'test_outputs', '3-jeans-comparison');

interface WardrobeItemLike {
  name?: string;
  flatFrontUrl?: string;
  flatBackUrl?: string;
  fitModels?: Record<string, string>;
  topDescription?: string;
  description?: string;
}

async function fetchBuf(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  return { buffer: Buffer.from(await r.arrayBuffer()), mimeType: r.headers.get('content-type') || 'image/jpeg' };
}

/**
 * Custom waist-down tee-edit: paint the top hem sliver tucked into the jeans
 * waistband at the top of the frame. Same shape as the existing M05 tee-edit
 * but with M01/M02 framing language (bilateral pose, square 1:1 crop, NOT a
 * tight low-angle close-up like M05).
 */
async function applyWaistDownTeeEdit(
  sourceImage: Buffer,
  topItem: WardrobeItemLike,
  view: 'front' | 'back',
): Promise<Buffer> {
  const topDesc = topItem.topDescription || topItem.description || topItem.name || 'simple top';
  const topFlatUrl = view === 'front'
    ? (topItem.flatFrontUrl || topItem.flatBackUrl)
    : (topItem.flatBackUrl || topItem.flatFrontUrl);
  if (!topFlatUrl) throw new Error(`No top flat for view=${view}`);

  const refs: ReferenceImage[] = [
    {
      buffer: sourceImage,
      mimeType: 'image/png',
      label: `IMAGE 1 — SOURCE IMAGE (the image you are editing). 1:1 square waist-down ${view} view crop of a fashion model. Currently shows: jeans waistband at top portion of frame, BARE MIDRIFF skin visible above the waistband (between waistband and top edge of frame), hands hanging at sides visible at top edge, jeans below waistband, shoes at bottom.`,
    },
    {
      buffer: (await fetchBuf(topFlatUrl)).buffer,
      mimeType: 'image/jpeg',
      label: `IMAGE 2 — TOP FLAT (${view.toUpperCase()}) — the top garment. Match this top's color, fabric, fit, and texture for the sliver visible above the jeans waistband.`,
    },
  ];

  const PROMPT = `Edit IMAGE 1 (a 1:1 square waist-down ${view.toUpperCase()} view of a model in jeans + shoes). Make exactly ONE change: replace the BARE MIDRIFF strip visible above the jeans waistband with the BOTTOM HEM SLIVER of the top tucked into the waistband.

═══ ABSOLUTELY CRITICAL: PRESERVE EVERYTHING BELOW THE WAISTBAND ═══
- DO NOT reframe, DO NOT zoom, DO NOT change the camera angle.
- DO NOT add head, shoulders, neckline, sleeves, or face.
- DO NOT change the jeans, jeans waistband, hardware, color, wash, hem.
- DO NOT change the model's skin tone, body shape, or proportions.
- DO NOT change the shoes at the bottom of the frame.
- DO NOT change the hands at the top edge (hanging at sides).
- DO NOT change the studio backdrop or lighting.
- Everything BELOW the visible waistband stays byte-equivalent to IMAGE 1.

═══ THE ONLY CHANGE ═══
The area above the jeans waistband (currently showing bare midriff skin) becomes the bottom hem of the TUCKED TOP shown in IMAGE 2:

Top description: ${topDesc}

The top is fully tucked INTO the jeans — the bottom hem of the top disappears UNDER the denim waistband. The waistband sits ON TOP of the top fabric. From this waist-down crop, only the BOTTOM 8-20% of the top is visible (covering the midriff region from the top edge of the frame down to the jeans waistband). NO full top, NO shoulders, NO arms, NO neckline, NO head visible.

The visible portion of the top has the EXACT color, fabric, and texture shown in IMAGE 2 (TOP FLAT). The model's hands (hanging at the sides, visible at the top edge near the waistband) stay in place — only the bare-midriff region between the hands changes from skin to top fabric.

═══ WHAT NOT TO DO ═══
- DO NOT render the full top with shoulders / arms / head — the camera is waist-down only.
- DO NOT reframe to chest-height or full-body — keep the waist-down 1:1 crop.
- DO NOT show the bottom hem of the top hanging OVER the waistband — it is tucked UNDER (waistband sits on top of fabric).
- DO NOT change anything below the waistband line — the jeans + shoes stay byte-equivalent.

ONLY the bare-midriff slice at the TOP of IMAGE 1 becomes a slice of top fabric. Everything else preserved.`;

  const result = await generateImage({
    prompt: PROMPT,
    referenceImages: refs,
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  return result.imageData;
}

async function processItem(db: Firestore, topItem: WardrobeItemLike, itemId: string): Promise<void> {
  console.log(`\n════════ ${itemId} ════════`);
  const dir = path.join(ROOT, itemId);
  if (!fs.existsSync(dir)) throw new Error(`Missing item dir: ${dir}`);

  const m01Step2 = path.join(dir, 'm01_generated.png');
  const m02Step2 = path.join(dir, 'm02_generated.png');
  if (!fs.existsSync(m01Step2) || !fs.existsSync(m02Step2)) throw new Error(`Missing Step 2 outputs for ${itemId}`);

  // ── Step 3: waist-down tee-edit (paint top sliver) ────────────────────────
  console.log('  Step 3: tee-edit (paint top sliver tucked into waistband)…');
  const t3 = Date.now();
  const [m01TeeBuf, m02TeeBuf] = await Promise.all([
    applyWaistDownTeeEdit(fs.readFileSync(m01Step2), topItem, 'front'),
    applyWaistDownTeeEdit(fs.readFileSync(m02Step2), topItem, 'back'),
  ]);
  fs.writeFileSync(path.join(dir, 'm01_step3_tee.png'), m01TeeBuf);
  fs.writeFileSync(path.join(dir, 'm02_step3_tee.png'), m02TeeBuf);
  console.log(`  ✓ Step 3 done in ${((Date.now() - t3) / 1000).toFixed(1)}s`);

  // ── Step 4: subject-matte + procedural shadow + Gemini grounding-shadow ──
  console.log('  Step 4-5: subject-matte + grounding-shadow (front + back)…');
  const t4 = Date.now();
  const [m01Variants, m02Variants] = await Promise.all([
    produceBackdropVariants(m01TeeBuf),
    produceBackdropVariants(m02TeeBuf),
  ]);
  if (m01Variants) {
    fs.writeFileSync(path.join(dir, 'm01_final_grey.png'), m01Variants.greyBuffer);
    fs.writeFileSync(path.join(dir, 'm01_final_white.png'), m01Variants.whiteBuffer);
  } else {
    console.warn('  ⚠ m01 produceBackdropVariants returned null');
  }
  if (m02Variants) {
    fs.writeFileSync(path.join(dir, 'm02_final_grey.png'), m02Variants.greyBuffer);
    fs.writeFileSync(path.join(dir, 'm02_final_white.png'), m02Variants.whiteBuffer);
  } else {
    console.warn('  ⚠ m02 produceBackdropVariants returned null');
  }
  console.log(`  ✓ Step 4-5 done in ${((Date.now() - t4) / 1000).toFixed(1)}s`);

  console.log(`  ✓ ${itemId} complete → ${dir}`);
}

async function main() {
  const db = new Firestore();

  // Pull top item
  const topSnap = await db.collection('wardrobe').doc(topId).get();
  if (!topSnap.exists) throw new Error(`Top ${topId} not found`);
  const topItem = topSnap.data() as WardrobeItemLike;
  console.log(`Top: ${topItem.name}`);
  console.log(`  description: "${(topItem.topDescription || topItem.description || '').slice(0, 80)}…"`);
  console.log(`  flat front: ${topItem.flatFrontUrl ? '✓' : '✗'}`);

  // Process all items in parallel
  await Promise.all(itemIds.map(id => processItem(db, topItem, id)));

  console.log(`\n════════ ALL DONE ════════`);
  console.log(`Per item dir contents:`);
  console.log(`  fit_model_front.jpg / fit_model_back.jpg   — wardrobe refs`);
  console.log(`  step1_front.png / step1_back.png           — Step 1: Gemini base (hot pants)`);
  console.log(`  m01_generated.png / m02_generated.png       — Step 2: Seedream jeans painted`);
  console.log(`  m01_step3_tee.png / m02_step3_tee.png       — Step 3: top sliver tucked`);
  console.log(`  m01_final_grey.png / m02_final_grey.png     — Step 4-5: matte + shadow (grey)`);
  console.log(`  m01_final_white.png / m02_final_white.png   — Step 4-5: matte + shadow (white)`);
}

main().catch(e => { console.error(e); process.exit(1); });
