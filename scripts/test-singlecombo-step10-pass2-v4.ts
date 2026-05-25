/**
 * Step 10 — pass-2 v4 A/B: Seedream + Gemini, expanded ref structure, pose preservation.
 *
 * Changes from step 9 (v3):
 *   - Ref structure expanded per Bruno's spec:
 *       M01: pass-1 + fm.front + fm.front45L + fm.front45R + flat-front + pass-1 silent anchor = 6 refs
 *       M02: pass-1 + fm.back + fm.back45L + fm.back45R + pass-1 silent anchor = 5 refs
 *   - Prompt v4: append "pose, stance, body angle, foot placement, arm position"
 *     to the IMAGE 1 preservation sentence.
 *   - Two engines per render: Seedream-4.5 + Gemini-3-pro-image-preview, same prompt + refs.
 *
 * 4 combos × 2 shirts × 2 views × 2 engines = 32 renders. ~$4.50, ~45 min.
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
import { generateImage, type ReferenceImage } from '../src/lib/vertex';

const API_BASE = 'https://gstar-ai-studio-674145888056.europe-west1.run.app';
const BUCKET = 'gstar-ai-studio-assets';
const TMP_PREFIX = 'tmp/pass2-v4-step10';
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
  const buf = Buffer.from(await r.arrayBuffer());
  const mime = r.headers.get('content-type') || 'image/jpeg';
  return { buf, mime };
}

// v4 prompt — v3 + pose preservation appended to IMAGE 1 sentence.
function buildPrompt(topName: string, topDescription: string, view: 'front' | 'back'): string {
  const descSentence = topDescription && topDescription.trim() ? ` ${topDescription.trim()}` : '';
  return `Replace the black sports bra in IMAGE 1 with the top shown in IMAGE 2 and IMAGE 3.

The top is "${topName}".${descSentence}

Render the top as the OUTER layer at the torso, hanging from the shoulders at the natural length shown in IMAGE 3 (fit-model). The bottom hem of the top sits IN FRONT OF the pants waistband from IMAGE 1 — fabric visible as a layer covering the waistband, with the pants emerging cleanly below the hem.

Take color, fabric texture, stripes / pattern, finish, and material from IMAGE 2 (flat product photo). Take silhouette, drape, sleeve shape, hem position on the body, view direction, and how the garment falls on the body from IMAGE 3 (fit-model).

Preserve every other pixel of IMAGE 1 exactly, including the model's pose, stance, body angle, foot placement, and arm position.

The output is a single-instance render of one model — the same model shown in IMAGE 1, in ${view} view, full body head-to-toe, centered horizontally.`;
}

interface RefUrls { url: string }
interface RefDownloaded { url: string; buf: Buffer; mime: string }

function buildRefUrls(pass1Url: string, topItem: any, view: 'M01' | 'M02'): string[] {
  const fm = topItem.fitModels || {};
  if (view === 'M01') {
    // pass-1 + fm.front + fm.front45L + fm.front45R + flat-front + pass-1 silent anchor
    if (!fm.front || !fm.front45Left || !fm.front45Right) throw new Error('M01 top missing fm.front/45L/45R');
    if (!topItem.flatFrontUrl) throw new Error('M01 top missing flatFrontUrl');
    return [
      pass1Url,
      fm.front,
      fm.front45Left,
      fm.front45Right,
      topItem.flatFrontUrl,
      pass1Url, // silent anchor
    ];
  } else {
    // pass-1 + fm.back + fm.back45L + fm.back45R + pass-1 silent anchor (no flat-back)
    if (!fm.back || !fm.back45Left || !fm.back45Right) throw new Error('M02 top missing fm.back/45L/45R');
    return [
      pass1Url,
      fm.back,
      fm.back45Left,
      fm.back45Right,
      pass1Url, // silent anchor
    ];
  }
}

async function downloadRefs(urls: string[]): Promise<RefDownloaded[]> {
  const out: RefDownloaded[] = [];
  for (const url of urls) {
    const { buf, mime } = await downloadUrl(url);
    out.push({ url, buf, mime });
  }
  return out;
}

async function renderSeedream(prompt: string, urls: string[]): Promise<Buffer> {
  const refs = urls.map(url => ({ url, label: '' }));
  const r = await generateSeedreamImage({ prompt, referenceImages: refs, aspectRatio: '1:1' });
  return r.imageData;
}
async function renderGemini(prompt: string, refs: RefDownloaded[]): Promise<Buffer> {
  const refImages: ReferenceImage[] = refs.map(r => ({ buffer: r.buf, mimeType: r.mime, label: '' }));
  const r = await generateImage({
    prompt,
    referenceImages: refImages,
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  return r.imageData;
}

async function main() {
  console.log('Step 10 — pass-2 v4 (expanded refs + pose preservation), Seedream + Gemini');
  console.log('4 combos × 2 shirts × 2 views × 2 engines = 32 renders\n');

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

        // Seedream
        const seedreamOut = path.join(OUT_DIR, `step10_${c.tag}_${s.tag}_${view}_seedream.png`);
        if (!fs.existsSync(seedreamOut)) {
          try {
            const t0 = Date.now();
            const buf = await renderSeedream(prompt, refUrls);
            fs.writeFileSync(seedreamOut, buf);
            console.log(`    ✓ seedream: ${((Date.now()-t0)/1000).toFixed(1)}s, ${(buf.length/1024).toFixed(0)}KB`);
          } catch (e) { console.error(`    seedream FAIL: ${(e as Error).message}`); }
        } else { console.log(`    [skip seedream] exists`); }

        // Gemini — needs buffers, so download refs
        const geminiOut = path.join(OUT_DIR, `step10_${c.tag}_${s.tag}_${view}_gemini.png`);
        if (!fs.existsSync(geminiOut)) {
          try {
            const refDl = await downloadRefs(refUrls);
            const t0 = Date.now();
            const buf = await renderGemini(prompt, refDl);
            fs.writeFileSync(geminiOut, buf);
            console.log(`    ✓ gemini:   ${((Date.now()-t0)/1000).toFixed(1)}s, ${(buf.length/1024).toFixed(0)}KB`);
          } catch (e) { console.error(`    gemini FAIL: ${(e as Error).message}`); }
        } else { console.log(`    [skip gemini] exists`); }
      }
    }
  }

  console.log(`\nDone. Renders in ${OUT_DIR}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
