/**
 * Matrix-paint pipeline for M01 / M02 (2026-05-17 — Tier-2-based replacement).
 *
 * Starts from a Tier-2 (model × shoe) legs view: model wearing the target
 * shoes + neutral placeholder hot-pants/boxer-briefs, waist-down crop, 1:1 4K.
 * Seedream paints the job's jeans over the placeholder pants. Shoes, identity,
 * pose, backdrop are all inherited from the matrix base — never re-rendered.
 *
 * No tee-edit step: the legs view has no upper-body in frame, so there's
 * nothing for the top-painter to do.
 *
 * Replaces the old M01/M02 path which cropped from M03/M04 outputs (M03/M04
 * retired same day).
 */
import { getMatrixView, type ViewKey } from '@/lib/qa/shoe-matrix';
import { generateSeedreamImage } from './seedream-client';
import { applyTeeEdit } from './seedream-tee-edit'; // still used elsewhere (M06 via generate/route.ts)
import { geminiPaintTop } from './gemini-toppaint';
import { cropFromFullBody } from './elbow-crop';
import { generateImage, type ReferenceImage } from '@/lib/vertex';
import {
  loadPrompt,
  injectSilhouette,
  injectStylingDescriptions,
  injectGarmentType,
  injectMatrixContext,
} from './prompt-loader';
import { getWardrobeItem } from '@/lib/firestore';
import { normalizeWardrobeItem } from '@/lib/wardrobe-compat';
import { positionalCompositeTop, blurBelowCut } from './composite-back';
import type { JobWardrobe, FocusSlot, ShotType } from '@/types';

export type MatrixPaintShot = 'M01' | 'M02';

export interface MatrixPaintParams {
  shotType: MatrixPaintShot;
  modelId: string;
  wardrobe: JobWardrobe;
  /** Slot of the wardrobe item flagged isFocus. When 'top', matrix-paint
   *  switches to the fullBody Tier-2 view, runs the tee-edit step after the
   *  jeans paint, and crops to head→mid-femur. Otherwise (bottom / shoe /
   *  undefined) the legs Tier-2 view is used and no tee-edit runs. */
  focusSlot?: FocusSlot;
  /** BytePlus Seedream key (optional — falls back to env). */
  seedreamApiKey?: string;
  /** Gemini API key for the tee-edit step (top-focus only). Optional — falls
   *  back to env. */
  geminiApiKey?: string;
}

export interface MatrixPaintResult {
  imageData: Buffer;
  mimeType: string;
  /** Matrix base URL used (for the stages debug gallery). */
  matrixBaseUrl: string;
  /** The Seedream model that produced the paint (e.g. 'seedream-4-5-251128'). */
  seedreamModel: string;
  /** True when this is a top-focus upper-body crop (head → mid-femur, no
   *  feet visible). Caller should disable the procedural foot-cast-shadow
   *  in the matte step — there are no feet to anchor the shadow to. */
  isUpperBodyCrop: boolean;
  /** True if the tee-edit step ran and actually painted the top. False on
   *  bottom-focus (skipped) or when tee-edit no-oped (no top in wardrobe). */
  teeEdited: boolean;
  /** Tee-edit error message when the step ran but failed. The image is the
   *  Seedream-only output (placeholder bra still visible after the crop). */
  teeEditError?: string;
  /** Pre-strip-paint buffer. The caller saves this as the 'seedream' pipeline
   *  stage in the debug viewer so reviewers can A/B "raw Seedream paint" vs
   *  the final post-strip-paint + composite-back result. Only present when
   *  the strip-paint step actually ran (teeEdited === true). */
  preStripPaintBuffer?: Buffer;
}

// Two view paths depending on focus:
//   bottom / shoe / none → legs view, Seedream paint jeans, Gemini strip-paint
//     a tucked-tee fabric slice above the jeans waistband. Preserves the 4K
//     legs view cleanly (no crop loss).
//   top                  → fullBody view, Seedream paint jeans, full Gemini
//     tee-edit, sharp upper-body crop. Necessary because the shirt-as-hero
//     shot needs head/shoulders + torso in frame.
const LEGS_VIEW_FOR_SHOT: Record<MatrixPaintShot, ViewKey> = {
  M01: 'legsFront',
  M02: 'legsBack',
};

const FULLBODY_VIEW_FOR_SHOT: Record<MatrixPaintShot, ViewKey> = {
  M01: 'fullBodyFront',
  M02: 'fullBodyBack',
};

/**
 * INLINE FALLBACK for the top-focus path only. Bottom-focus M01/M02 prompts
 * live in the vault (shotType={M01,M02} pipeline=seedream) — see
 * `loadBottomPaintPrompt()` below. Top-focus is a less-iterated branch
 * (fullBody + crop) that still uses the inline builder until it earns its
 * own vault entries.
 */
