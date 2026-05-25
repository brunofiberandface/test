/**
 * Step 12 — Gemini pass-2 v4 follow-up:
 *   (a) Complete the 2 missing renders: F9 × roxx × resort × {M01, M02}
 *   (b) Multi-seed (3 additional seeds each) on the 3 problematic combos from step 11:
 *       - F9 × midge × resort × M01 (was head-cropped)
 *       - F9 × bowey × resort × M01 (was shirt-unbuttoned)
 *       - F9 × bowey × resort × M02 (was head-cropped)
 *
 * Total: 2 + (3 × 3) = 11 renders. ~$2.64, ~17 min.
 * Goal: determine whether the problems are stochastic (variance) or structural (prompt/refs).
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
const TMP_PREFIX = 'tmp/pass2-v4-step12';
const PASS1_DIR = path.join(projectRoot, 'test_outputs/singlecombo-production-path');
const OUT_DIR = path.join(projectRoot, 'test_outputs/singlecombo-pass2-v4');

const SHIRTS_BY_TAG: Record<string, string> = {
  flowy:  'drzaHkB6mM40uHeKWzsU',
  resort: 'IhuKnWzd70LOj9fLbB3e',
};

// Test jobs: (a) complete missing + (b) multi-seed problematic
interface Job { combo: string; shirt: string; view: 'M01' | 'M02'; seeds: number[]; }
const JOBS: Job[] = [
  // (a) complete the 2 missing F9 × roxx × resort renders
  { combo: 'F9_loafer_roxx',  shirt: 'resort', view: 'M01', seeds: [1] },
  { combo: 'F9_loafer_roxx',  shirt: 'resort', view: 'M02', seeds: [1] },
  // (b) multi-seed problematic step-11 cases (3 more seeds each)
  { combo: 'F9_loafer_midge', shirt: 'resort', view: 'M01', seeds: [2, 3, 4] },
  { combo: 'F9_loafer_bowey', shirt: 'resort', view: 'M01', seeds: [2, 3, 4] },
  { combo: 'F9_loafer_bowey', shirt: 'resort', view: 'M02', seeds: [2, 3, 4] },
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
    return [pass1Url, fm.front, fm.front45Left, fm.front45Right, topItem.flatFrontUrl, pass1Url];
  } else {
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
  console.log('Step 12 — Gemini pass-2 v4 follow-up\n');
  const wardrobe = await fetchWardrobeAll();
  const byId = new Map(wardrobe.map((w: any) => [w.id, w]));

  // Upload pass-1 outputs once per combo (cached across jobs)
  const pass1UrlCache: Map<string, string> = new Map();
  async function getPass1Url(combo: string, view: 'M01' | 'M02'): Promise<string> {
    const key = `${combo}_${view}`;
    if (pass1UrlCache.has(key)) return pass1UrlCache.get(key)!;
    const fp = path.join(PASS1_DIR, `step8_${combo}_${view}.png`);
    if (!fs.existsSync(fp)) throw new Error(`pass-1 ${fp} missing`);
    const buf = fs.readFileSync(fp);
    const gcsKey = `${TMP_PREFIX}/step8_${combo}_${view}.png`;
    const url = await uploadBuffer(buf, gcsKey);
    pass1UrlCache.set(key, url);
    console.log(`  uploaded: step8_${combo}_${view}.png`);
    return url;
  }

  // Pre-cache pass-1 uploads for all jobs
  const uniquePass1: Set<string> = new Set();
  JOBS.forEach(j => uniquePass1.add(`${j.combo}|${j.view}`));
  for (const k of uniquePass1) {
    const [combo, view] = k.split('|') as [string, 'M01' | 'M02'];
    await getPass1Url(combo, view);
  }
  console.log();

  // Pre-cache top ref downloads (per shirt × view = 4 unique sets)
  const refDlCache: Map<string, ReferenceImage[]> = new Map();
  async function getRefsForJob(job: Job, seedIdx: number): Promise<ReferenceImage[]> {
    const pass1Url = await getPass1Url(job.combo, job.view);
    const topItem = byId.get(SHIRTS_BY_TAG[job.shirt]);
    if (!topItem) throw new Error(`shirt ${job.shirt} not in wardrobe`);
    const urls = buildRefUrls(pass1Url, topItem, job.view);
    // For Gemini we need buffers — cache by combo+shirt+view (same urls every seed)
    const cacheKey = `${job.combo}|${job.shirt}|${job.view}`;
    if (refDlCache.has(cacheKey)) return refDlCache.get(cacheKey)!;
    const dl = await downloadRefs(urls);
    refDlCache.set(cacheKey, dl);
    return dl;
  }

  for (const job of JOBS) {
    const topItem = byId.get(SHIRTS_BY_TAG[job.shirt]);
    const viewDir: 'front' | 'back' = job.view === 'M01' ? 'front' : 'back';
    const prompt = buildPrompt(
      topItem.name || 'top',
      topItem.topDescription || topItem.description || '',
      viewDir,
    );

    for (const seedIdx of job.seeds) {
      const outName = `step12_${job.combo}_${job.shirt}_${job.view}_gemini_seed${seedIdx}.png`;
      const outPath = path.join(OUT_DIR, outName);
      if (fs.existsSync(outPath)) { console.log(`[skip] ${outName}`); continue; }

      console.log(`──── ${job.combo} × ${job.shirt} × ${job.view} seed${seedIdx} ────`);
      try {
        const refs = await getRefsForJob(job, seedIdx);
        const t0 = Date.now();
        const r = await generateImage({
          prompt,
          referenceImages: refs,
          aspectRatio: '1:1',
          imageSize: '4K',
          model: 'gemini-3-pro-image-preview',
        });
        fs.writeFileSync(outPath, r.imageData);
        console.log(`  ✓ ${outName} (${((Date.now()-t0)/1000).toFixed(1)}s, ${(r.imageData.length/1024).toFixed(0)}KB)`);
      } catch (e) {
        console.error(`  FAIL: ${(e as Error).message}`);
      }
    }
  }

  console.log(`\nDone. Renders in ${OUT_DIR}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
