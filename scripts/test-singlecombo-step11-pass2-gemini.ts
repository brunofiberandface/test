/**
 * Step 11 — pass-2 v4 GEMINI ONLY.
 *
 * Seedream consistently failed on pass-2 (step 7, 9, 10 attempts) — switching
 * to Gemini-3-pro-image-preview as the pass-2 engine. Same prompt v4, same
 * 5-/6-ref structure per Bruno's spec.
 *
 * 4 combos × 2 shirts × 2 views = 16 renders. ~$3.84, ~24 min.
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
import { generateImage, type ReferenceImage } from '../src/lib/vertex';

const API_BASE = 'https://gstar-ai-studio-674145888056.europe-west1.run.app';
const BUCKET = 'gstar-ai-studio-assets';
const TMP_PREFIX = 'tmp/pass2-v4-step11';
const PASS1_DIR = path.join(projectRoot, 'test_outputs/singlecombo-production-path');
const OUT_DIR = path.join(projectRoot, 'test_outputs/singlecombo-pass2-v4');
fs.mkdirSync(OUT_DIR, { recursive: true });

const COMBOS = [
  { tag: 'F1_white_judee' },
  { tag: 'F9_loafer_midge' },
  { tag: 'F9_loafer_bowey' },
  { tag: 'F9_loafer_roxx' },
];
const SHIRTS = [
  { tag: 'flowy',  id: 'drzaHkB6mM40uHeKWzsU' },
  { tag: 'resort', id: 'IhuKnWzd70LOj9fLbB3e' },
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
async function downloadUrl(url: string): Promise<{ buf: Buffer; mime: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${url} → ${r.status}`);
  return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') || 'image/jpeg' };
}

// v4 prompt — identical to step 10
function buildPrompt(topName: string, topDescription: string, view: 'front' | 'back'): string {
  const descSentence = topDescription && topDescription.trim() ? ` ${topDescription.trim()}` : '';
  return `Replace the black sports bra in IMAGE 1 with the top shown in IMAGE 2 and IMAGE 3.

The top is "${topName}".${descSentence}

Render the top as the OUTER layer at the torso, hanging from the shoulders at the natural length shown in IMAGE 3 (fit-model). The bottom hem of the top sits IN FRONT OF the pants waistband from IMAGE 1 — fabric visible as a layer covering the waistband, with the pants emerging cleanly below the hem.

Take color, fabric texture, stripes / pattern, finish, and material from IMAGE 2 (flat product photo). Take silhouette, drape, sleeve shape, hem position on the body, view direction, and how the garment falls on the body from IMAGE 3 (fit-model).

Preserve every other pixel of IMAGE 1 exactly, including the model's pose, stance, body angle, foot placement, and arm position.

The output is a single-instance render of one model — the same model shown in IMAGE 1, in ${view} view, full body head-to-toe, centered horizontally.`;
}

function buildRefUrls(pass1Url: string, topItem: any, view: 'M01' | 'M02'): string[] {
  const fm = topItem.fitModels || {};
  if (view === 'M01') {
    if (!fm.front || !fm.front45Left || !fm.front45Right) throw new Error('M01 top missing fm angles');
    if (!topItem.flatFrontUrl) throw new Error('M01 top missing flatFrontUrl');
    return [pass1Url, fm.front, fm.front45Left, fm.front45Right, topItem.flatFrontUrl, pass1Url];
  } else {
    if (!fm.back || !fm.back45Left || !fm.back45Right) throw new Error('M02 top missing fm back angles');
    return [pass1Url, fm.back, fm.back45Left, fm.back45Right, pass1Url];
  }
}

async function downloadRefs(urls: string[]): Promise<ReferenceImage[]> {
  const out: ReferenceImage[] = [];
  for (const url of urls) {
    const { buf, mime } = await downloadUrl(url);
    out.push({ buffer: buf, mimeType: mime, label: '' });
  }
  return out;
}

async function main() {
  console.log('Step 11 — pass-2 v4 Gemini-only');
  console.log('4 combos × 2 shirts × 2 views = 16 renders\n');

  const wardrobe = await fetchWardrobeAll();
  const byId = new Map(wardrobe.map((w: any) => [w.id, w]));
  const shirtItems: Record<string, any> = {};
  for (const s of SHIRTS) {
    const it = byId.get(s.id); if (!it) throw new Error(`shirt ${s.id} not found`);
    shirtItems[s.tag] = it;
    console.log(`  ${s.tag}: ${it.name} (${(it as any).designNumber})`);
  }
  console.log();

  // Upload all 8 pass-1 outputs to GCS once
  const pass1Urls: Record<string, Record<'M01' | 'M02', string>> = {};
  for (const c of COMBOS) {
    pass1Urls[c.tag] = {} as Record<'M01' | 'M02', string>;
    for (const view of ['M01', 'M02'] as const) {
      const fp = path.join(PASS1_DIR, `step8_${c.tag}_${view}.png`);
      if (!fs.existsSync(fp)) throw new Error(`pass-1 ${fp} missing`);
      const buf = fs.readFileSync(fp);
      const key = `${TMP_PREFIX}/step8_${c.tag}_${view}.png`;
      pass1Urls[c.tag][view] = await uploadBuffer(buf, key);
      console.log(`  uploaded: step8_${c.tag}_${view}.png`);
    }
  }
  console.log();

  for (const c of COMBOS) {
    for (const s of SHIRTS) {
      const topItem = shirtItems[s.tag];
      for (const view of ['M01', 'M02'] as const) {
        console.log(`──── ${c.tag} × ${s.tag} × ${view} ────`);
        const viewDir: 'front' | 'back' = view === 'M01' ? 'front' : 'back';
        const refUrls = buildRefUrls(pass1Urls[c.tag][view], topItem, view);
        const prompt = buildPrompt(
          topItem.name || 'top',
          topItem.topDescription || topItem.description || '',
          viewDir,
        );
        console.log(`  refs: ${refUrls.length}`);

        const outPath = path.join(OUT_DIR, `step11_${c.tag}_${s.tag}_${view}_gemini.png`);
        if (fs.existsSync(outPath)) { console.log(`    [skip] exists`); continue; }
        try {
          const refDl = await downloadRefs(refUrls);
          const t0 = Date.now();
          const r = await generateImage({
            prompt,
            referenceImages: refDl,
            aspectRatio: '1:1',
            imageSize: '4K',
            model: 'gemini-3-pro-image-preview',
          });
          fs.writeFileSync(outPath, r.imageData);
          console.log(`    ✓ ${path.basename(outPath)} (${((Date.now()-t0)/1000).toFixed(1)}s, ${(r.imageData.length/1024).toFixed(0)}KB)`);
        } catch (e) {
          console.error(`    FAIL: ${(e as Error).message}`);
        }
      }
    }
  }

  console.log(`\nDone. Renders in ${OUT_DIR}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
