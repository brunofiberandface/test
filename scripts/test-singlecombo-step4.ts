/**
 * Step 4 — M01 minimal-prompt iteration (option A).
 *
 * Revert to step-1's prompt structure (no FRAMING block, no DO-NOT-shift line,
 * no "same scale" wording). Add ONE positive centering sentence as a single
 * bullet inside the existing "THIS IS A NARROW EDIT" preservation list.
 *
 * Hypothesis: step 1 framed the head correctly but drifted laterally.
 * The minimal fix is one extra preservation bullet, not a whole new block.
 * Keep everything else byte-identical to step 1.
 *
 * If this still crops the head → escalate to option B (drop fit-model refs).
 *
 * Output: step4_M01_pass1.png
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

const MATRIX_FB_FRONT = 'https://storage.googleapis.com/gstar-ai-studio-assets/output/qa-matrix/3xKezovO6eef7SJfMioC/F4/fullBodyFront.jpg';
const JUDEE_FLAT_FRONT  = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/flat_front.jpg';
const JUDEE_FM_FRONT    = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/fitmodel_00.jpg';
const JUDEE_FM_FRONT45L = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/fitmodel_01.jpg';
const JUDEE_FM_FRONT45R = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/6weuQ0caKivxaSTkr4Cw/fitmodel_05.jpg';

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

// Byte-identical to step 1's buildPass1Prompt, with ONE added bullet inside
// the THIS IS A NARROW EDIT preservation list (marked "centered horizontally").
function buildPromptM01(): string {
  return `Photorealistic studio reference photo, 1:1 SQUARE crop, 4K resolution, FRONT VIEW, full body head-to-toe of ONE SINGLE MODEL.

═══ SINGLE-MODEL LOCK ═══
The output frame contains EXACTLY ONE model. ONE person. ONE body. Single-instance render. NOT a comparison shot. NOT a multi-angle layout. NOT two copies of the same model side-by-side. The fit-model reference images show the garment on a body for FIT REFERENCE ONLY — they are NOT an instruction to render multiple instances.

═══ THIS IS A NARROW EDIT — IMAGE 1 IS YOUR BLUEPRINT ═══
The output is IMAGE 1 with ONLY the placeholder bottom replaced. Every pixel of IMAGE 1 EXCEPT the placeholder pants area MUST be preserved exactly:
- Model identity (visible skin, body proportions): preserved from IMAGE 1.
- Upper-body placeholder (sports bra / bare chest above the waistband): preserved from IMAGE 1. A later pipeline stage repaints the top. DO NOT alter the upper body.
- Footwear from IMAGE 1 (${SHOE_NAME} — ${SHOE_DESCRIPTION.slice(0, 100)}…): preserved 100% as-is. Same style, colour, material, position, height. Both feet visible.
- Foot placement, stance, gap between feet, body angle: preserved from IMAGE 1.
- Background (light-grey studio sweep #D9DAD2), lighting, framing, camera angle, contact shadow: preserved from IMAGE 1.
- The model stands in the horizontal center of the frame, with equal empty backdrop on both left and right sides of the figure.

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
- DO NOT modify the upper-body placeholder (sports bra / bare chest) — handled by a later pipeline stage.`;
}

async function main() {
  console.log('Step 4 — M01 minimal-prompt iteration (option A: step-1 prompt + 1 centering bullet)\n');

  const refs = [
    { url: MATRIX_FB_FRONT,    label: '' },
    { url: JUDEE_FLAT_FRONT,   label: '' },
    { url: JUDEE_FM_FRONT,     label: '' },
    { url: JUDEE_FM_FRONT45L,  label: '' },
    { url: JUDEE_FM_FRONT45R,  label: '' },
  ];

  const t0 = Date.now();
  const result = await generateSeedreamImage({ prompt: buildPromptM01(), referenceImages: refs, aspectRatio: '1:1' });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const out = path.join(OUT_DIR, 'step4_M01_pass1.png');
  fs.writeFileSync(out, result.imageData);
  console.log(`✓ ${path.basename(out)} (${dt}s, ${(result.imageData.length / 1024).toFixed(0)}KB)`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
