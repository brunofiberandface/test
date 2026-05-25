/**
 * Step 9 — pass-2 v3 A/B: paint top onto step-8 clean pass-1 outputs.
 *
 * 4 combos (step-8 outputs) × 2 shirts × 2 views = 16 renders.
 *
 * Pass-2 v3 design (prompts/matrix/matrix-toppaint-seedream-v3.md):
 *   - 4 refs: pass-1 output + top flat-front + top fit-model (front/back) + pass-1 silent anchor
 *   - Lean prompt + per-ref scoping + positive layer-order + step-7 augmentation sentence
 *   - Pass-1 outputs uploaded to GCS so Seedream can fetch them as IMAGE 1
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

import { Storage } from '@google-cloud/storage';
import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';

const API_BASE = 'https://gstar-ai-studio-674145888056.europe-west1.run.app';
const BUCKET = 'gstar-ai-studio-assets';
const TMP_PREFIX = 'tmp/pass2-v3-step9';
const PASS1_DIR = path.join(projectRoot, 'test_outputs/singlecombo-production-path');
const OUT_DIR = path.join(projectRoot, 'test_outputs/singlecombo-pass2-v3');
fs.mkdirSync(OUT_DIR, { recursive: true });

interface Combo { tag: string; }
const COMBOS: Combo[] = [
  { tag: 'F1_white_judee' },
  { tag: 'F9_loafer_midge' },
  { tag: 'F9_loafer_bowey' },
  { tag: 'F9_loafer_roxx' },
];

interface Shirt { tag: string; id: string; }
const SHIRTS: Shirt[] = [
  { tag: 'flowy', id: 'drzaHkB6mM40uHeKWzsU' },  // D28956-E513-1603 Flowy Slim Mock T-Shirt
  { tag: 'resort', id: 'IhuKnWzd70LOj9fLbB3e' }, // D29076-D592-G459 Resort Boxy Relaxed Overshirt
];

async function fetchWardrobeAll(): Promise<any[]> {
  const r = await fetch(`${API_BASE}/api/wardrobe`);
  if (!r.ok) throw new Error(`wardrobe ${r.status}`);
  return (await r.json()).items || [];
}

let _storage: Storage | null = null;
function storage(): Storage { if (!_storage) _storage = new Storage(); return _storage; }
async function uploadBuffer(buf: Buffer, gcsKey: string): Promise<string> {
  await storage().bucket(BUCKET).file(gcsKey).save(buf, { contentType: 'image/png', resumable: false });
  return `https://storage.googleapis.com/${BUCKET}/${gcsKey}`;
}

// v3 prompt — verbatim from prompts/matrix/matrix-toppaint-seedream-v3.md
function buildV3Prompt(topName: string, topDescription: string, view: 'front' | 'back'): string {
  const descSentence = topDescription && topDescription.trim() ? ` ${topDescription.trim()}` : '';
  return `Replace the black sports bra in IMAGE 1 with the top shown in IMAGE 2 and IMAGE 3.

The top is "${topName}".${descSentence}

Render the top as the OUTER layer at the torso, hanging from the shoulders at the natural length shown in IMAGE 3 (fit-model). The bottom hem of the top sits IN FRONT OF the pants waistband from IMAGE 1 — fabric visible as a layer covering the waistband, with the pants emerging cleanly below the hem.

Take color, fabric texture, stripes / pattern, finish, and material from IMAGE 2 (flat product photo). Take silhouette, drape, sleeve shape, hem position on the body, view direction, and how the garment falls on the body from IMAGE 3 (fit-model).

Preserve every other pixel of IMAGE 1 exactly.

The output is a single-instance render of one model — the same model shown in IMAGE 1, in ${view} view, full body head-to-toe, centered horizontally.`;
}

async function renderOne(comboTag: string, shirt: Shirt, view: 'M01' | 'M02', topItem: any, pass1Url: string) {
  const viewDir: 'front' | 'back' = view === 'M01' ? 'front' : 'back';
  const fm = topItem.fitModels || {};
  const image2 = topItem.flatFrontUrl || fm.front;
  if (!image2) throw new Error('top has no flatFrontUrl and no fm.front');
  const image3 = viewDir === 'front'
    ? (fm.front || topItem.flatFrontUrl)
    : (fm.back || fm.front || topItem.flatFrontUrl);
  if (!image3) throw new Error('top has no usable fit-model ref');

  const refs = [
    { url: pass1Url, label: '' }, // IMAGE 1
    { url: image2,   label: '' }, // IMAGE 2
    { url: image3,   label: '' }, // IMAGE 3
    { url: pass1Url, label: '' }, // IMAGE 4 silent anchor
  ];
  const prompt = buildV3Prompt(
    topItem.name || 'top',
    topItem.topDescription || topItem.description || '',
    viewDir,
  );

  const outName = `step9_${comboTag}_${shirt.tag}_${view}.png`;
  const outPath = path.join(OUT_DIR, outName);
  if (fs.existsSync(outPath)) { console.log(`    [skip] ${outName}`); return; }

  const t0 = Date.now();
  const r = await generateSeedreamImage({ prompt, referenceImages: refs, aspectRatio: '1:1' });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  fs.writeFileSync(outPath, r.imageData);
  console.log(`    ✓ ${outName} (${dt}s, ${(r.imageData.length / 1024).toFixed(0)}KB)`);
}

async function main() {
  console.log('Step 9 — pass-2 v3 on step-8 clean pass-1 outputs');
  console.log('4 combos × 2 shirts × 2 views = 16 renders\n');

  const wardrobe = await fetchWardrobeAll();
  const byId = new Map(wardrobe.map((w: any) => [w.id, w]));
  const shirtItems: Record<string, any> = {};
  for (const s of SHIRTS) {
    const it = byId.get(s.id);
    if (!it) throw new Error(`shirt ${s.id} not in wardrobe`);
    shirtItems[s.tag] = it;
    console.log(`  ${s.tag}: ${it.name} (${(it as any).designNumber})`);
  }
  console.log();

  // Upload all 8 pass-1 outputs to GCS (one-time)
  const pass1Urls: Record<string, Record<'M01' | 'M02', string>> = {};
  for (const c of COMBOS) {
    pass1Urls[c.tag] = {} as Record<'M01' | 'M02', string>;
    for (const view of ['M01', 'M02'] as const) {
      const fp = path.join(PASS1_DIR, `step8_${c.tag}_${view}.png`);
      if (!fs.existsSync(fp)) throw new Error(`pass-1 ${fp} missing`);
      const buf = fs.readFileSync(fp);
      const key = `${TMP_PREFIX}/step8_${c.tag}_${view}.png`;
      const url = await uploadBuffer(buf, key);
      pass1Urls[c.tag][view] = url;
      console.log(`  uploaded: step8_${c.tag}_${view}.png → GCS`);
    }
  }
  console.log();

  // Render all 16 (4 combos × 2 shirts × 2 views)
  for (const c of COMBOS) {
    for (const s of SHIRTS) {
      console.log(`──── ${c.tag} × ${s.tag} ────`);
      for (const view of ['M01', 'M02'] as const) {
        try {
          await renderOne(c.tag, s, view, shirtItems[s.tag], pass1Urls[c.tag][view]);
        } catch (e) {
          console.error(`    FAIL ${c.tag} ${s.tag} ${view}: ${(e as Error).message}`);
        }
      }
    }
  }

  console.log(`\nDone. Renders in ${OUT_DIR}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