function buildBottomPaintPromptInline(
  shotType: MatrixPaintShot,
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
  // Distill the gold-standard M04 prompt's Garment + Anti-Layering + Hem
  // language into this matrix-paint prompt. Was producing peplum / second-
  // waistband / "sash styled as back skirt" hallucinations without the
  // structured anti-layering rules. (Bruno 2026-05-17: combine M02-vault
  // back-construction focus with M04-vault anti-layering + hem-over-shoe.)
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

/**
 * Strip-paint: replace the bare-skin midriff above the jeans waistband with
 * a slice of tucked-in tee fabric. Validated 2026-05-17 against the F9 ×
 * Midge Slim Straight Jeans output — front + back both tuck cleanly on jeans
 * (the firm denim waistband + belt loops + button give Gemini a clear "tuck
 * under here" anchor; the earlier hot-pants test was inconclusive because the
 * soft athletic waistband didn't anchor the tuck).
 */
export async function paintTeeHemStrip(
  paintedBottomBuffer: Buffer,
  topFlatUrl: string,
  topDescription: string,
  shotType: MatrixPaintShot,
  geminiApiKey?: string,
  topRenderingHint?: string,
): Promise<{ imageData: Buffer; mimeType: string }> {
  const side: 'front' | 'back' = shotType === 'M02' ? 'back' : 'front';

  // Fetch top flat ref
  const topResp = await fetch(topFlatUrl.split('?')[0]);
  if (!topResp.ok) throw new Error(`paintTeeHemStrip: fetch top flat ${topFlatUrl.slice(0, 80)} → ${topResp.status}`);
  const topBuf = Buffer.from(await topResp.arrayBuffer());
  const topMime = topResp.headers.get('content-type') || 'image/jpeg';

  // Classify the rendering mode from the hint (default = tucked).
  // 'cropped' — natural hem above the waistband, visible bare midriff between hem and waistband.
  // 'untucked' — hem drapes over the waistband, no visible midriff.
  // 'tucked' — fabric continues to waistband, no visible hem (legacy default).
  const hintLower = (topRenderingHint || '').toLowerCase();
  let mode: 'cropped' | 'untucked' | 'tucked';
  if (/^\s*cropped/.test(hintLower)) mode = 'cropped';
  else if (/full-?length,\s*untucked/.test(hintLower)) mode = 'untucked';
  else mode = 'tucked';
  console.log(`[paintTeeHemStrip] ${shotType} mode=${mode} hint="${(topRenderingHint || '').slice(0, 80)}"`);

  const renderingBlock = mode === 'cropped'
    ? `═══ TOP IS CROPPED — NATURAL HEM RULE ═══
This top is CROPPED. Its natural hem ends ABOVE the trouser waistband — there is a clearly visible BARE-SKIN GAP between the bottom of the top and the top of the trouser waistband. This is the intended look for the garment.

Hint from the brand: ${topRenderingHint}

Geometry — non-negotiable:
- The bottom hem of the top sits at the model's NAVEL level (mid-back / lumbar area on a back view), measurably ABOVE the trouser waistband.
- A clean horizontal hem line is visible.
- BETWEEN that hem and the trouser waistband: a CONTINUOUS STRIP of BARE SKIN (lower back / lumbar / midriff) is fully visible — width approximately 6-10% of the total frame height. This skin strip MUST be present and unambiguous, not a thin sliver.
- The top's fabric does NOT touch, overlap, or rest on the waistband. ZERO contact between top fabric and waistband.
- The hem is clean and finished — no fraying, no irregularity — unless the description says otherwise.

DO NOT tuck the top into the trouser. DO NOT extend the top's fabric down to the waistband. DO NOT render the top's hem closer than ~6% of frame height above the waistband — there must be a clear gap of bare skin.`
    : mode === 'untucked'
    ? `═══ TOP IS UNTUCKED — DRAPED OVER WAISTBAND ═══
This top is FULL-LENGTH and worn UNTUCKED. Its hem falls OVER the trouser waistband, draping loosely. No midriff is visible.

Hint from the brand: ${topRenderingHint}

Specifically:
- The top's fabric extends from the top of the frame DOWN over the trouser waistband.
- The waistband is partially or fully covered by the top's fabric.
- A clean horizontal hem line is visible somewhere below the waistband (where the top ends on the hip).
- NO bare midriff visible.
- NO tucking — the top is NOT tucked into the waistband.`
    : `═══ TUCKING — THE CRITICAL RULE ═══
The top is TUCKED INTO the bottom garment. This means:
- The tee fabric goes DOWN and DISAPPEARS UNDER the bottom garment's waistband edge.
- The bottom garment's waistband sits ON TOP OF the tee fabric — the waistband is the ABOVE layer.
- There is NO visible bottom hem of the tee. NO horizontal "fabric end line" at any height above the waistband. The tee continues smoothly DOWNWARD and the LAST visible pixel of tee fabric is the one that meets the TOP EDGE of the waistband.
- At the waistband, the visible boundary is the waistband edge itself (tee fabric above → bottom-garment fabric below). NOT an extra "tee hem resting above the waistband".

Picture how a real tucked-in t-shirt looks: tee fabric goes down, gets covered by the waistband, pants/culotte/etc continue below. ONE horizontal transition at the waistband, not two.`;

  const outputBlock = mode === 'cropped'
    ? `═══ WHAT THE OUTPUT LOOKS LIKE ═══
Top of frame down to hem of cropped top: tee fabric (matching COLOUR, FABRIC TEXTURE, FINISH from IMAGE 2).
Then a CLEAN HORIZONTAL HEM (the cropped tee's finished hem edge).
Then BARE MIDRIFF SKIN (lower back area), continuing the natural skin tone of the visible body region above the waistband.
Then the trouser waistband at the bottom of this strip.
No full tee body visible. NO shoulders, NO chest, NO neckline, NO sleeves, NO head.`
    : mode === 'untucked'
    ? `═══ WHAT THE OUTPUT LOOKS LIKE ═══
Top of frame: tee fabric (matching COLOUR, FABRIC TEXTURE, FINISH from IMAGE 2).
The fabric continues DOWN OVER the waistband area, draping loosely.
A clean horizontal hem visible somewhere on/below the waistband area.
NO bare midriff.
No full tee body visible. NO shoulders, NO chest, NO neckline, NO sleeves, NO head.`
    : `═══ WHAT THE OUTPUT LOOKS LIKE ═══
Top of frame: tee fabric (matching COLOUR, FABRIC TEXTURE, FINISH from IMAGE 2). The fabric continues unbroken from the top edge of the frame DOWN to the waistband. NO full tee visible. NO shoulders, NO chest, NO neckline, NO sleeves, NO head.`;

  const failureBlock = mode === 'cropped'
    ? `═══ FAILURE MODES — ABSOLUTELY WRONG ═══
- WRONG: hem touching, overlapping, or sitting flush against the waistband.
- WRONG: hem within 2% of frame height of the waistband (must be a clear, unambiguous skin gap of 6-10% frame height).
- WRONG: the top fabric extending all the way down to the waistband (this is a TUCKED look, not a cropped look).
- WRONG: NO bare midriff visible (cropped tops show a clear strip of skin between hem and waistband).
- WRONG: any pocket-like stitching, embroidery, or seam pattern on the body of the top that is not explicitly described in the top description.
- WRONG: rendering a full back / front view of the model.
- WRONG: reframing to chest-height or eye-level camera.
- WRONG: changing the bottom garment, waistband, footwear, floor, or background.`
    : mode === 'untucked'
    ? `═══ FAILURE MODES — ABSOLUTELY WRONG ═══
- WRONG: top fabric tucked into the waistband.
- WRONG: bare midriff visible between top hem and waistband (this top drapes OVER the waistband, no midriff visible).
- WRONG: rendering a full back / front view of the model.
- WRONG: reframing to chest-height or eye-level camera.
- WRONG: changing the bottom garment, waistband, footwear, floor, or background.`
    : `═══ FAILURE MODES — ABSOLUTELY WRONG ═══
- WRONG: a horizontal hem line / fabric edge visible ABOVE the waistband.
- WRONG: tee hanging loose / draping OVER the waistband with its hem visible.
- WRONG: a "gap" of bare skin between the tee hem and the waistband.
- WRONG: tee bottom edge sitting just above the waistband (this is the untucked look — the tee must DISAPPEAR UNDER the waistband, NOT rest on top of it).
- WRONG: rendering a full back / front view of the model.
- WRONG: reframing to chest-height or eye-level camera.
- WRONG: changing the bottom garment, waistband, footwear, floor, or background.
- WRONG: leaving any bare skin in the strip above the waistband.`;

  const prompt = `This is a TIGHT WAIST-DOWN PRODUCT SHOT, 1:1 SQUARE, 4K resolution, ${side.toUpperCase()} VIEW. The frame shows the model's lower-back / hip / leg region wearing a bottom garment (pants, culotte, skirt, etc — whatever is in the source image). The bottom of the frame is the floor with the footwear; the top of the frame is the model's lower torso / midriff / waist area. Above the bottom garment's waistband there is currently a small slice of BARE SKIN (midriff).

═══ ABSOLUTELY CRITICAL: FRAMING LOCK ═══
DO NOT REFRAME. DO NOT ZOOM OUT. DO NOT change the camera angle. DO NOT extend the frame upward to show more of the body. The output frame MUST be byte-equivalent to the source image's framing:
- Camera height, angle, crop: same (waist-down, feet at bottom edge, mid-torso at top edge)
- Body pose, stance, foot position: same
- Background: same studio backdrop
- Model identity, skin tone, body shape, proportions: same
- BOTTOM GARMENT (whatever its type, colour, fabric, stitching, pockets, waistband, hem, etc): BYTE-IDENTICAL to the source image
- Footwear, floor, contact shadow: BYTE-IDENTICAL to the source image
- Arms / hands (if visible at the sides): same — preserve skin tone

═══ THE ONLY CHANGE — TOP FABRIC IN THE MIDRIFF STRIP ═══
At the TOP of the frame, above the bottom garment's waistband, there is currently a strip of BARE SKIN (the model's midriff). PAINT THAT STRIP based on this top:

${topDescription}

${renderingBlock}

${outputBlock}

${failureBlock}

ONLY the bare-skin midriff strip at the TOP of the source image becomes the top per the rendering rules above. Everything else is byte-equivalent.`;

  // 2026-05-25: pre-blur ROLLED BACK. Test on Kate Boyfriend showed Gemini
  // returning the input ≈ unchanged on 2/3 runs (interpreting the blurred
  // bottom as "do not modify anything"). We send the un-modified Seedream
  // buffer to Gemini and rely on the positional composite alone to keep
  // the pant region byte-identical to Seedream.
  //
  // cutFraction selection (same as before):
  //   - cropped tees: 0.10 — Gemini's zone covers the bare midriff + the
  //     thin waistband strip.
  //   - tucked / untucked: 0.15 — Gemini's zone extends below the waistband.
  // Pocket-bleed risk (Gemini hallucinating pocket stitching on the tee
  // body) returns at ~1/3 rate; accepted as a smaller problem than 2/3
  // missing-tee. Future iteration may revisit with a softer blur or
  // body-tracking cut.
  const cutFraction = mode === 'cropped' ? 0.10 : 0.15;
  console.log(`[paintTeeHemStrip] ${shotType} mode=${mode} cutFraction=${cutFraction}`);

  const refs: ReferenceImage[] = [
    {
      buffer: paintedBottomBuffer,
      mimeType: 'image/png',
      label: `SOURCE IMAGE — waist-down ${side} view of the model in a bottom garment. PRESERVE every pixel except the bare-skin strip above the waistband.`,
    },
    {
      buffer: topBuf,
      mimeType: topMime,
      label: 'TOP REFERENCE — flat image of the top to paint as a hem strip per the rendering rules.',
    },
  ];

  const result = await generateImage({
    prompt,
    referenceImages: refs,
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
    apiKey: geminiApiKey,
  });

  // Positional composite: above cutFraction Gemini wins, below it Seedream
  // wins. Feathered transition (~1% of frame height) hides the seam. This
  // GUARANTEES no pocket bleed, no pant softening, and no twin-ghost
  // bleeding through from the seedream stage into the tee zone.
  const t0 = Date.now();
  const composited = await positionalCompositeTop(paintedBottomBuffer, result.imageData, {
    cutFraction,
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[paintTeeHemStrip] ${shotType} positional composite applied in ${dt}s (cut=${cutFraction})`);
  return { imageData: composited, mimeType: 'image/png' };
}

export async function matrixPaint(params: MatrixPaintParams): Promise<MatrixPaintResult> {
  const { shotType, modelId, wardrobe, focusSlot, seedreamApiKey, geminiApiKey } = params;

  const isTopFocus = focusSlot === 'top';
  const isBack = shotType === 'M02';
  // M02 bottom-focus (2026-05-24 architecture, vault rev 30):
  //   - Tier-2 (qaShoeMatrix) model×shoe base — model already wears the
  //     target shoes; placeholder briefs are replaced by Seedream paint
  //   - 3 back fit-model angles for trouser identity + silhouette
  //   - Per-garment back-view ECOM ref (wardrobe.layeringRefBackUrl) for
  //     hem-over-shoe layering authority
  //   - Tier-2 base repeated as silent anchor (slot N+1) — twin-prevention
  //   - One Seedream paint pass, no Gemini hem-extend step
  //   - paintTeeHemStrip (Gemini) adds tucked-tee at top of frame
  //   - compositeBackBySimilarity restores Seedream's crisp pant pixels
  //     wherever the Gemini tee step would have softened them
  //
  // Replaces the May 22 Tier-1 + extend-hem-over-shoe architecture, which
  // was 4/6 reliable across silhouette classes and lost pant texture
  // through chained Gemini edits (LEARNING #102). The new path is a single
  // Seedream paint over a pre-shod base — the visual evidence in slot 4
  // gives Seedream the hem-to-shoe relationship per-garment instead of
  // relying on a Gemini post-step.
  //
  // Top-focus M02 (isTopFocus=true) — fullBody + Gemini pass-2 paint +
  // upper-body-crop. (Updated 2026-05-24: was Seedream pass-2 + applyTeeEdit,
  // now Gemini pass-2 via geminiPaintTop — see comment + LEARNING #106 below.)

  // Bottom-focus path keeps the 4K legs view + uses a tee-hem-strip paint.
  // Top-focus path uses the fullBody view and runs Gemini pass-2 + upper-body crop.
  const view: ViewKey = isTopFocus
    ? FULLBODY_VIEW_FOR_SHOT[shotType]
    : LEGS_VIEW_FOR_SHOT[shotType];

  const shoeId = wardrobe.shoe?.itemId;
  if (!shoeId) throw new Error(`matrixPaint(${shotType}): job has no shoe in wardrobe`);

  const matrixUrl = await getMatrixView(shoeId, modelId, view);
  if (!matrixUrl) {
    throw new Error(
      `matrixPaint(${shotType}): no ${view} for cell ${shoeId}_${modelId}. ` +
      `Job should have been parked in 'awaiting-matrix' until the cell lands.`,
    );
  }
  // Strip cache-buster query so BytePlus fetches the canonical GCS object.
  const matrixUrlCanonical = matrixUrl.split('?')[0];

  const bottomId = wardrobe.bottom?.itemId;
  if (!bottomId) throw new Error(`matrixPaint(${shotType}): job has no bottom in wardrobe`);
  const bottomItem = await getWardrobeItem(bottomId) as Record<string, unknown> | null;
  if (!bottomItem) throw new Error(`matrixPaint(${shotType}): bottom item ${bottomId} not found`);
  const normalized = normalizeWardrobeItem(bottomItem);
  if (!normalized) throw new Error(`matrixPaint(${shotType}): bottom item ${bottomId} has no usable images`);

  // isBack already declared at the top of matrixPaint().
  const fm = normalized.fitModels;

  // Reference strategy for trousers (per Bruno 2026-05-17):
  //   M01 (front): flatFront (canonical color/fabric/front-construction) +
  //                fitModel.front (drape on body). 2 garment refs.
  //   M02 (back):  fitModel.back ONLY. No back flat ever exists for trousers.
  //                Passing flatFront here was a bad idea — visual evidence beats
  //                text, so Seedream copied the front pockets / fly / wrap-over
  //                closure to the back render despite "DO NOT" text rules.
  //                fitModel.back has everything: back construction + color +
  //                fabric + drape. 1 garment ref, no front pollution.
  if (isBack) {
    if (!fm.back) {
      throw new Error(`matrixPaint(${shotType}): bottom item ${bottomId} has no fitModels.back angle (required for M02)`);
    }
  } else {
    if (!normalized.flatFrontUrl) {
      throw new Error(`matrixPaint(${shotType}): bottom item ${bottomId} has no flatFrontUrl (required for M01)`);
    }
  }

  // Per-garment context — drives the buildBottomPaintPrompt language so the
  // prompt is garment-agnostic (was hardcoded "jeans"). Pull from the wardrobe
  // doc; fall back gracefully.
  const bottomName = (bottomItem.name as string) || 'bottom garment';
  const bottomDescription =
    (bottomItem.description as string) ||
    bottomName;
  const bottomSilhouette = isBack
    ? ((bottomItem.silhouetteBack as string) || (bottomItem.silhouetteFront as string) || '')
    : ((bottomItem.silhouetteFront as string) || (bottomItem.silhouetteBack as string) || '');

  // Shoe context — drives the hem-over-footwear rule in the prompt so
  // boots (or any tall footwear) get the hem CASCADING OVER from outside,
  // not tucked INTO the boot opening.
  const shoeItem = await getWardrobeItem(shoeId) as Record<string, unknown> | null;
  const shoeName = (shoeItem?.name as string) || 'footwear';
  const shoeDescription = (shoeItem?.description as string) || shoeName;

  // ──────────────────────────────────────────────────────────────────────
  // ByteDance v1 audit pattern RESTORED (Bruno 2026-05-25): the 2026-05-18
  // "lean refs" change dropped TIER framework + GLOBAL_RULES + EDIT ZONE
  // language AND disabled the inventory plumbing in seedream-client. That
  // worked while M02 had 2 thin refs (matrix + fit-model). With the rev-30
  // expansion to 5 named refs (Tier-2 + 3 back fit-model angles + ECOM
  // layering ref) the twin/diptych failure mode resurfaced — exactly the
  // multi-ref ambiguity LEARNING #88 + #101 documented.
  //
  // Restoration components (3, working together):
  //   (a) Silent anchor: Tier-2 base appears AGAIN at slot N+1, with empty
  //       label so it stays anonymous (LEARNING #88 anti-twin mechanism).
  //   (b) Per-ref OUT-scoping labels: each garment ref says "GARMENT-ONLY
  //       — IGNORE this image's model, pose, legs, footwear ENTIRELY"
  //       (LEARNING #101 — required role assignment, not failure-mode
  //       enumeration).
  //   (c) seedream-client called with forceInventory: true, which delivers
  //       the labels via a "REFERENCE IMAGE INVENTORY" block prepended to
  //       the prompt (LEARNING #89 Path B). Without (c), (b) is logging-only.
  //
  // The vault prompt (rev 32) gets a restored GLOBAL_RULES block (TIER
  // PRIORITY / MODEL LOCK / EDIT ZONE LOCK / NO DUPLICATES). That's the
  // remaining piece of the ByteDance v1 pattern that lived in the prompt
  // body, not in the labels.
  //
  // Top-focus (focusSlot==='top') keeps its single matrix ref + lean
  // labels because the top-paint happens later via geminiPaintTop and
  // doesn't have the same multi-ref ambiguity.
  // ──────────────────────────────────────────────────────────────────────
  // Reference shoeDescription so the var isn't reported unused — passed to
  // injectStylingDescriptions below (no-op when the vault prompt has no
  // placeholder, but kept on the call site for symmetry with M05/M06).
  void shoeDescription;
  void bottomName;
  void bottomDescription;

  let refs: Array<{ url: string; label: string }>;

  if (isTopFocus) {
    // Top-focus: single matrix base ref. Empty label (inventory stripped).
    refs = [{ url: matrixUrlCanonical, label: '' }];
  } else if (isBack) {
    // M02 bottom-focus (rev 31, 2026-05-25): Tier-2 base + 3 back fit-model
    // angles + per-garment ECOM layering ref. NO slot-6 silent anchor.
    //
    // Slot 0 = Tier-2 (model×shoe) legsBack — model in target shoes,
    //          placeholder briefs (to be replaced by Seedream paint).
    // Slots 1-3 = 3 back fit-model angles (back, back45L, back45R) —
    //          trouser identity / silhouette / construction authority.
    // Slot 4 = wardrobe.layeringRefBackUrl — per-garment G-Star ECOM
    //          back-view photo, used by the rev-31 prompt as the
    //          EXCLUSIVE authority for hem ↔ shoe geometric relationship.
    //          When the wardrobe item has no layeringRefBackUrl populated
    //          (legacy items not yet backfilled), slot 4 is omitted — the
    //          rev-31 prompt degrades gracefully to "no explicit hem ref".
    //
    // 2026-05-25 (rev 31): dropped the slot-6 silent Tier-2 anchor.
    // Validation on Kate Boyfriend job CuRXwWG85vAUS7PTnM8y showed twin
    // rate ~33% (1/3) WITH the anchor. The anchor was supposed to bias
    // Seedream toward "one model = Tier-2 model" by duplication, but in
    // practice Seedream still rendered a diptych in run 3. Replaced with
    // explicit anti-twin language at the head of the rev-31 vault prompt
    // (text-based hard constraint, not duplicate-ref soft hint).
    //
    // Missing back angles (back45L/R undefined) fall back to canonical
    // back so the prompt's "3 angles" wording still has 3 images.
    const back45L = fm.back45Left || fm.back!;
    const back45R = fm.back45Right || fm.back!;
    const layeringRefUrl = (bottomItem.layeringRefBackUrl as string | undefined);
    const layeringRefClean = layeringRefUrl ? layeringRefUrl.split('?')[0] : undefined;
    refs = [
      { url: matrixUrlCanonical, label: '' },
      { url: fm.back!, label: '' },
      { url: back45L, label: '' },
      { url: back45R, label: '' },
      ...(layeringRefClean ? [{ url: layeringRefClean, label: '' }] : []),
    ];
    if (!layeringRefClean) {
      console.warn(`[matrixPaint] M02 bottom ${bottomId} has no layeringRefBackUrl — running 4-ref fallback. Re-run scripts/backfill-layering-refs.ts to populate.`);
    } else {
      console.log(`[matrixPaint] M02 layeringRef: ...${layeringRefClean.slice(-60)}`);
    }
  } else {
    // M01 (front, bottom-focus): Tier-2 matrix base + multi-front garment refs.
    // 2026-05-22: expanded from 2 → up-to-5 refs for better fit fidelity.
    //
    // Slots: matrix base (Tier-2 model×shoe legsFront) + fit-model.front +
    // front45Left + front45Right + flat_front. Missing angles are skipped
    // (filter on empty). flat_front is required upstream (we threw earlier
    // when normalized.flatFrontUrl was empty), so it's always present.
    //
    // No Gemini shoe step — front view doesn't have the back-view
    // pant-over-shoe layering problem (toes-toward-camera renders cleanly).
    // The M01 vault rev 23 prompt is unchanged.
    const m01FrontPrimary = fm.front || normalized.flatFrontUrl;
    const m01Angles = [
      fm.front45Left,
      fm.front45Right,
    ].filter((u): u is string => !!u);
    refs = [
      { url: matrixUrlCanonical, label: '' },
      { url: m01FrontPrimary, label: '' },
      ...m01Angles.map(url => ({ url, label: '' })),
      ...(normalized.flatFrontUrl && normalized.flatFrontUrl !== m01FrontPrimary
        ? [{ url: normalized.flatFrontUrl, label: '' }]
        : []),
    ];
  }

  // Bottom-focus (the common path): load the prompt from the vault so
  // iterations are revision-tracked + regression-safe. Top-focus: inline
  // builder (less-iterated branch, not yet vaulted).
  let promptText: string;
  if (isTopFocus) {
    promptText = buildBottomPaintPromptInline(
      shotType,
      true,
      bottomName,
      bottomDescription,
      bottomSilhouette,
      shoeName,
      shoeDescription,
    );
  } else {
    const loaded = await loadPrompt(shotType as ShotType, undefined, 'seedream');
    let p = loaded.generationPrompt;
    p = injectGarmentType(p, bottomName);
    p = injectSilhouette(p, bottomSilhouette);
    p = injectStylingDescriptions(p, '', shoeDescription);
    p = injectMatrixContext(p, bottomDescription, shoeName);
    promptText = p;
    console.log(`[matrixPaint] ${shotType} loaded vault prompt rev=${loaded.revision}`);
  }

  const seedreamResult = await generateSeedreamImage({
    prompt: promptText,
    referenceImages: refs,
    aspectRatio: '1:1',
    apiKey: seedreamApiKey,
  });

  let painted: Buffer = seedreamResult.imageData;
  let mimeType = seedreamResult.mimeType;
  let teeEdited = false;
  let teeEditError: string | undefined;

  // ─── Top-focus path: fullBody + Gemini pass-2 paint + upper-body crop ──
  // 2026-05-24: Swapped Seedream pass-2 + applyTeeEdit for Gemini-3-pro
  // pass-2 (see gemini-toppaint.ts). Seedream pass-2 produced 0/16 deliverable
  // outputs in step 7-10 A/B (twins, pants drift, front-button leak, bra
  // exposure on tee-edit failure). Gemini pass-2 with v4 prompt + 5/6-ref
  // structure delivered ~70% clean across 23 renders in step 11/12 (no twins,
  // no pants drift, no front-button leak, no color drift — remaining failures
  // are stochastic framing on F9 × Resort cluster).
  //
  // See prompts/matrix/matrix-toppaint-seedream-v3.md for design history and
  // gemini-toppaint.ts for the v4 prompt + ref structure.
  if (isTopFocus) {
    const teeResult = await geminiPaintTop({
      pass1Buffer: painted,
      wardrobe,
      shotType,
      apiKey: geminiApiKey,
    });
    if (teeResult.edited) {
      painted = teeResult.imageData;
      teeEdited = true;
    } else if (teeResult.error) {
      teeEditError = teeResult.error;
      console.error(`[matrixPaint] ${shotType} gemini-toppaint failed: ${teeResult.error}`);
    }
    const cropResult = await cropFromFullBody(painted, 'upper-body', geminiApiKey);
    return {
      imageData: cropResult.imageData,
      mimeType: cropResult.mimeType,
      matrixBaseUrl: matrixUrlCanonical,
      seedreamModel: seedreamResult.model,
      isUpperBodyCrop: true,
      teeEdited,
      ...(teeEditError ? { teeEditError } : {}),
    };
  }

  // ─── Bottom-focus / shoe-focus / no-focus path: legs view + strip-paint ──
  // Paint a tucked-tee fabric slice above the jeans waistband on the
  // Seedream-painted legs image. Preserves the 4K resolution of the source.
  // Validated 2026-05-17: tucking lands cleanly on jeans (firm waistband +
  // belt loops give Gemini a clear "tuck under here" anchor).
  //
  // We snapshot the pre-strip-paint buffer so the caller can save it as the
  // 'seedream' pipeline stage and the post-strip result as 'teeedit' (so the
  // debug viewer shows what strip-paint actually changed, instead of one
  // already-painted "seedream" tile that hides the step).

  // Rev 30 architecture (2026-05-24): no Gemini hem-extend step. Seedream
  // paints the trouser onto a Tier-2 base where the shoes are already
  // present, and slot 4 (per-garment ECOM layering ref) gives the
  // hem-to-shoe geometric authority. Quality stays crisp because there's
  // no chained Gemini regen on the pant area before strip-paint runs.
  //
  // The previous geminiExtendHemOverShoe step is deprecated — kept as a
  // file (src/lib/pipeline/gemini-shoe-step.ts) for reference but no
  // longer imported here.
  const preStripPaintBuffer = Buffer.from(painted);

  console.log(`[matrixPaint] ${shotType} ENTERING strip-paint block (isTopFocus=${isTopFocus}, wardrobe.top=${JSON.stringify(wardrobe.top)})`);
  const topConfig = wardrobe.top;
  if (topConfig?.itemId) {
    console.log(`[matrixPaint] ${shotType} strip-paint: topConfig.itemId=${topConfig.itemId}`);
    try {
      const topItem = await getWardrobeItem(topConfig.itemId) as Record<string, unknown> | null;
      console.log(`[matrixPaint] ${shotType} strip-paint: topItem loaded? ${!!topItem} (keys=${topItem ? Object.keys(topItem).slice(0, 8).join(',') : 'null'})`);
      if (topItem) {
        const topNorm = normalizeWardrobeItem(topItem);
        const topFitModels = (topItem.fitModels as Record<string, string> | undefined) ?? {};
        // Resolve a ref image — flat preferred, fit-model fallback (B2:
        // not every top has a flat product photo; the fit-model image gives
        // Gemini visual context of the tee just as well as a flat for the
        // strip-paint step). Empty strings are treated as "missing" via the
        // helper below.
        const nonEmpty = (s: string | undefined | null): string | undefined =>
          (typeof s === 'string' && s.length > 0) ? s : undefined;
        const topRefUrl = isBack
          ? (nonEmpty(topNorm?.flatBackUrl) ||
             nonEmpty(topItem.flatBackUrl as string) ||
             nonEmpty(topNorm?.flatFrontUrl) ||
             nonEmpty(topItem.flatFrontUrl as string) ||
             nonEmpty(topFitModels.back) ||
             nonEmpty(topFitModels.front))
          : (nonEmpty(topNorm?.flatFrontUrl) ||
             nonEmpty(topItem.flatFrontUrl as string) ||
             nonEmpty(topItem.flatImageUrl as string) ||
             nonEmpty(topFitModels.front));
        const topDescription =
          (topItem.topDescription as string) ||
          (topItem.description as string) ||
          (topItem.name as string) ||
          'fitted top';
        // topRenderingHint (added 2026-05-24) tells the strip-paint step
        // whether the top should render as cropped (natural hem above
        // waistband, midriff visible), untucked (drapes over waistband),
        // or tucked (default — fabric continues under waistband). When
        // missing, defaults to tucked for backward compatibility.
        const topRenderingHint = (topItem.topRenderingHint as string | undefined) || undefined;
        console.log(`[matrixPaint] ${shotType} strip-paint: topRefUrl=${topRefUrl ? topRefUrl.slice(-60) : 'EMPTY'}, topDescription="${topDescription.slice(0, 50)}...", hint="${(topRenderingHint || '').slice(0, 60)}"`);
        if (topRefUrl) {
          console.log(`[matrixPaint] ${shotType} strip-paint: calling paintTeeHemStrip…`);
          const stripResult = await paintTeeHemStrip(
            painted,
            topRefUrl,
            topDescription,
            shotType,
            geminiApiKey,
            topRenderingHint,
          );
          // 2026-05-25: paintTeeHemStrip now does pre-blur + positional
          // composite internally. The previous compositeBackBySimilarity
          // call here is gone — positional composite is deterministic and
          // pant region is byte-identical to Seedream by construction
          // (above cutFraction = Gemini, below = Seedream, feathered seam).
          painted = stripResult.imageData;
          mimeType = stripResult.mimeType;
          teeEdited = true;
          console.log(`[matrixPaint] ${shotType} strip-paint applied (${(painted.length / 1024).toFixed(0)}KB)`);
        } else {
          // No flat AND no fit-model reference. Surface as an error rather
          // than silently shipping a bare-midriff shot — the caller exposes
          // this via shot.teeEditError so reviewers see what went wrong.
          teeEditError = `top item ${topConfig.itemId} has no flat or fit-model image — strip-paint cannot run`;
          console.warn(`[matrixPaint] ${shotType} strip-paint skipped — ${teeEditError}`);
        }
      }
    } catch (err) {
      teeEditError = err instanceof Error ? err.message : String(err);
      console.error(`[matrixPaint] ${shotType} strip-paint failed (bare midriff will be visible): ${teeEditError}`);
    }
  } else {
    teeEditError = `no top in wardrobe (topConfig=${JSON.stringify(topConfig)})`;
    console.warn(`[matrixPaint] ${shotType} strip-paint skipped — ${teeEditError}`);
  }

  return {
    imageData: painted,
    mimeType,
    matrixBaseUrl: matrixUrlCanonical,
    seedreamModel: seedreamResult.model,
    isUpperBodyCrop: false,
    teeEdited,
    ...(teeEditError ? { teeEditError } : {}),
    // Only include preStripPaintBuffer when strip-paint actually ran; if it
    // didn't, painted === preStripPaintBuffer and saving both stages would
    // be misleading (same pixels in 'seedream' and 'teeedit' tiles).
    ...(teeEdited ? { preStripPaintBuffer } : {}),
  };
}
