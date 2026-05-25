/**
 * Step 2 — same combo, M01 re-render + M02.
 *
 * Changes from step 1:
 *   - Added "MODEL CENTERED" positive framing block to fix the lateral drift
 *     seen in step1_M01_pass1.png (model was left-shifted).
 *   - Added M02 path with 5 back-view refs: matrix fullBodyBack + flat_back +
 *     fm.back + fm.back45Left + fm.back45Right.
 *
 * Output:
 *   step2_M01_pass1.png
 *   step2_M02_pass1.png
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

const MATRIX_FB_FRONT = 'https://storage.googleapis.com/gstar-ai-studio-assets/output/qa-matrix/3xKezovO6eef7SJfMioC/F4/fullBodyFront.jpg';
const MATRIX_FB_BACK  = 'https://storage.googleapis.com/gstar-ai-studio-assets/output/qa-matrix/3xKezovO6eef7SJfMioC/F4/fullBodyBack.jpg';

const JUDEE_FLAT_FRONT  = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/flat_front.jpg';
const JUDEE_FLAT_BACK   = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/flat_back.jpg';
const JUDEE_FM_FRONT    = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/fitmodel_00.jpg';
const JUDEE_FM_FRONT45L = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/fitmodel_01.jpg';
const JUDEE_FM_FRONT45R = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/fitmodel_05.jpg';
const JUDEE_FM_BACK     = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/fitmodel_03.jpg';
const JUDEE_FM_BACK45L  = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/fitmodel_02.jpg';
const JUDEE_FM_BACK45R  = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/fitmodel_04.jpg';

const BOTTOM_NAME = 'Judee Low Waist Loose Jeans';
const BOTTOM_DESCRIPTION = `Loose fit, low waist. Straight leg fitting loosely from hip to hem. Longer length. Rivet reinforced inset pockets, coin pocket positioned towards the inside. Zip fly. Rigid (non-stretch) denim, 13 oz weight, 3x1 right hand twill. Color: grey wash — a heathered charcoal grey with subtle vertical streaks and lighter fade highlights.`;
const BOTTOM_SILHOUETTE = `## Detailed Garment Analysis: Judee Low Waist Loose Jeans

**FIT CATEGORY:** Loose fit, low-waist jean with a straight-to-wide leg silhouette. Decidedly relaxed and roomy throughout, sitting low on the hip with a noticeably dropped waistband well below the natural waist. Wider leg opening than typical straight-leg, soft fluid line from hip through hem.

**WIDTH PROGRESSION:**
- Waist: low-rise, sits at upper hip bone. Waistband ~3-4cm tall, flat.
- Hip: relaxed, ~1.15-1.2× natural hip measurement
- Thigh: loose drape, ~1.25× the hip width — no taper from hip
- Knee: maintains width — straight leg, no break
- Ankle / hem opening: ~1.1× the knee width — slight outward widening
- Hem: clean topstitched finish, ~22-25cm hem opening

**LENGTH:** Floor-length on bare feet (per fit-model). On a shod model the hem cascades softly over the shoe upper, breaking into a small stacked fold above the sneaker collar.`;
const SHOE_NAME = 'White leather low-top sneaker';
const SHOE_DESCRIPTION = 'White leather low-top sneaker with clean minimal design, flat rubber sole, and white laces.';

function buildPrompt(isBack: boolean): string {
  const framing = 'full body head-to-toe';
  const upperBodyClause = '\n- Upper-body placeholder (sports bra / bare chest above the waistband): preserved from IMAGE 1. A later pipeline stage repaints the top. DO NOT alter the upper body.';
  const upperBodyForbidden = '\n- DO NOT modify the upper-body placeholder (sports bra / bare chest) — handled by a later pipeline stage.';
  return `Photorealistic studio reference photo, 1:1 SQUARE crop, 4K resolution, ${isBack ? 'BACK' : 'FRONT'} VIEW, ${framing} of ONE SINGLE MODEL.

═══ SINGLE-MODEL LOCK ═══
The output frame contains EXACTLY ONE model. ONE person. ONE body. Single-instance render. NOT a comparison shot. NOT a multi-angle layout. NOT two copies of the same model side-by-side. The fit-model reference images show the garment on a body for FIT REFERENCE ONLY — they are NOT an instruction to render multiple instances.

═══ COMPOSITION — MODEL CENTERED ═══
The model stands in the EXACT HORIZONTAL CENTER of the frame. The vertical axis of the model's body is aligned with the vertical center of the square frame. Empty backdrop space is EQUAL on the left and right sides of the figure. Composition matches IMAGE 1 exactly — same horizontal position, same vertical position, same scale.

═══ THIS IS A NARROW EDIT — IMAGE 1 IS YOUR BLUEPRINT ═══
The output is IMAGE 1 with ONLY the placeholder bottom replaced. Every pixel of IMAGE 1 EXCEPT the placeholder pants area MUST be preserved exactly:
- Model identity (visible skin, body proportions): preserved from IMAGE 1.${upperBodyClause}
- Footwear from IMAGE 1 (${SHOE_NAME} — ${SHOE_DESCRIPTION.slice(0, 100)}…): preserved 100% as-is. Same style, colour, material, position, height. Both feet visible.
- Foot placement, stance, gap between feet, body angle: preserved from IMAGE 1.
- Background (light-grey studio sweep #D9DAD2), lighting, framing, camera angle, contact shadow: preserved from IMAGE 1.
- Horizontal position of the model in the frame: preserved from IMAGE 1 — centered.

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
- DO NOT change the background, lighting, or framing.
- DO NOT shift the model left or right within the frame — preserve IMAGE 1's centered horizontal position.${upperBodyForbidden}`;
}

async function render(label: string, refs: Array<{ url: string; label: string }>, isBack: boolean, outName: string) {
  console.log(`\n[${label}] refs=${refs.length}`);
  const t0 = Date.now();
  const result = await generateSeedreamImage({ prompt: buildPrompt(isBack), referenceImages: refs, aspectRatio: '1:1' });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const out = path.join(OUT_DIR, outName);
  fs.writeFileSync(out, result.imageData);
  console.log(`  ✓ ${outName} (${dt}s, ${(result.imageData.length / 1024).toFixed(0)}KB)`);
}

async function main() {
  console.log('Step 2 — F4 × Judee × White sneaker, centered M01 + M02');

  await render('M01', [
    { url: MATRIX_FB_FRONT,    label: '' },
    { url: JUDEE_FLAT_FRONT,   label: '' },
    { url: JUDEE_FM_FRONT,     label: '' },
    { url: JUDEE_FM_FRONT45L,  label: '' },
    { url: JUDEE_FM_FRONT45R,  label: '' },
  ], false, 'step2_M01_pass1.png');

  await render('M02', [
    { url: MATRIX_FB_BACK,     label: '' },
    { url: JUDEE_FLAT_BACK,    label: '' },
    { url: JUDEE_FM_BACK,      label: '' },
    { url: JUDEE_FM_BACK45L,   label: '' },
    { url: JUDEE_FM_BACK45R,   label: '' },
  ], true, 'step2_M02_pass1.png');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
