/**
 * Step 1 — single-combo controlled test:
 *   F4 × Judee Low Waist Loose Jeans (D22889-D933-H087) × White leather low-top sneaker
 *
 * Pass 1 only. No top paint, no crop. The goal is to see whether the Seedream
 * paint step with the production 5-ref bottom-focus structure (matrix +
 * bottom flat + 3 fit-model fronts) actually renders the SPECIFIC garment
 * (Judee grey-wash loose jeans), not a random "wide-leg jean" from prior.
 *
 * One render (M01 view). Inspect, then iterate before scaling up.
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

const OUT_DIR = path.join(projectRoot, 'test_outputs/singlecombo-judee-f4-white');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Static URLs for this combo ──
const MATRIX_F4_WHITE_FBFRONT = 'https://storage.googleapis.com/gstar-ai-studio-assets/output/qa-matrix/3xKezovO6eef7SJfMioC/F4/fullBodyFront.jpg';
const JUDEE_FLAT_FRONT  = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/flat_front.jpg';
const JUDEE_FM_FRONT    = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/fitmodel_00.jpg';
const JUDEE_FM_FRONT45L = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/fitmodel_01.jpg';
const JUDEE_FM_FRONT45R = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/fitmodel_05.jpg';

// ── Strings from the live wardrobe doc (pulled directly so they're byte-true) ──
const BOTTOM_NAME = 'Judee Low Waist Loose Jeans';
const BOTTOM_DESCRIPTION = `Loose fit, low waist. Straight leg fitting loosely from hip to hem. Longer length. Rivet reinforced inset pockets, coin pocket positioned towards the inside. Zip fly. Rigid (non-stretch) denim, 13 oz weight, 3x1 right hand twill. Color: grey wash — a heathered charcoal grey with subtle vertical streaks and lighter fade highlights.`;
const BOTTOM_SILHOUETTE = `## Detailed Garment Analysis: Judee Low Waist Loose Jeans

**FIT CATEGORY:** This is a loose fit, low-waist jean with a straight-to-wide leg silhouette. The fit is decidedly relaxed and roomy throughout, sitting low on the hip with a noticeably dropped waistband that hits well below the natural waist. The leg opening is wider than typical straight-leg jeans, creating a soft, fluid line from hip through the hem.

**WIDTH PROGRESSION:**
- Waist: low-rise, sits at upper hip bone. Waistband ~3-4cm tall, flat.
- Hip: relaxed, ~1.15-1.2× natural hip measurement, no body-hugging
- Thigh: loose drape, ~1.25× the hip width — no taper from hip
- Knee: maintains width — straight leg with no break
- Ankle / hem opening: ~1.1× the knee width — a slight outward widening, soft-flare adjacent
- Hem: clean, raw or topstitched finish, ~22-25cm hem opening (women's standard)

**LENGTH:** Floor-length on bare feet (per fit-model photo). On a shod model the hem cascades softly over the shoe upper, breaking into a small stacked fold above the sneaker collar.`;
const SHOE_NAME = 'White leather low-top sneaker';
const SHOE_DESCRIPTION = 'White leather low-top sneaker with clean minimal design, flat rubber sole, and white laces.';

// ── Pass-1 prompt: verbatim copy of production buildBottomPaintPromptInline ─
function buildPass1Prompt(): string {
  const isBack = false;
  const framing = 'full body head-to-toe';
  const upperBodyClause = '\n- Upper-body placeholder (sports bra / bare chest above the waistband): preserved from IMAGE 1. A later pipeline stage repaints the top. DO NOT alter the upper body.';
  const upperBodyForbidden = '\n- DO NOT modify the upper-body placeholder (sports bra / bare chest) — handled by a later pipeline stage.';
  return `Photorealistic studio reference photo, 1:1 SQUARE crop, 4K resolution, ${isBack ? 'BACK' : 'FRONT'} VIEW, ${framing} of ONE SINGLE MODEL.

═══ SINGLE-MODEL LOCK ═══
The output frame contains EXACTLY ONE model. ONE person. ONE body. Single-instance render. NOT a comparison shot. NOT a multi-angle layout. NOT two copies of the same model side-by-side. The fit-model reference images show the garment on a body for FIT REFERENCE ONLY — they are NOT an instruction to render multiple instances.

═══ THIS IS A NARROW EDIT — IMAGE 1 IS YOUR BLUEPRINT ═══
The output is IMAGE 1 with ONLY the placeholder bottom replaced. Every pixel of IMAGE 1 EXCEPT the placeholder pants area MUST be preserved exactly:
- Model identity (visible skin, body proportions): preserved from IMAGE 1.${upperBodyClause}
- Footwear from IMAGE 1 (${SHOE_NAME} — ${SHOE_DESCRIPTION.slice(0, 100)}…): preserved 100% as-is. Same style, colour, material, position, height. Both feet visible.
- Foot placement, stance, gap between feet, body angle: preserved from IMAGE 1.
- Background (light-grey studio sweep #D9DAD2), lighting, framing, camera angle, contact shadow: preserved from IMAGE 1.

═══ TARGET GARMENT — "${BOTTOM_NAME}" ═══
${BOTTOM_DESCRIPTION}

═══ SILHOUETTE & FIT — AUTHORITATIVE SOURCE FOR WIDTH, LENGTH, DRAPE, HEM ═══
${BOTTOM_SILHOUETTE}

═══ STRICT REQUIREMENT — NO LAYERED BOTTOMS, NO STYLING PEEKING ═══
- The ${BOTTOM_NAME} is the SOLE bottom garment in this render. NO SECOND PAIR OF PANTS, SHORTS, TROUSERS, or SKIRT layered behind, beneath, above, or alongside the ${BOTTOM_NAME}.
- NO SECOND WAISTBAND visible — only the ${BOTTOM_NAME}'s own waistband appears in the frame.

Do NOT invent pockets, yokes, hardware, washes, fades, layered waistbands.

═══ UNIVERSAL HEM-OVER-SHOE LAYER ORDER ═══
Whenever the hem reaches or extends past the top of the shoe, the pant fabric is the OUTER layer; the shoe is the INNER layer beneath it.

═══ ABSOLUTELY FORBIDDEN ═══
- DO NOT render more than one model.
- DO NOT modify the footwear in any way — locked from IMAGE 1.
- DO NOT modify the model's identity, skin tone, body proportions, or pose.
- DO NOT change the background, lighting, or framing.${upperBodyForbidden}`;
}

async function main() {
  console.log('Step 1 — F4 × Judee D22889-D933-H087 × White leather low-top sneaker — M01 pass-1 only\n');
  console.log('Matrix base : F4 × 3xKezovO fullBodyFront');
  console.log('Bottom refs : flat_front + fm_front + fm_front45L + fm_front45R');
  console.log('Output dir  :', OUT_DIR, '\n');

  const refs = [
    { url: MATRIX_F4_WHITE_FBFRONT, label: '' },
    { url: JUDEE_FLAT_FRONT,        label: '' },
    { url: JUDEE_FM_FRONT,          label: '' },
    { url: JUDEE_FM_FRONT45L,       label: '' },
    { url: JUDEE_FM_FRONT45R,       label: '' },
  ];
  const prompt = buildPass1Prompt();

  console.log(`Refs: ${refs.length} | Prompt: ${prompt.length} chars\n`);
  const t0 = Date.now();
  const result = await generateSeedreamImage({ prompt, referenceImages: refs, aspectRatio: '1:1' });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const out = path.join(OUT_DIR, 'step1_M01_pass1.png');
  fs.writeFileSync(out, result.imageData);
  console.log(`✓ ${path.basename(out)} (${dt}s, ${(result.imageData.length / 1024).toFixed(0)}KB)`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
