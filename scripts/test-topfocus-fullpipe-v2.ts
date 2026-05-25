/**
 * Fix #1 + #2 (v2) FULL-PIPELINE A/B harness.
 *
 * Per render:
 *   Pass 1 — Seedream 5-ref call (fix #1 refs: matrix + 4 bottom refs).
 *            Produces full-body with correct pants + bra placeholder still on.
 *   [upload pass-1 buffer to GCS so pass 2 can reference it]
 *   Pass 2 — Seedream 3-ref call (v2 prompt: pass-1 URL + top flat-front + top
 *            fit-model). Paints the top untucked over the bra-region.
 *   Crop   — cropFromFullBody('upper-body'): head → mid-femur.
 *   Save   — final PNG to test_outputs/topfocus-fullpipe-v2/.
 *
 * Inputs: same 3 garments as fix #1 A/B (#176, #181, #184), both M01 + M02,
 * 3 seeds each = 18 final renders. ~$1.50, ~45 min.
 *
 * Intermediate buffers (pass-1, pass-2 pre-crop) ALSO saved so we can diagnose
 * which step introduced any failure.
 *
 * Does NOT touch matrix-paint.ts. The A/B validates the v2 prompt + ref
 * structure in isolation. Code change happens AFTER this A/B passes.
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
import { cropFromFullBody } from '../src/lib/pipeline/elbow-crop';

const API_BASE = 'https://gstar-ai-studio-674145888056.europe-west1.run.app';
const BUCKET = 'gstar-ai-studio-assets';
const TMP_PREFIX = 'tmp/topfocus-fullpipe-v2';
const OUT_DIR = path.join(projectRoot, 'test_outputs/topfocus-fullpipe-v2');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SEEDS = 3;

interface JobSpec {
  jobNum: number;
  jobId: string;
}
const JOBS: JobSpec[] = [
  { jobNum: 176, jobId: 'wTqVWk8Y0SFdACpKsp9w' },
  { jobNum: 181, jobId: 'WB9sD7TZxkSAawE6KaKZ' },
  { jobNum: 184, jobId: 'c8M0QkHGNkoDynD9VCzw' },
];
const SHOTS: ('M01' | 'M02')[] = ['M01', 'M02'];

// ── Pass 1 prompt: verbatim copy of buildBottomPaintPromptInline ────────────
function buildPass1Prompt(
  shotType: 'M01' | 'M02',
  bottomName: string,
  bottomDescription: string,
  bottomSilhouette: string,
  shoeName: string,
  shoeDescription: string,
): string {
  const isBack = shotType === 'M02';
  const framing = 'full body head-to-toe';
  const upperBodyClause = '\n- Upper-body placeholder (sports bra / bare chest above the waistband): preserved from IMAGE 1. A later pipeline stage repaints the top. DO NOT alter the upper body.';
  const upperBodyForbidden = '\n- DO NOT modify the upper-body placeholder (sports bra / bare chest) — handled by a later pipeline stage.';
  return `Photorealistic studio reference photo, 1:1 SQUARE crop, 4K resolution, ${isBack ? 'BACK' : 'FRONT'} VIEW, ${framing} of ONE SINGLE MODEL.

═══ SINGLE-MODEL LOCK ═══
The output frame contains EXACTLY ONE model. ONE person. ONE body. Single-instance render. NOT a comparison shot. NOT a multi-angle layout. NOT two copies of the same model side-by-side. The fit-model reference images show the garment on a body for FIT REFERENCE ONLY — they are NOT an instruction to render multiple instances.

═══ THIS IS A NARROW EDIT — IMAGE 1 IS YOUR BLUEPRINT ═══
The output is IMAGE 1 with ONLY the placeholder bottom replaced. Every pixel of IMAGE 1 EXCEPT the placeholder pants area MUST be preserved exactly:
- Model identity (visible skin, body proportions): preserved from IMAGE 1.${upperBodyClause}
- Footwear from IMAGE 1 (${shoeName} — ${shoeDescription.slice(0, 100)}…): preserved 100% as-is. Same style, colour, material, position, height. Both feet visible.
- Foot placement, stance, gap between feet, body angle: preserved from IMAGE 1.
- Background (light-grey studio sweep #D9DAD2), lighting, framing, camera angle, contact shadow: preserved from IMAGE 1.

═══ TARGET GARMENT — "${bottomName}" ═══
${bottomDescription}

═══ SILHOUETTE & FIT — AUTHORITATIVE SOURCE FOR WIDTH, LENGTH, DRAPE, HEM ═══
The block below specifies the garment's width progression (at hip, thigh, knee, ankle, hem opening), length, floor distance, and hem behaviour. RENDER EXACTLY to these specifications.

${bottomSilhouette}

═══ STRICT REQUIREMENT — NO LAYERED BOTTOMS, NO STYLING PEEKING ═══
- The ${bottomName} is the SOLE bottom garment in this render. NO SECOND PAIR OF PANTS, SHORTS, TROUSERS, or SKIRT layered behind, beneath, above, or alongside the ${bottomName}.
- NO SECOND WAISTBAND visible — only the ${bottomName}'s own waistband appears in the frame.

Do NOT invent pockets, yokes, hardware, washes, fades, layered waistbands.

═══ UNIVERSAL HEM-OVER-SHOE LAYER ORDER ═══
Whenever the hem reaches or extends past the top of the shoe, the pant fabric is the OUTER layer; the shoe is the INNER layer beneath it.

═══ ABSOLUTELY FORBIDDEN ═══
- DO NOT render more than one model.
- DO NOT default to JEANS unless the garment description above explicitly says "jeans" or "denim".
- DO NOT modify the footwear in any way — locked from IMAGE 1.
- DO NOT modify the model's identity, skin tone, body proportions, or pose.
- DO NOT change the background, lighting, or framing.${upperBodyForbidden}`;
}

// ── Pass 2 prompt: v2, from prompts/matrix/matrix-toppaint-seedream-v2.md ────
function buildPass2Prompt(topName: string, topDescription: string): string {
  // Null-coalesce: if topDescription missing, drop the second sentence entirely.
  const descSentence = topDescription && topDescription.trim() ? ` ${topDescription.trim()}` : '';
  return `Replace the black sports bra in IMAGE 1 with the top shown in IMAGE 2 and IMAGE 3.

The top is "${topName}".${descSentence}

Render the top as the OUTER layer at the torso, hanging from the shoulders at the natural length shown in IMAGE 3 (fit-model). The bottom hem of the top sits IN FRONT OF the pants waistband from IMAGE 1 — fabric visible as a layer covering the waistband, with the pants emerging cleanly below the hem.

Take color, fabric texture, stripes / pattern, finish, and material from IMAGE 2 (flat product photo). Take silhouette, drape, sleeve shape, hem position on the body, view direction (front or back), and how the garment falls on the body from IMAGE 3 (fit-model).

Preserve every other pixel of IMAGE 1 exactly. The only change is the bra-and-bare-torso region becoming the top.

Render exactly one model in the frame. Single instance. No comparison layout, no side-by-side, no before-after.`;
}

// ── API + GCS helpers ───────────────────────────────────────────────────────
async function fetchJob(jobId: string) {
  const r = await fetch(`${API_BASE}/api/jobs/${jobId}`);
  if (!r.ok) throw new Error(`fetchJob ${r.status}`);
  const d = await r.json();
  return d.job || d;
}
async function fetchWardrobeAll(): Promise<any[]> {
  const r = await fetch(`${API_BASE}/api/wardrobe`);
  if (!r.ok) throw new Error(`fetchWardrobe ${r.status}`);
  return (await r.json()).items || [];
}
async function fetchMatrixCell(shoeId: string, modelId: string, view: 'fullBodyFront' | 'fullBodyBack'): Promise<string> {
  const r = await fetch(`${API_BASE}/api/qa/shoe-matrix/${shoeId}_${modelId}`);
  if (!r.ok) throw new Error(`matrix cell ${shoeId}_${modelId} ${r.status}`);
  const d = await r.json();
  const url = (d.cell || d).images?.[view];
  if (!url) throw new Error(`matrix cell ${shoeId}_${modelId}: no ${view}`);
  return url.split('?')[0];
}

let _storage: Storage | null = null;
function storage(): Storage {
  if (!_storage) _storage = new Storage();
  return _storage;
}
async function uploadBufferToGcs(buf: Buffer, gcsKey: string): Promise<string> {
  const file = storage().bucket(BUCKET).file(gcsKey);
  await file.save(buf, { contentType: 'image/png', resumable: false });
  return `https://storage.googleapis.com/${BUCKET}/${gcsKey}`;
}

function normalizeFm(item: any) {
  return item.fitModels?.front || item.fitModels?.back ? item.fitModels : {};
}

function buildPass1Refs(matrixUrl: string, bottomItem: any, shotType: 'M01' | 'M02'): Array<{ url: string; label: string }> {
  const fm = normalizeFm(bottomItem);
  if (shotType === 'M02') {
    // Mirror matrix-paint M02 bottom-focus FALLBACK structure (Tier-1 missing
    // for these test models). 2 refs: matrix base + fit-model.back. Adequate
    // for testing pass-1 ref change; not the same as Tier-1 5-ref path.
    if (!fm.back) throw new Error('M02 pass-1: bottom has no fitModels.back');
    return [
      { url: matrixUrl, label: '' },
      { url: fm.back, label: '' },
    ];
  }
  // M01: matrix + bottom flat front + fit-model.front + 2 angle refs (filter empties)
  if (!bottomItem.flatFrontUrl) throw new Error('M01 pass-1: bottom has no flatFrontUrl');
  const primary = fm.front || bottomItem.flatFrontUrl;
  const angles = [fm.front45Left, fm.front45Right].filter((u: any) => !!u);
  return [
    { url: matrixUrl, label: '' },
    { url: primary, label: '' },
    ...angles.map((u: string) => ({ url: u, label: '' })),
    ...(bottomItem.flatFrontUrl && bottomItem.flatFrontUrl !== primary ? [{ url: bottomItem.flatFrontUrl, label: '' }] : []),
  ];
}

function buildPass2Refs(pass1Url: string, topItem: any, shotType: 'M01' | 'M02'): Array<{ url: string; label: string }> {
  const fm = normalizeFm(topItem);
  // IMAGE 2 = top flat-front for BOTH shots (color/texture is view-agnostic).
  // Fallback if no flat-front: fm.front.
  const image2 = topItem.flatFrontUrl || fm.front;
  if (!image2) throw new Error(`pass-2: top has no flatFrontUrl and no fm.front`);
  // IMAGE 3 = fit-model in the shot's view. M01 → fm.front, M02 → fm.back.
  const image3 = shotType === 'M01' ? (fm.front || topItem.flatFrontUrl) : (fm.back || fm.front || topItem.flatFrontUrl);
  if (!image3) throw new Error(`pass-2: top has no usable fit-model for ${shotType}`);
  return [
    { url: pass1Url, label: '' },
    { url: image2,   label: '' },
    { url: image3,   label: '' },
  ];
}

// ── Per-render full pipeline ────────────────────────────────────────────────
async function runOne(job: JobSpec, shotType: 'M01' | 'M02', seedIdx: number, ctx: {
  modelId: string;
  bottomItem: any;
  topItem: any;
  shoeItem: any;
}) {
  const outBase = `${job.jobNum}_${shotType}_seed${seedIdx}`;
  const finalPath = path.join(OUT_DIR, `${outBase}_final.png`);
  if (fs.existsSync(finalPath)) {
    console.log(`    [skip] ${outBase}_final.png exists`);
    return;
  }

  const view = shotType === 'M01' ? 'fullBodyFront' : 'fullBodyBack';
  const matrixUrl = await fetchMatrixCell(ctx.shoeItem.id, ctx.modelId, view);

  // ── PASS 1 ──
  const pass1Prompt = buildPass1Prompt(
    shotType,
    ctx.bottomItem.name || 'bottom',
    ctx.bottomItem.description || ctx.bottomItem.name || 'bottom',
    shotType === 'M02'
      ? (ctx.bottomItem.silhouetteBack || ctx.bottomItem.silhouetteFront || '')
      : (ctx.bottomItem.silhouetteFront || ctx.bottomItem.silhouetteBack || ''),
    ctx.shoeItem.name || 'footwear',
    ctx.shoeItem.description || ctx.shoeItem.name || 'footwear',
  );
  const pass1Refs = buildPass1Refs(matrixUrl, ctx.bottomItem, shotType);

  const t1 = Date.now();
  console.log(`    [pass 1] ${outBase} ${pass1Refs.length} refs…`);
  const p1 = await generateSeedreamImage({ prompt: pass1Prompt, referenceImages: pass1Refs, aspectRatio: '1:1' });
  console.log(`      → ${((Date.now() - t1) / 1000).toFixed(1)}s, ${(p1.imageData.length / 1024).toFixed(0)}KB`);
  fs.writeFileSync(path.join(OUT_DIR, `${outBase}_pass1.png`), p1.imageData);

  // ── upload pass-1 to GCS so pass 2 can ref it ──
  const gcsKey = `${TMP_PREFIX}/${outBase}_pass1.png`;
  const pass1Url = await uploadBufferToGcs(p1.imageData, gcsKey);

  // ── PASS 2 ──
  // Use cleaned topDescription (null-coalesced in buildPass2Prompt).
  const topName = ctx.topItem.name || 'top';
  const topDescription = ctx.topItem.topDescription || ctx.topItem.description || '';
  const pass2Prompt = buildPass2Prompt(topName, topDescription);
  const pass2Refs = buildPass2Refs(pass1Url, ctx.topItem, shotType);

  const t2 = Date.now();
  console.log(`    [pass 2] ${outBase} ${pass2Refs.length} refs…`);
  const p2 = await generateSeedreamImage({ prompt: pass2Prompt, referenceImages: pass2Refs, aspectRatio: '1:1' });
  console.log(`      → ${((Date.now() - t2) / 1000).toFixed(1)}s, ${(p2.imageData.length / 1024).toFixed(0)}KB`);
  fs.writeFileSync(path.join(OUT_DIR, `${outBase}_pass2.png`), p2.imageData);

  // ── CROP upper-body ──
  const t3 = Date.now();
  console.log(`    [crop] ${outBase}…`);
  const cropped = await cropFromFullBody(p2.imageData, 'upper-body');
  console.log(`      → ${cropped.width}×${cropped.height}, ${((Date.now() - t3) / 1000).toFixed(1)}s`);
  fs.writeFileSync(finalPath, cropped.imageData);
  console.log(`    ✓ ${outBase}_final.png`);
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Fix #1+#2 v2 FULL-PIPELINE A/B — 3 jobs × 2 shots × ${SEEDS} seeds = ${3 * 2 * SEEDS} renders\n`);

  const wardrobe = await fetchWardrobeAll();
  const byId = new Map(wardrobe.map((w: any) => [w.id, w]));

  for (const job of JOBS) {
    console.log(`\n══════ Job #${job.jobNum} (${job.jobId}) ══════`);
    const jobDoc = await fetchJob(job.jobId);
    const modelId = jobDoc.modelId;
    const w = jobDoc.wardrobe || {};
    const topItem = byId.get(w.top?.itemId);
    const bottomItem = byId.get(w.bottom?.itemId);
    const shoeItem = byId.get(w.shoe?.itemId);
    if (!topItem || !bottomItem || !shoeItem) { console.error(`  missing wardrobe items`); continue; }
    console.log(`  model: ${modelId} | top: ${topItem.name} | bottom: ${bottomItem.name} | shoe: ${shoeItem.name}`);
    console.log(`  topDescription (first 80): ${(topItem.topDescription || topItem.description || '').slice(0, 80)}…`);

    for (const shotType of SHOTS) {
      console.log(`\n  ─── ${shotType} ───`);
      for (let s = 1; s <= SEEDS; s++) {
        try {
          await runOne(job, shotType, s, { modelId, bottomItem, topItem, shoeItem });
        } catch (e) {
          console.error(`    [FAIL] ${job.jobNum}_${shotType}_seed${s}: ${(e as Error).message}`);
        }
      }
    }
  }
  console.log(`\nDone. Renders in ${OUT_DIR}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
