/**
 * Step 5 — generalization test of step-4 prompt across different model + shoe + 3 pants.
 *
 * Same prompt structure as step 4 (single centering bullet inside NARROW EDIT
 * preservation list, no FRAMING block). Only the wardrobe inputs change:
 *
 *   Model: F9 (was F4)
 *   Shoe : Black leather chunky platform loafer (was White leather low-top sneaker)
 *   Pants: 3 design numbers Bruno specified
 *          - D02153-6553-89 52  → Midge Straight jeans 52 (shU8uNGorWXuyMqS8Iis)
 *          - D25372-E266-H545 53 → Bowey Barrel jeans 53 (Rq3K3UQGdJmVu4W0LwgK)
 *          - D28394-D953-J059   → G-star Roxx wide jeans (NvTZVBMZuuAAMt1jaOnf)
 *
 * M01 only this round (validate the prompt before scaling to M02). 3 renders.
 */
import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';

const API_BASE = 'https://gstar-ai-studio-674145888056.europe-west1.run.app';
const OUT_DIR = path.join(projectRoot, 'test_outputs/singlecombo-f9-loafer');
fs.mkdirSync(OUT_DIR, { recursive: true });

const MODEL_ID = 'F9';
const SHOE_ID = 'u6L8UZmZw7PM0iHLmNCv'; // Black leather chunky platform loafer
const MATRIX_FB_FRONT = `https://storage.googleapis.com/gstar-ai-studio-assets/output/qa-matrix/${SHOE_ID}/${MODEL_ID}/fullBodyFront.jpg`;

const PANTS = [
  { tag: 'midge52', id: 'shU8uNGorWXuyMqS8Iis' },
  { tag: 'bowey53', id: 'Rq3K3UQGdJmVu4W0LwgK' },
  { tag: 'roxx',    id: 'NvTZVBMZuuAAMt1jaOnf' },
];

interface WardrobeItem {
  id: string;
  name: string;
  description: string;
  silhouetteFront?: string;
  silhouetteBack?: string;
  flatFrontUrl: string;
  fitModels: {
    front?: string;
    back?: string;
    front45Left?: string;
    front45Right?: string;
  };
}

async function fetchWardrobeItem(id: string): Promise<WardrobeItem> {
  const r = await fetch(`${API_BASE}/api/wardrobe`);
  if (!r.ok) throw new Error(`wardrobe fetch ${r.status}`);
  const all = (await r.json()).items || [];
  const it = all.find((x: any) => x.id === id);
  if (!it) throw new Error(`item ${id} not found`);
  return it as WardrobeItem;
}

function buildPromptM01(bottomName: string, bottomDescription: string, bottomSilhouette: string, shoeName: string, shoeDescription: string): string {
  return `Photorealistic studio reference photo, 1:1 SQUARE crop, 4K resolution, FRONT VIEW, full body head-to-toe of ONE SINGLE MODEL.

═══ SINGLE-MODEL LOCK ═══
The output frame contains EXACTLY ONE model. ONE person. ONE body. Single-instance render. NOT a comparison shot. NOT a multi-angle layout. NOT two copies of the same model side-by-side. The fit-model reference images show the garment on a body for FIT REFERENCE ONLY — they are NOT an instruction to render multiple instances.

═══ THIS IS A NARROW EDIT — IMAGE 1 IS YOUR BLUEPRINT ═══
The output is IMAGE 1 with ONLY the placeholder bottom replaced. Every pixel of IMAGE 1 EXCEPT the placeholder pants area MUST be preserved exactly:
- Model identity (visible skin, body proportions): preserved from IMAGE 1.
- Upper-body placeholder (sports bra / bare chest above the waistband): preserved from IMAGE 1. A later pipeline stage repaints the top. DO NOT alter the upper body.
- Footwear from IMAGE 1 (${shoeName} — ${shoeDescription.slice(0, 100)}…): preserved 100% as-is. Same style, colour, material, position, height. Both feet visible.
- Foot placement, stance, gap between feet, body angle: preserved from IMAGE 1.
- Background (light-grey studio sweep #D9DAD2), lighting, framing, camera angle, contact shadow: preserved from IMAGE 1.
- The model stands in the horizontal center of the frame, with equal empty backdrop on both left and right sides of the figure.

═══ TARGET GARMENT — "${bottomName}" ═══
${bottomDescription}

═══ SILHOUETTE & FIT — AUTHORITATIVE SOURCE FOR WIDTH, LENGTH, DRAPE, HEM ═══
${bottomSilhouette}

═══ STRICT REQUIREMENT — NO LAYERED BOTTOMS, NO STYLING PEEKING ═══
- The ${bottomName} is the SOLE bottom garment in this render. NO SECOND PAIR OF PANTS, SHORTS, TROUSERS, or SKIRT layered behind, beneath, above, or alongside the ${bottomName}.
- NO SECOND WAISTBAND visible — only the ${bottomName}'s own waistband appears in the frame.

Do NOT invent pockets, yokes, hardware, washes, fades, layered waistbands.

═══ UNIVERSAL HEM-OVER-SHOE LAYER ORDER ═══
Whenever the hem reaches or extends past the top of the shoe, the pant fabric is the OUTER layer; the shoe is the INNER layer beneath it.

═══ ABSOLUTELY FORBIDDEN ═══
- DO NOT render more than one model.
- DO NOT modify the footwear in any way — locked from IMAGE 1.
- DO NOT modify the model's identity, skin tone, body proportions, or pose.
- DO NOT change the background, lighting, or framing.
- DO NOT modify the upper-body placeholder (sports bra / bare chest) — handled by a later pipeline stage.`;
}

async function main() {
  console.log(`Step 5 — generalization: ${MODEL_ID} × Black leather chunky platform loafer × 3 pants, M01 only\n`);

  const shoe = await fetchWardrobeItem(SHOE_ID);
  const shoeName = shoe.name || 'footwear';
  const shoeDescription = shoe.description || shoeName;
  console.log(`Shoe : ${shoeName}`);
  console.log(`Matrix base: ${MATRIX_FB_FRONT.slice(-80)}\n`);

  for (const p of PANTS) {
    const bottom = await fetchWardrobeItem(p.id);
    const bottomName = bottom.name;
    const bottomDescription = bottom.description || bottomName;
    const bottomSilhouette = bottom.silhouetteFront || bottom.silhouetteBack || '';
    console.log(`──── ${p.tag} (${bottom.name}, ${(bottom as any).designNumber}) ────`);

    const fm = bottom.fitModels || {};
    const refs = [
      { url: MATRIX_FB_FRONT,                 label: '' },
      { url: bottom.flatFrontUrl,             label: '' },
      { url: fm.front || bottom.flatFrontUrl, label: '' },
      ...(fm.front45Left  ? [{ url: fm.front45Left,  label: '' }] : []),
      ...(fm.front45Right ? [{ url: fm.front45Right, label: '' }] : []),
    ];
    console.log(`  refs: ${refs.length}`);

    const t0 = Date.now();
    const result = await generateSeedreamImage({
      prompt: buildPromptM01(bottomName, bottomDescription, bottomSilhouette, shoeName, shoeDescription),
      referenceImages: refs,
      aspectRatio: '1:1',
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const out = path.join(OUT_DIR, `step5_${p.tag}_M01.png`);
    fs.writeFileSync(out, result.imageData);
    console.log(`  ✓ ${path.basename(out)} (${dt}s, ${(result.imageData.length / 1024).toFixed(0)}KB)`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
