/**
 * Fix #1 A/B harness — top-focus M01/M02 refs 1 → 5.
 *
 * Calls Seedream directly with the production `buildBottomPaintPromptInline`
 * (inlined here so the test is self-contained), iterating over:
 *   - 3 A/B garments: #176 Resort Boxy (F2), #181 Resort Boxy (F4), #184 Flowy Mock (F6)
 *   - 2 shot types: M01, M02
 *   - 3 seeds (re-runs, Seedream is stochastic)
 *
 * Renders OLD refs (1 ref = matrix base only — current production behaviour for
 * top-focus) and NEW refs (5 refs per the approved proposal) side by side so we
 * can A/B the same call.
 *
 * Outputs: test_outputs/topfocus-refs-v1/<jobNum>_<shot>_<old|new>_seed<n>.png
 *
 * Total: 3 garments × 2 shots × 2 variants × 3 seeds = 36 renders, ~$1.50, ~25 min.
 */
import * as fs from 'fs';
import * as path from 'path';

// ── env bootstrap (mirrors test-new-m02-pipeline.ts) ─────────────────────────
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
const OUT_DIR = path.join(projectRoot, 'test_outputs/topfocus-refs-v1');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SEEDS = 3;

interface JobSpec {
  jobNum: number;
  jobId: string;
  expectedTopName: string;   // for sanity
  expectedBottomName: string;
}

const JOBS: JobSpec[] = [
  { jobNum: 176, jobId: 'wTqVWk8Y0SFdACpKsp9w', expectedTopName: 'Resort Boxy Relaxed Overshirt', expectedBottomName: 'CONTOR 3D EXTREME LOOSE WMN' },
  { jobNum: 181, jobId: 'WB9sD7TZxkSAawE6KaKZ', expectedTopName: 'Resort Boxy Relaxed Overshirt', expectedBottomName: '(TBD)' },
  { jobNum: 184, jobId: 'c8M0QkHGNkoDynD9VCzw', expectedTopName: 'Flowy Slim Mock T-Shirt',       expectedBottomName: 'CONTOR 3D EXTREME LOOSE WMN' },
];

const SHOTS: ('M01' | 'M02')[] = ['M01', 'M02'];

