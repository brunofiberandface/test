/**
 * Step 6 — production lean prompt + 5-ref structure + FULL-BODY matrix views.
 *
 * Per Bruno's correction: use fullBodyFront / fullBodyBack from the QA matrix
 * (not legsFront / legsBack). Same lean vault prompt as production. 5 refs.
 *
 * Output per combo: M01 (fullBodyFront base) + M02 (fullBodyBack base).
 *
 * 4 combos × 2 views = 8 renders, ~10 min, ~$0.32.
 *
 * Combos:
 *   1. F1 × White leather low-top sneaker × Judee D22889-D933-H087
 *   2. F9 × Black leather chunky platform loafer × Midge Straight 52 (D02153-6553-89 52)
 *   3. F9 × Black leather chunky platform loafer × Bowey Barrel 53 (D25372-E266-H545 53)
 *   4. F9 × Black leather chunky platform loafer × G-star Roxx wide (D28394-D953-J059)
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
const OUT_DIR = path.join(projectRoot, 'test_outputs/singlecombo-production-path');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Production vault prompt (matrix-m01-seedream-v3.md) + 1-sentence augmentation
// for single-instance + view-anchor + framing. Positive-only language (no anti-X
// per LEARNING #55).
function buildPrompt(view: 'front' | 'back'): string {
  return `Apply the fitmodel trousers onto the AI model with shoes. so merge the two images, but the trousers should be fully respected in form and fit. all details need to be preserved, IMPORTANT is the trousers run naturally down respecting the fitmodel lenght of the trousers. the model needs to stand equally on 2 feet, 50% on each foot, keeping the same position as the underwear model.

The output is a single-instance render of one model — the same model shown in IMAGE 1, in ${view} view, full body head-to-toe, centered horizontally.`;
}

interface Combo {
  tag: string;
  modelId: string;
  shoeId: string;
  bottomId: string;
}
const COMBOS: Combo[] = [
  { tag: 'F1_white_judee',  modelId: 'F1', shoeId: '3xKezovO6eef7SJfMioC', bottomId: '6weuQ0caKivxaSTkr4Cw' }, // Judee D22889-D933-H087
  { tag: 'F9_loafer_midge', modelId: 'F9', shoeId: 'u6L8UZmZw7PM0iHLmNCv', bottomId: 'shU8uNGorWXuyMqS8Iis' }, // Midge 52
  { tag: 'F9_loafer_bowey', modelId: 'F9', shoeId: 'u6L8UZmZw7PM0iHLmNCv', bottomId: 'Rq3K3UQGdJmVu4W0LwgK' }, // Bowey 53
  { tag: 'F9_loafer_roxx',  modelId: 'F9', shoeId: 'u6L8UZmZw7PM0iHLmNCv', bottomId: 'NvTZVBMZuuAAMt1jaOnf' }, // Roxx wide
];

async function fetchWardrobeAll(): Promise<any[]> {
  const r = await fetch(`${API_BASE}/api/wardrobe`);
  if (!r.ok) throw new Error(`wardrobe ${r.status}`);
  return (await r.json()).items || [];
}

async function fetchMatrixView(shoeId: string, modelId: string, view: 'fullBodyFront' | 'fullBodyBack'): Promise<string> {
  const r = await fetch(`${API_BASE}/api/qa/shoe-matrix/${shoeId}_${modelId}`);
  if (!r.ok) throw new Error(`matrix ${shoeId}_${modelId} ${r.status}`);
  const d = await r.json();
  const url = (d.cell || d).images?.[view];
  if (!url) throw new Error(`no ${view} for ${shoeId}_${modelId}`);
  return url.split('?')[0];
}

function buildM01Refs(matrixUrl: string, bottom: any): Array<{ url: string; label: string }> {
  const fm = bottom.fitModels || {};
  const primary = fm.front || bottom.flatFrontUrl;
  if (!primary) throw new Error('M01: no fm.front and no flatFrontUrl');
  return [
    { url: matrixUrl, label: '' },
    { url: primary,   label: '' },
    ...(fm.front45Left  ? [{ url: fm.front45Left,  label: '' }] : []),
    ...(fm.front45Right ? [{ url: fm.front45Right, label: '' }] : []),
    ...(bottom.flatFrontUrl && bottom.flatFrontUrl !== primary
      ? [{ url: bottom.flatFrontUrl, label: '' }]
      : []),
    { url: matrixUrl, label: '' }, // silent anchor — mirror M02 anti-twin pattern (matrix-paint.ts:436)
  ];
}

function buildM02Refs(matrixUrl: string, bottom: any): Array<{ url: string; label: string }> {
  // Mirror production Tier-1 M02 5-ref pattern: matrix + fm.back + back45L + back45R + matrix silent anchor.
  // NO flat-front (per LEARNING #88 / matrix-paint.ts:352-360 — front pocket leak risk).
  const fm = bottom.fitModels || {};
  if (!fm.back) throw new Error('M02: no fm.back');
  const back45L = fm.back45Left  || fm.back;
  const back45R = fm.back45Right || fm.back;
  return [
    { url: matrixUrl, label: '' },
    { url: fm.back,   label: '' },
    { url: back45L,   label: '' },
    { url: back45R,   label: '' },
    { url: matrixUrl, label: '' }, // silent anchor — proven anti-twin per Tier-1 M02 pattern
  ];
}

async function main() {
  console.log('Step 6 — production lean prompt + fullBody matrix views, 4 combos × M01+M02 = 8 renders\n');
  const wardrobe = await fetchWardrobeAll();
  const byId = new Map(wardrobe.map((w: any) => [w.id, w]));

  for (const c of COMBOS) {
    console.log(`──── ${c.tag} ────`);
    const bottom = byId.get(c.bottomId);
    if (!bottom) { console.error(`  bottom ${c.bottomId} not found, skipping`); continue; }

    // M01 (fullBodyFront)
    try {
      const matrixUrlFront = await fetchMatrixView(c.shoeId, c.modelId, 'fullBodyFront');
      const refsM01 = buildM01Refs(matrixUrlFront, bottom);
      const t0 = Date.now();
      const r = await generateSeedreamImage({ prompt: buildPrompt('front'), referenceImages: refsM01, aspectRatio: '1:1' });
      const out = path.join(OUT_DIR, `step8_${c.tag}_M01.png`);
      fs.writeFileSync(out, r.imageData);
      console.log(`  ✓ M01: ${path.basename(out)} (${((Date.now()-t0)/1000).toFixed(1)}s, ${refsM01.length} refs)`);
    } catch (e) {
      console.error(`  M01 FAIL: ${(e as Error).message}`);
    }

    // M02 (fullBodyBack)
    try {
      const matrixUrlBack = await fetchMatrixView(c.shoeId, c.modelId, 'fullBodyBack');
      const refsM02 = buildM02Refs(matrixUrlBack, bottom);
      const t0 = Date.now();
      const r = await generateSeedreamImage({ prompt: buildPrompt('back'), referenceImages: refsM02, aspectRatio: '1:1' });
      const out = path.join(OUT_DIR, `step8_${c.tag}_M02.png`);
      fs.writeFileSync(out, r.imageData);
      console.log(`  ✓ M02: ${path.basename(out)} (${((Date.now()-t0)/1000).toFixed(1)}s, ${refsM02.length} refs)`);
    } catch (e) {
      console.error(`  M02 FAIL: ${(e as Error).message}`);
    }
    console.log();
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