// ── Inlined buildBottomPaintPromptInline (verbatim from matrix-paint.ts:99-188 ──
// Kept byte-identical so the A/B isolates the REFS change, not the PROMPT.
function buildBottomPaintPromptInline(
  shotType: 'M01' | 'M02',
  isFullBody: boolean,
  bottomName: string,
  bottomDescription: string,
  bottomSilhouette: string,
  shoeName: string,
  shoeDescription: string,
): string {
  const isBack = shotType === 'M02';
  const framing = isFullBody ? 'full body head-to-toe' : 'waist-down (legs + feet)';
  const upperBodyClause = isFullBody
    ? '\n- Upper-body placeholder (sports bra / bare chest above the waistband): preserved from IMAGE 1. A later pipeline stage repaints the top. DO NOT alter the upper body.'
    : '';
  const upperBodyForbidden = isFullBody
    ? '\n- DO NOT modify the upper-body placeholder (sports bra / bare chest) — handled by a later pipeline stage.'
    : '';
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
The block below specifies the garment's width progression (at hip, thigh, knee, ankle, hem opening), length, floor distance, and hem behaviour. RENDER EXACTLY to these specifications. Pay particular attention to width multipliers like "1.5x the hip", "3x the ankle", "extremely wide", "palazzo", "sweeping columns" — those describe the FULL silhouette and must be rendered at the FULL specified width.

DO NOT narrow the silhouette. DO NOT default to a slimmer / straighter / more conservative fit than what the spec describes. If the spec says "extreme palazzo" → render extreme palazzo, NOT regular wide-leg. If the spec says "skinny" → render skinny, NOT slim-straight. The placeholder pants in IMAGE 1 (hot pants / boxer briefs) are NOT a guide to the target garment's width — they are placeholders to be replaced.

${bottomSilhouette}

═══ FIT-MODEL REFERENCES ═══
The model wears this ${bottomName} as displayed in the ${isBack ? 'fit-model BACK photographs (IMAGE 2 + supplementary IMAGE 3 / IMAGE 4 when present)' : 'flat-front (IMAGE 2) and fit-model front (IMAGE 3 when present)'}. Use ${isBack ? 'those fit-model photos' : 'IMAGE 2 + IMAGE 3'} as the EXCLUSIVE source of truth for the garment's identity — base colour, fabric texture and finish, all ${isBack ? 'back-panel seam lines, waistband and back-yoke construction (whatever shape and style the photos show — a curved jean yoke, a flat tailored waistband, or any other), belt-loop positioning and spacing, the actual back-detail construction (patch pockets, welt pockets, flap pockets, or no pockets — render only what the photos show)' : 'front-panel seam lines, fly, rivet placement, front-pocket geometry'}, and overall silhouette shape.

${isBack ? `When multiple back-view fit-model photos are provided, render features that appear CONSISTENTLY across all of them. Features visible in only ONE photo (e.g. a sash arranged a certain way for that shoot day, hand position, hair drape) are STYLING ARTIFACTS of that pose, NOT garment construction — DO NOT render those. The trouser back is whatever is consistent across all back refs.

═══ POSE / STANCE LOCK — CRITICAL ═══
The model's pose, stance, body angle, hip rotation, foot position, shoulder line, and weight distribution come 100% from IMAGE 1 (the matrix base). IMAGE 1 shows the model facing DIRECTLY AWAY from the camera in a straight-back stance (back perpendicular to the camera axis, hips square, feet parallel). The rendered output preserves this STRAIGHT-BACK stance exactly — neither hip nor shoulder rotated, no 3/4 angle, no contrapposto.

The fit-model reference photos (IMAGE 2 straight-back, IMAGE 3 back 45° right, IMAGE 4 back 45° left) show the garment on a DIFFERENT model in DIFFERENT camera angles. Their angled stances are NOT to be copied — those are garment-construction references only. The output stance is the IMAGE 1 stance.

` : ''}═══ STRICT REQUIREMENT — NO LAYERED BOTTOMS, NO STYLING PEEKING ═══
- The ${bottomName} is the SOLE bottom garment in this render. NO SECOND PAIR OF PANTS, SHORTS, TROUSERS, or SKIRT layered behind, beneath, above, or alongside the ${bottomName}.
- NO SECOND WAISTBAND visible — only the ${bottomName}'s own waistband appears in the frame.
- NO STYLING GARMENT PEEKING OUT from above, behind, beside, or below the ${bottomName}. This includes: NO peplum / over-skirt / draped panel hanging from the waistband across the back, NO sash visible as a separate garment layer over the trousers (any wrap or tie that IS part of the ${bottomName} stays integrated into the waistband / front closure, not draped across the back as a peplum), NO contrast band, NO exposed belt loop or fabric strip from a different layer.
- The space immediately above the ${bottomName}'s waistband shows ONLY tucked top fabric (or, in this waist-down crop, bare midriff that the next pipeline stage repaints) — no other garment, no contrast band, no second waistband stacked behind.
- Apply regardless of the ${bottomName}'s material — whether denim, wool, twill, velvet, or any other fabric, the ${bottomName} is the only bottom garment present.

Do NOT invent pockets, yokes, hardware, washes, fades, layered waistbands, peplums, contrast bands, or any detail that is not present in either the fit-model photos OR the silhouette description.

═══ UNIVERSAL HEM-OVER-SHOE LAYER ORDER ═══
Whenever the hem reaches or extends past the top of the shoe:
- The pant fabric is the OUTER layer; the shoe is the INNER layer beneath it. The hem fabric drapes over and on top of the shoe, layered ABOVE the shoe upper.
- For lace-up shoes (sneakers, oxfords, derbies, brogues): laces and tongue area sit beneath the pant fabric, partially or fully covered. The pant hem cascades onto the shoe vamp. The shoe sole, toe-box, and the front-most edge of the upper remain visible below.
- For boots (ankle, chelsea, knee-high, tall): the pant fabric falls OUTSIDE the boot shaft, draping down the exterior. The boot opening contains only the leg, NEVER the pant fabric — the pant hem ends above the boot top and falls down the OUTSIDE of the boot, NOT INTO it.
- For sandals, slides, mules, open footwear: pant fabric drapes over the foot and any straps in the same OUTER-layer relationship.
- The pant hem always touches the shoe from above. No airborne gap between hem and shoe top — fabric and shoe meet wherever the silhouette places that meeting point.

The silhouette's hem-behaviour text specifies WHERE on the shoe the hem rests (covering laces, mid-vamp, ankle bone, boot shaft, etc.) and HOW the hem behaves there (clean break, soft cascade, stacking, gathering). The layer-order rule above is universal: wherever the silhouette places that meeting point, the fabric is positioned ABOVE the shoe, falling down the outside, never tucked inside, never floating airborne.

If the silhouette says the hem is shorter than the shoe top (e.g. cropped culotte + knee-high boots): the boot top is VISIBLE and the garment hem cleanly ends ABOVE it with a small gap — do NOT extend the garment fabric down into the boot, do NOT invent draping that the silhouette does not specify.

═══ WAISTBAND ═══
Sits at the same height as the placeholder waistband in IMAGE 1. Render the waistband EXACTLY as the fit-model photos show it — same height, same width, same hardware (button, snap, hook). No second waistband stacked above or below.

═══ ABSOLUTELY FORBIDDEN ═══
- DO NOT render more than one model. DO NOT render the model multiple times. DO NOT render a comparison / before-after / multi-angle layout.
- DO NOT default to JEANS unless the garment description above explicitly says "jeans" or "denim". Render the EXACT garment type described.
- DO NOT render a peplum, over-skirt, or draped panel hanging from the waistband.
- DO NOT render a second waistband, second pair of pants, or styling garment peeking out.
- DO NOT modify the footwear in any way — locked from IMAGE 1.
- DO NOT tuck the garment hem INSIDE the footwear (esp. boots). Hem always drapes over the OUTSIDE.
- DO NOT modify the model's identity, skin tone, body proportions, or pose.
- DO NOT change the background, lighting, or framing.
- DO NOT add belts, socks, accessories.
- DO NOT show the model barefoot.${upperBodyForbidden}`;
}

// ── Helpers: API fetches ─────────────────────────────────────────────────────
async function fetchJob(jobId: string) {
  const r = await fetch(`${API_BASE}/api/jobs/${jobId}`);
  if (!r.ok) throw new Error(`fetchJob(${jobId}) → ${r.status}`);
  const data = await r.json();
  return data.job || data;
}

async function fetchWardrobeItem(itemId: string) {
  // No public /api/wardrobe/[id] — use the list and filter.
  const r = await fetch(`${API_BASE}/api/wardrobe`);
  if (!r.ok) throw new Error(`fetchWardrobeItem(${itemId}) → ${r.status}`);
  const data = await r.json();
  const items = data.items || data;
  const item = items.find((i: any) => i.id === itemId);
  if (!item) throw new Error(`fetchWardrobeItem(${itemId}) → not found in list`);
  return item;
}

async function fetchMatrixCell(shoeId: string, modelId: string, view: 'fullBodyFront' | 'fullBodyBack'): Promise<string> {
  const cellId = `${shoeId}_${modelId}`;
  const r = await fetch(`${API_BASE}/api/qa/shoe-matrix/${cellId}`);
  if (!r.ok) throw new Error(`fetchMatrixCell(${cellId}) → ${r.status}`);
  const data = await r.json();
  const cell = data.cell || data;
  const url = cell.images?.[view];
  if (!url) throw new Error(`fetchMatrixCell(${cellId}) → no ${view} URL`);
  return url.split('?')[0]; // strip cache-buster
}

// ── Same `normalizeWardrobeItem` shape as the production codebase ────────────
function normalizeFitModels(item: any): { front?: string; back?: string; back45Left?: string; back45Right?: string; front45Left?: string; front45Right?: string } {
  // v2 items already have fitModels; v1 needs derivation. The 3 A/B items are
  // all v2 (Resort Boxy + Flowy Mock both have fitModels per the earlier API
  // probe), but include a defensive path anyway.
  if (item.fitModels?.front || item.fitModels?.back) return item.fitModels;
  const urls: string[] = item.fitModelUrls || [];
  if (urls.length >= 6) return { front: urls[0], front45Left: urls[1], front45Right: urls[2], back: urls[3], back45Left: urls[4], back45Right: urls[5] };
  return {};
}

// ── Ref builders ─────────────────────────────────────────────────────────────
function buildOldRefs(matrixUrl: string): Array<{ url: string; label: string }> {
  return [{ url: matrixUrl, label: '' }];
}

function buildNewRefsM01(matrixUrl: string, bottomItem: any, topItem: any): Array<{ url: string; label: string }> {
  const bottomFm = normalizeFitModels(bottomItem);
  const topFm = normalizeFitModels(topItem);
  const bottomFlat = bottomItem.flatFrontUrl;
  const topFlat = topItem.flatFrontUrl;
  if (!bottomFlat) throw new Error('M01 NEW: bottom has no flatFrontUrl');
  // Bottom: flat front + fit-model front (fallback flat).
  const bottomFitFront = bottomFm.front || bottomFlat;
  // Top: flat front + fit-model front (fallback flat). Must have at least one.
  const topFlatFinal = topFlat || topFm.front;
  const topFitFront = topFm.front || topFlat;
  if (!topFlatFinal && !topFitFront) throw new Error('M01 NEW: top has neither flat front nor fit-model front');
  return [
    { url: matrixUrl,                       label: '' }, // matrix base (Tier-2 fullBodyFront)
    { url: bottomFlat,                      label: '' }, // bottom flat front
    { url: bottomFitFront,                  label: '' }, // bottom fit-model front
    { url: topFlatFinal!,                   label: '' }, // top flat front (fallback fit-model)
    { url: topFitFront!,                    label: '' }, // top fit-model front (fallback flat)
  ];
}

function buildNewRefsM02(matrixUrl: string, bottomItem: any, topItem: any): Array<{ url: string; label: string }> {
  const bottomFm = normalizeFitModels(bottomItem);
  const topFm = normalizeFitModels(topItem);
  if (!bottomFm.back) throw new Error('M02 NEW: bottom has no fitModels.back');
  // Bottom: fit-model back primary; back45Right additional angle (fallback to back).
  const bottomBackAlt = bottomFm.back45Right || bottomFm.back45Left || bottomFm.back;
  // Top: prefer flatBack > fit-model back > flatFront > fit-model front.
  const topBackPrimary =
    topItem.flatBackUrl ||
    topFm.back ||
    topItem.flatFrontUrl ||
    topFm.front;
  const topBackSecondary =
    topFm.back ||
    topItem.flatBackUrl ||
    topFm.front ||
    topItem.flatFrontUrl;
  if (!topBackPrimary || !topBackSecondary) throw new Error('M02 NEW: top has no usable refs at all');
  return [
    { url: matrixUrl,                       label: '' }, // matrix base (Tier-2 fullBodyBack)
    { url: bottomFm.back,                   label: '' }, // bottom fit-model back
    { url: bottomBackAlt,                   label: '' }, // bottom fit-model back45 (fallback back)
    { url: topBackPrimary,                  label: '' }, // top flat back > fit-model back > fronts (last resort)
    { url: topBackSecondary,                label: '' }, // top fit-model back > flat back > fronts
  ];
}

// ── Render one variant × N seeds ─────────────────────────────────────────────
async function renderVariant(
  variant: 'old' | 'new',
  jobNum: number,
  shotType: 'M01' | 'M02',
  prompt: string,
  refs: Array<{ url: string; label: string }>,
  seeds: number,
) {
  for (let s = 1; s <= seeds; s++) {
    const outName = `${jobNum}_${shotType}_${variant}_seed${s}.png`;
    const outPath = path.join(OUT_DIR, outName);
    if (fs.existsSync(outPath)) {
      console.log(`  [skip] ${outName} already exists`);
      continue;
    }
    const t0 = Date.now();
    try {
      const result = await generateSeedreamImage({
        prompt,
        referenceImages: refs,
        aspectRatio: '1:1',
      });
      fs.writeFileSync(outPath, result.imageData);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  [done] ${outName} (${dt}s, ${(result.imageData.length / 1024).toFixed(0)}KB)`);
    } catch (e) {
      console.error(`  [FAIL] ${outName}: ${(e as Error).message}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Fix #1 A/B harness — top-focus M01/M02 refs 1 → 5\n`);
  console.log(`Output dir: ${OUT_DIR}\n`);

  for (const job of JOBS) {
    console.log(`\n══════════════════════════════════════════════════════════`);
    console.log(`Job #${job.jobNum} (${job.jobId})`);
    console.log(`══════════════════════════════════════════════════════════`);
    const jobDoc = await fetchJob(job.jobId);
    const modelId = jobDoc.modelId;
    const wardrobe = jobDoc.wardrobe || {};
    const topId = wardrobe.top?.itemId;
    const bottomId = wardrobe.bottom?.itemId;
    const shoeId = wardrobe.shoe?.itemId;
    if (!topId || !bottomId || !shoeId) {
      console.error(`  missing wardrobe IDs — skipping`);
      continue;
    }
    const [topItem, bottomItem, shoeItem] = await Promise.all([
      fetchWardrobeItem(topId),
      fetchWardrobeItem(bottomId),
      fetchWardrobeItem(shoeId),
    ]);
    console.log(`  model: ${modelId}`);
    console.log(`  top:    ${topItem.name}`);
    console.log(`  bottom: ${bottomItem.name}`);
    console.log(`  shoe:   ${shoeItem.name}`);

    const bottomName = bottomItem.name || 'bottom garment';
    const bottomDescription = bottomItem.description || bottomName;
    const shoeName = shoeItem.name || 'footwear';
    const shoeDescription = shoeItem.description || shoeName;

    for (const shotType of SHOTS) {
      const view = shotType === 'M01' ? 'fullBodyFront' : 'fullBodyBack';
      const matrixUrl = await fetchMatrixCell(shoeId, modelId, view);
      const bottomSilhouette = shotType === 'M02'
        ? (bottomItem.silhouetteBack || bottomItem.silhouetteFront || '')
        : (bottomItem.silhouetteFront || bottomItem.silhouetteBack || '');
      const prompt = buildBottomPaintPromptInline(
        shotType,
        true, // isFullBody (top-focus always uses fullBody view)
        bottomName,
        bottomDescription,
        bottomSilhouette,
        shoeName,
        shoeDescription,
      );
      const oldRefs = buildOldRefs(matrixUrl);
      const newRefs = shotType === 'M01'
        ? buildNewRefsM01(matrixUrl, bottomItem, topItem)
        : buildNewRefsM02(matrixUrl, bottomItem, topItem);

      console.log(`\n  ─── ${shotType} ─── (matrix ${view})`);
      console.log(`    OLD refs: ${oldRefs.length} | NEW refs: ${newRefs.length}`);

      console.log(`    [OLD] ${shotType} × ${SEEDS} seeds`);
      await renderVariant('old', job.jobNum, shotType, prompt, oldRefs, SEEDS);

      console.log(`    [NEW] ${shotType} × ${SEEDS} seeds`);
      await renderVariant('new', job.jobNum, shotType, prompt, newRefs, SEEDS);
    }
  }

  console.log(`\n\nDone. Renders in ${OUT_DIR}`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
