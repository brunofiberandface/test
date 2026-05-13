/**
 * M06 — Editorial pose generation via Gemini-3-pro-image-preview.
 *
 * Why Gemini for M06 (not Seedream):
 * Seedream consistently failed pose-following for M06's editorial archetypes
 * (validated 2026-05-10 across 4 prompt iterations + visual pose refs:
 * 4/11 pose accuracy). Gemini-3-pro-image-preview reliably reproduces
 * the team-PDF pose vocabulary when fed the canonical pose ref + canonical
 * prompt structure (validated 11/11 acceptable after iterations + per-pose
 * frontal overrides for p04/p06).
 *
 * Why Seedream for M01-M05 (unchanged):
 * Garment fit and fabric fidelity remain Seedream's strength. M06 is the
 * one shot type where pose archetype matters more than per-stitch garment
 * accuracy (the editorial wide shot doesn't show pocket detail).
 *
 * Architecture: this module is a self-contained Gemini-based M06 renderer
 * exposed via generateM06WithGemini(). Called from seedreamM06() in
 * seedream-generate.ts so the dispatcher (generateSeedreamShot) doesn't
 * need to change — M06 silently routes to Gemini, every other shot stays
 * on Seedream.
 *
 * Source of pose vocabulary: src/lib/m06-poses.ts (11 canonical poses
 * defined by the G-Star team). Per-pose flag `skipPoseRefImage` controls
 * whether the team's pose photo is sent as a visual ref. Skipped for poses
 * where the ref's body angle would override the canonical text intent
 * (e.g. p04/p06 frontal overrides where the original ref is a back turn).
 */
import { getModel, getWardrobeItem } from '@/lib/firestore';
import { normalizeWardrobeItem } from '@/lib/wardrobe-compat';
import type { JobWardrobe, FocusSlot } from '@/types';
import { getM06Pose, type M06Pose } from '@/lib/m06-poses';
import { getM06TopPose, pickM06TopPose, type M06TopPose } from '@/lib/m06-top-poses';
import { generateImage, type ReferenceImage } from '@/lib/vertex';
import { buildIdentityHeadCrop } from './identity-head-crop';

/** Inlined from seedream-generate.ts:getFocusGarmentUrls — pulls bottom-item
 *  flat front + 3 fit-model front angles. M06 always uses bottom (jeans). */
async function getBottomFrontRefs(wardrobe: JobWardrobe): Promise<{ angles: string[]; flat: string }> {
  const bottomConfig = wardrobe['bottom' as keyof JobWardrobe];
  if (!bottomConfig?.itemId) throw new Error('[GeminiM06] no bottom (pants) item in wardrobe');
  const item = await getWardrobeItem(bottomConfig.itemId) as any;
  if (!item) throw new Error(`[GeminiM06] bottom garment not found: ${bottomConfig.itemId}`);
  const normalized = normalizeWardrobeItem(item);
  if (!normalized?.fitModels?.front) throw new Error(`[GeminiM06] fitModels.front missing for ${bottomConfig.itemId}`);
  const fm = normalized.fitModels;
  const angles = [fm.front, fm.front45Left, fm.front45Right].filter(Boolean) as string[];
  const flat = normalized.flatFrontUrl;
  return { angles, flat };
}

/** Pull TOP-item flat front + up to 3 fit-model front angles. Used by the
 *  top-focus M06 path (focusSlot === 'top'). Mirrors the seedream-generate
 *  getTopGarmentUrls helper so top-focus M03/M04/M06 all use the same
 *  reference structure. */
async function getTopFrontRefs(wardrobe: JobWardrobe): Promise<{ angles: string[]; flat: string; item: any }> {
  const topConfig = wardrobe['top' as keyof JobWardrobe];
  if (!topConfig?.itemId) throw new Error('[GeminiM06] top-focus job missing top item');
  const item = await getWardrobeItem(topConfig.itemId) as any;
  if (!item) throw new Error(`[GeminiM06] top garment not found: ${topConfig.itemId}`);
  const normalized = normalizeWardrobeItem(item);
  const fm = (normalized?.fitModels || {}) as Record<string, string | undefined>;
  const angles = [fm.front, fm.front45Right, fm.front45Left].filter((u): u is string => typeof u === 'string' && u.length > 0);
  // Flat preference matches the seedream getTopGarmentUrls fallback chain.
  const flat = (normalized?.flatFrontUrl || item.flatFrontUrl || item.imageUrl || item.thumbnailUrl) as string;
  return { angles, flat, item };
}

export interface GeminiM06Context {
  wardrobe: JobWardrobe;
  modelId: string;
  m06PoseId?: string;
  /** Focus slot from the parent job. When 'top', M06 branches to the
   *  top-focus pose library (t01-t05) + top-as-hero garment refs +
   *  body-only pose ref + identity head crop. When 'bottom' or unset,
   *  existing bottom-focus M06 path is unchanged. */
  focusSlot?: FocusSlot;
  /** Top-focus pose override (id 't01'-'t05'). When unset on a top-focus
   *  job, the renderer picks one at random. Set via the dashboard UI
   *  ("Pose variant" menu) or via /api/shots/[id]/rerun-with-m06-top-pose. */
  m06TopPoseId?: string;
}

export interface GeminiM06Result {
  imageData: Buffer;
  mimeType: string;
}

async function fetchAsBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  const arr = await r.arrayBuffer();
  return { buffer: Buffer.from(arr), mimeType: r.headers.get('content-type') || 'image/jpeg' };
}

/**
 * Render M06 via Gemini-3-pro-image-preview.
 *
 * 2026-05-12: Branches on ctx.focusSlot. When focusSlot === 'top' (the
 * wardrobe top is the focus item), routes to generateM06TopFocusWithGemini
 * which uses:
 *   - The 5 top-focus pose library (t01-t05) from m06-top-poses.ts —
 *     random pick when ctx.m06TopPoseId is unset, override otherwise
 *   - TOP garment as the visual hero (flat front + 3 fit-model front angles)
 *   - Body-only pose ref (head-cropped slide thumb) to prevent identity bleed
 *   - Identity head crop as IMAGE 2B to reinforce facial features + hair
 *   - Explicit identity attribute injection in prompt
 * Otherwise (focusSlot 'bottom' / 'shoe' / undefined), the original
 * bottom-focus M06 path is unchanged — same pose library (p01-p11), same
 * canonical prompt, same reference structure.
 */
export async function generateM06WithGemini(ctx: GeminiM06Context): Promise<GeminiM06Result> {
  if (ctx.focusSlot === 'top') {
    return generateM06TopFocusWithGemini(ctx);
  }
  const pose: M06Pose = getM06Pose(ctx.m06PoseId);
  console.log(`[GeminiM06] pose=${pose.id} (${pose.label})`);

  // Resolve garment + model refs
  const { angles: bottomAngles, flat: bottomFlat } = await getBottomFrontRefs(ctx.wardrobe);
  const model = await getModel(ctx.modelId) as any;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;
  if (!modelRefUrl) throw new Error(`[GeminiM06] no model card for ${ctx.modelId}`);

  // 2026-05-12 FIX: if the wardrobe has a top item, paint it. Previously the
  // M06 prompt unconditionally hardcoded a plain-black sports bra, so any
  // job with a styling top (denim jacket, cropped shirt, etc.) was losing
  // the top entirely — output showed sports bra + jeans even when the job
  // had a top. Pulling topDescription from the top item, falling back to
  // name then to the sports-bra placeholder when no top is configured
  // (jeans-only jobs). No top reference IMAGE is added — Seedream's
  // experience with top refs (crop-top copying, Apr 22 commit) suggests
  // text-only top description is safer for Gemini too.
  const topConfig = ctx.wardrobe['top' as keyof JobWardrobe];
  let wardrobeTopDescription = '';
  if (topConfig?.itemId) {
    const topItem = await getWardrobeItem(topConfig.itemId) as any;
    if (topItem) {
      wardrobeTopDescription = topItem.topDescription
        || topItem.description
        || topItem.name
        || '';
    }
  }
  console.log(`[GeminiM06] wardrobe top: ${wardrobeTopDescription ? `"${wardrobeTopDescription.slice(0, 60)}..."` : '(none — sports-bra fallback)'}`);

  // 2026-05-12 FIX: pull wardrobe.shoe so M06 doesn't hardcode stiletto heels.
  // Old behavior shipped heels for every M06 regardless of job — wrong for
  // male models (Bruno: "M06 needs to wear what was chosen on the job, clothes
  // and model"), wrong for jobs with specific footwear (work boots, sneakers,
  // chunky sole, etc.). M01-M05 already use wardrobe.shoe via Seedream's
  // getStylingRefs — M06 now matches.
  const shoeConfig = ctx.wardrobe['shoe' as keyof JobWardrobe];
  let wardrobeShoeDescription = '';
  if (shoeConfig?.itemId) {
    const shoeItem = await getWardrobeItem(shoeConfig.itemId) as any;
    if (shoeItem) {
      wardrobeShoeDescription = shoeItem.shoesDescription
        || shoeItem.description
        || shoeItem.name
        || '';
    }
  }
  console.log(`[GeminiM06] wardrobe shoe: ${wardrobeShoeDescription ? `"${wardrobeShoeDescription.slice(0, 60)}..."` : '(none — heels fallback)'}`);

  // 2026-05-13 FIX: pull wardrobe.bottom DESCRIPTION too. Bruno caught Kate
  // Boyfriend Jeans drifting on M06 (no rolled hem, magenta sheen on the
  // denim) — the bottom-focus path was sending only image refs without the
  // text reinforcement that the top-focus path uses for its hero garment.
  // Gemini's editorial-pose context overrides garment fidelity when there's
  // no explicit textual anchor. Same fallback chain as top-focus + shoe.
  const bottomConfig = ctx.wardrobe['bottom' as keyof JobWardrobe];
  let wardrobeBottomDescription = '';
  if (bottomConfig?.itemId) {
    const bottomItem = await getWardrobeItem(bottomConfig.itemId) as any;
    if (bottomItem) {
      wardrobeBottomDescription = bottomItem.bottomDescription
        || bottomItem.description
        || bottomItem.name
        || '';
    }
  }
  console.log(`[GeminiM06] wardrobe bottom: ${wardrobeBottomDescription ? `"${wardrobeBottomDescription.slice(0, 60)}..."` : '(image-only)'}`);

  // 2026-05-12 FIX: surface model gender + identity description so Gemini
  // doesn't drift to a generic Caucasian editorial face on male / non-default
  // models. Bruno caught M6 (East Asian male "Gao") rendering as a
  // generic Caucasian male in M06 while M01-M05 (Seedream) rendered the
  // correct identity.
  const modelGender = (model?.gender as string) || 'female';
  const modelDescription = (model?.description as string) || '';

  console.log('[GeminiM06] Fetching reference images...');
  const refs: ReferenceImage[] = [];

  // Slot 0: POSE REFERENCE (skipped for poses with skipPoseRefImage=true)
  if (!pose.skipPoseRefImage) {
    const poseImg = await fetchAsBuffer(pose.thumbnailUrl);
    refs.push({
      buffer: poseImg.buffer,
      mimeType: poseImg.mimeType,
      label: `IMAGE 1 — POSE REFERENCE. The model in IMAGE 1 is a DIFFERENT PERSON whose pose is the target. Copy from IMAGE 1 ONLY: body angle/rotation degree, arm placement, hand position (which hand is where), head direction, head turn over shoulder, gaze direction (at camera vs upward vs over shoulder), hip tilt, weight shift, asymmetry. Do NOT copy from IMAGE 1: identity, face, skin tone, hair color, hair length, clothing, background. The rendered model's identity is NOT IMAGE 1's identity.`,
    });
  } else {
    console.log(`[GeminiM06] pose ref image skipped (text-only) for ${pose.id}`);
  }

  // Slot 1: model identity
  const modelImg = await fetchAsBuffer(modelRefUrl);
  refs.push({
    buffer: modelImg.buffer,
    mimeType: modelImg.mimeType,
    label: `IMAGE 2 — MODEL IDENTITY (the ONLY identity source). The rendered model is the SAME PERSON as in IMAGE 2 — exact same skin tone, exact same complexion depth, exact same hair color and length, exact same hair texture, exact same facial features. The pose in IMAGE 2 is NOT the target pose; pose comes from IMAGE 1 (or the text description if IMAGE 1 is omitted).`,
  });

  // Slot 1B: identity head crop — added 2026-05-13. Bottom-focus M06 was
  // drifting on skin tone (Bruno caught j7RnJwgHfCTfEzgTXjpI rendering with
  // skin not matching the model). Top-focus M06 already had this anchor and
  // didn't show the drift — mirror it for bottom-focus. The head crop forces
  // Gemini to fuse facial features + skin tone at exactly the resolution
  // identity is recovered from, instead of relying solely on the full body
  // card where the face is a small portion and skin signal gets diluted.
  try {
    const headCropBuf = await buildIdentityHeadCrop(modelImg.buffer);
    refs.push({
      buffer: headCropBuf,
      mimeType: 'image/png',
      label: `IMAGE 2B — IDENTITY ANCHOR (head + shoulders crop, same person as IMAGE 2). Cropped tight on the face + hair + neckline so the identity and SKIN TONE signal is unambiguous. The rendered model's FACE must match IMAGE 2B: same eye shape, same nose, same lip shape, same jawline. The rendered model's SKIN TONE must match IMAGE 2B exactly: same undertone, same depth, no shift toward editorial warmth, no shift toward paler/darker. The rendered model's HAIR must match IMAGE 2B exactly: same color, same length, same parting, same texture.`,
    });
  } catch (e) {
    console.warn(`[GeminiM06] identity head crop failed (non-blocking):`, (e as Error).message);
  }

  // Slot 2: garment flat front
  if (bottomFlat) {
    const flatImg = await fetchAsBuffer(bottomFlat);
    refs.push({
      buffer: flatImg.buffer,
      mimeType: flatImg.mimeType,
      label: `IMAGE 3 — GARMENT FLAT. Source for the jeans' color, wash, fabric, seams, hardware, and pockets.`,
    });
  }

  // Slots 3+: fit-model angles
  for (let i = 0; i < bottomAngles.length; i++) {
    const a = await fetchAsBuffer(bottomAngles[i]);
    refs.push({
      buffer: a.buffer,
      mimeType: a.mimeType,
      label: `IMAGE ${4 + i} — FIT MODEL ANGLE ${i + 1}. Source for jean fit, drape, and silhouette only. The pose and identity in this image are NOT used. The pose for this render comes from IMAGE 1 (or text description).`,
    });
  }

  // Build canonical M06 prompt
  const finalPrompt = `Photorealistic studio e-commerce photograph, 1:1 square, full body, light grey backdrop (#D9DAD2). Soft diffused studio lighting, white-balanced 5500K. Sharp focus, ultra-high detail.

═══ FRAMING — MANDATORY ═══
FULL-BODY composition with HEADROOM. The ENTIRE model is visible inside the frame from the very top of the head (including any hairstyle volume — top of the hair, crown, top of a ponytail / bun / updo) DOWN to the soles of the feet (heels touching the floor). There MUST be approximately 8-12% clear background ABOVE the top of the head before the frame's top edge — NEVER let the head, hair, scalp, or hairstyle volume touch or pass the top of the frame. There MUST be approximately 5-8% clear floor BELOW the heels before the frame's bottom edge — the heels never touch the bottom edge. The subject is centered horizontally. Reserve roughly equal background to the left and right of the body.

If the chosen pose would cause cropping, ZOOM OUT — make the model smaller within the frame rather than crop any part of the body.

═══ IDENTITY (from IMAGE 2 + IMAGE 2B ONLY) ═══
The rendered model is the SAME PERSON as in IMAGE 2 and IMAGE 2B — a ${modelGender} model with these specific attributes${modelDescription ? `: ${modelDescription.split('\n')[0].slice(0, 280)}` : ''}. Exact same skin tone with the SAME undertone and depth as IMAGE 2B (do NOT shift toward editorial warmth, do NOT shift paler or darker), exact same complexion, exact same hair color, hair length, and hair texture, exact same facial features, body proportions, and ${modelGender === 'male' ? 'facial-hair / beard pattern' : 'face structure'}. The model in IMAGE 1 (if present) is a DIFFERENT person whose pose is being copied — the rendered model's identity does NOT take ANY attributes from IMAGE 1. If IMAGE 1's model has lighter skin, different hair, different ethnicity, or a different gender, the rendered model still has IMAGE 2 + IMAGE 2B's exact identity. The rendered model is ${modelGender.toUpperCase()} — never invent a different gender.

═══ POSE (from IMAGE 1 / text description) ═══
The model in the rendered output is in EXACTLY the body pose specified below. Specifically:

1. **BODY ROTATION DEGREE — literal**: If a strict frontal stance (body squared to camera) is described, the rendered model is also strictly frontal — do NOT add a 3/4 turn. If a 30°, 45°, 60°, or 75° rotation away from camera is described, render that EXACT degree of rotation — do NOT soften toward frontal. Match the rotation precisely.

2. **HAND PLACEMENT — literal, no mirroring**: If the LEFT hand is in a pocket and the RIGHT hand is at the side, render the LEFT hand in the pocket and the RIGHT hand at the side. Do NOT flip or mirror.

3. **HANDS HIDDEN BEHIND BODY**: If hands are NOT visible from the front (tucked behind the body, behind the back, or in back pockets), the rendered model's hands are also HIDDEN behind the body — only the upper arms are visible falling slightly back from the shoulders.

4. **HEAD AND NECK ANGLE — copy precisely**: If the head is turned over the shoulder back toward the camera while the body faces away, render that exact head turn. The head can rotate independently of the body.

5. **GAZE DIRECTION — copy precisely**: Match the gaze direction described (at camera, upward off-lens, over shoulder, etc.). Do NOT default to a forward-camera gaze if the spec says otherwise.

6. **ASYMMETRY AND WEIGHT SHIFT**: Copy any subtle asymmetry — weight on one leg, slight hip tilt, slight diagonal lean. Do NOT smooth the pose toward perfect symmetry.

═══ POSE DESCRIPTION ═══
Pose archetype: ${pose.label}
${pose.description}

═══ JEANS — THE HERO GARMENT (from IMAGE 3 + FIT MODEL ANGLES) ═══
The model wears the jeans shown in IMAGE 3 (GARMENT FLAT) and the FIT MODEL ANGLES. These are the focal garment in this shot — render them with MAXIMUM fidelity.

${wardrobeBottomDescription ? `Jeans description (reinforcement, treat as authoritative): ${wardrobeBottomDescription}\n\n` : ''}Match the jeans EXACTLY:
- Color and wash: the precise tone, contrast, and fading pattern shown in IMAGE 3. NO magenta / red / pink sheen, NO editorial color cast, NO glossy fashion-photography wash drift. The denim is matte, the wash is true to IMAGE 3.
- Hem treatment: if the description above or IMAGE 3 shows a ROLLED hem (cuffed at the ankle), the rendered jeans have a ROLLED HEM — not a clean unrolled hem, not a raw hem, not a frayed hem. If the description shows a cropped raw hem, render that. Match the hem treatment LITERALLY from IMAGE 3 and the description.
- Fit profile: silhouette, leg opening, rise, and break exactly as shown in the FIT MODEL ANGLES.
- Hardware: button fly vs zip fly, rivet count and placement, coin-pocket presence, back-pocket shape and arc stitching, brand patch position — all as shown in IMAGE 3.
- Fabric finish: matte cotton denim, natural weave texture. NO satin sheen, NO leather-look, NO patent shine.

CRITICAL — the jeans in IMAGE 1 (POSE REFERENCE) are NOT the target jeans. IGNORE the bottom garment in IMAGE 1 completely (different wash, different cut, different model). The rendered model's jeans are EXCLUSIVELY the garment in IMAGE 3 + FIT MODEL ANGLES + the description above.

${wardrobeTopDescription
  ? `═══ TOP — MANDATORY (from wardrobe) ═══
The model's UPPER BODY wears: ${wardrobeTopDescription}.

Match this top description EXACTLY — color, fabric, neckline/collar, sleeves, hem, fit, hardware (buttons/zippers), and any branding details called out in the description. The arms, midriff, and shoulders are clothed by this top per the description (NOT bare unless the description explicitly specifies sleeveless / cropped / open-front).

CLOTHING ISOLATION: The clothing visible in IMAGE 1 (if present) is NOT the rendered model's clothing. IGNORE everything the IMAGE 1 model wears on the upper body. The rendered upper body wears EXACTLY the top described above — nothing else, nothing extra.`
  : `═══ TOP — MANDATORY (clothing isolation) ═══
The model's UPPER BODY wears ONLY a plain black athletic sports bra (basic athletic style, no logo, no detail, no print). NOTHING else on the upper body. NO t-shirt, NO long-sleeve top, NO oversized top, NO jacket, NO knit, NO cardigan, NO turtleneck, NO bomber. The arms are bare (skin showing). The midriff is bare (skin showing). The shoulders are bare (skin showing).

CLOTHING ISOLATION: The clothing visible in IMAGE 1 (if present) is NOT the rendered model's clothing. IGNORE everything the IMAGE 1 model wears on the upper body. The rendered upper body is bare arms + plain black sports bra ONLY.`
}

═══ FOOTWEAR — MANDATORY (from wardrobe) ═══
${wardrobeShoeDescription
  ? `The model wears: ${wardrobeShoeDescription}. Match this footwear description EXACTLY — material, color, sole shape, height, lacing/buckles, branding. The footwear shown in IMAGE 1 (if present) is NOT the rendered footwear — IGNORE that and render EXACTLY the shoes described above. The model is NEVER barefoot.`
  : `The model wears appropriate, simple footwear matching the outfit. The model is NEVER barefoot. The footwear in IMAGE 1 (if present) is NOT the rendered footwear.`
}

═══ STUDIO ═══
Backdrop: clean light-grey studio sweep, no scuffs, no texture, no marks. Floor: continuous extension of the backdrop with a faint contact shadow under the feet.

═══ FAILURE MODES TO AVOID ═══
- WRONG: rendering a different model identity than IMAGE 2 + IMAGE 2B (any face, skin tone, or hair mismatch — skin tone in particular must match IMAGE 2B exactly).
- WRONG: mirroring the hands.
- WRONG: rendering hands in front pockets when the spec says hidden behind the body.
- WRONG: rendering the head facing forward when the spec says the head turns back.
- WRONG: rendering a direct camera gaze when the spec says the gaze is upward off-lens.
- WRONG: rendering a top other than ${wardrobeTopDescription ? 'the top described in the TOP section above' : 'the plain black sports bra'}.
- WRONG: barefoot.
- WRONG: any part of the head, hair, scalp, or hairstyle being cut off, cropped, or touching the top edge of the frame. The head MUST sit at least 8% below the top edge with clear background visible above it.
- WRONG: heels or feet cut off, cropped, or touching the bottom edge. There MUST be clear floor visible below the heels.
- WRONG: jeans wash drifting from IMAGE 3 — no magenta / red / pink sheen, no glossy editorial cast on the denim. The denim is MATTE with the EXACT wash shown in IMAGE 3.
- WRONG: hem treatment differing from IMAGE 3 / the description above. If a rolled / cuffed hem is shown or described, the rendered jeans have a rolled hem.
- WRONG: rendering the jeans from IMAGE 1 (POSE REFERENCE) instead of IMAGE 3. IMAGE 1's bottoms are NEVER the target.

The pose MUST match the spec. The identity MUST match IMAGE 2 + IMAGE 2B (${modelGender} model, exact skin tone). The top MUST be ${wardrobeTopDescription ? 'the top described in the TOP section above' : 'a plain black sports bra'}. The jeans MUST match IMAGE 3 + FIT MODEL ANGLES${wardrobeBottomDescription ? ' + the description above' : ''} (wash, hem treatment, fit, hardware — all literal, no editorial drift). The footwear MUST be ${wardrobeShoeDescription ? 'the footwear described in the FOOTWEAR section above' : 'appropriate simple shoes'}. These are non-negotiable.`;

  console.log(`[GeminiM06] Calling Gemini-3-pro-image-preview (${refs.length} refs, pose=${pose.id})...`);
  const t0 = Date.now();
  const result = await generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  console.log(`[GeminiM06] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.imageData.length} bytes`);

  return { imageData: result.imageData, mimeType: 'image/png' };
}

// ═══════════════════════════════════════════════════════════════════════════
// M06 TOP-FOCUS PATH — added 2026-05-12
//
// Activated when ctx.focusSlot === 'top'. Architecture validated via the 5
// dryrun renders in /tmp/m06_top_test/ (Source: tops women.pdf slide 2):
//   • Body-only pose ref (head removed) prevents identity bleed from the
//     slide model into the rendered output (slide models are diverse,
//     production models have specific hair/skin attrs that must hold)
//   • Identity head crop as IMAGE 2B reinforces the model's face/hair at
//     exactly the resolution Gemini fuses identity from
//   • Top garment is the visual hero — flat front + up to 3 fit-model front
//     angles (vs the bottom-focus path's jeans refs)
//   • Bottom is incidental — described via text as plain mid-blue jeans so
//     it doesn't compete with the top for attention
// Pose vocabulary: t01-t05 from src/lib/m06-top-poses.ts. Random pick when
// ctx.m06TopPoseId is unset; explicit override via /api/shots/[id]/
// rerun-with-m06-top-pose (parallel to the M05 variant rerun endpoint).
// ═══════════════════════════════════════════════════════════════════════════

// buildIdentityHeadCrop now lives in src/lib/pipeline/identity-head-crop.ts —
// shared between M06 (Gemini) and M03 (Seedream) where the same head-crop
// identity anchor solves identical face/skin drift modes.

async function generateM06TopFocusWithGemini(ctx: GeminiM06Context): Promise<GeminiM06Result> {
  // Resolve pose: explicit override > random pick
  const pose: M06TopPose = ctx.m06TopPoseId
    ? getM06TopPose(ctx.m06TopPoseId)
    : pickM06TopPose();
  const overrideTag = ctx.m06TopPoseId ? '[OVERRIDE]' : '[random]';
  console.log(`[GeminiM06:topfocus] pose=${pose.id} (${pose.label}) ${overrideTag}`);

  // Resolve garments + model
  const { angles: topAngles, flat: topFlat, item: topItem } = await getTopFrontRefs(ctx.wardrobe);
  const topName = topItem.name || 'top garment';
  const topDescription = topItem.topDescription || topItem.description || topName;
  console.log(`[GeminiM06:topfocus] top: "${topName}" — flat=${!!topFlat} angles=${topAngles.length}`);

  // 2026-05-12 FIX: pull wardrobe bottom + shoe so M06 doesn't hardcode
  // "plain medium-wash blue denim jeans" + "black stiletto heels" regardless
  // of the actual job. Bruno: "M06 needs to wear what was chosen on the job,
  // clothes and model".
  const bottomConfig = ctx.wardrobe['bottom' as keyof JobWardrobe];
  let wardrobeBottomDescription = '';
  if (bottomConfig?.itemId) {
    const bottomItem = await getWardrobeItem(bottomConfig.itemId) as any;
    if (bottomItem) {
      wardrobeBottomDescription = bottomItem.bottomDescription
        || bottomItem.description
        || bottomItem.name
        || '';
    }
  }
  const shoeConfig = ctx.wardrobe['shoe' as keyof JobWardrobe];
  let wardrobeShoeDescription = '';
  if (shoeConfig?.itemId) {
    const shoeItem = await getWardrobeItem(shoeConfig.itemId) as any;
    if (shoeItem) {
      wardrobeShoeDescription = shoeItem.shoesDescription
        || shoeItem.description
        || shoeItem.name
        || '';
    }
  }
  console.log(`[GeminiM06:topfocus] bottom: ${wardrobeBottomDescription ? `"${wardrobeBottomDescription.slice(0,60)}..."` : '(none)'}, shoe: ${wardrobeShoeDescription ? `"${wardrobeShoeDescription.slice(0,60)}..."` : '(none)'}`);

  const model = await getModel(ctx.modelId) as any;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;
  if (!modelRefUrl) throw new Error(`[GeminiM06:topfocus] no model card for ${ctx.modelId}`);
  const modelGender = (model?.gender as string) || 'female';
  const modelDescription = (model?.description as string) || '';

  // Fetch refs
  console.log('[GeminiM06:topfocus] Fetching reference images...');
  const refs: ReferenceImage[] = [];

  // IMAGE 1: BODY-ONLY pose ref (head removed) — identity-bleed fix
  const poseBody = await fetchAsBuffer(pose.bodyOnlyUrl);
  refs.push({
    buffer: poseBody.buffer,
    mimeType: poseBody.mimeType,
    label: `IMAGE 1 — POSE REFERENCE (BODY ONLY — head intentionally cropped off so the slide model's identity cannot bleed into the rendered output). The body in IMAGE 1 belongs to a DIFFERENT person whose POSE is the target. Copy from IMAGE 1 ONLY: body angle (front-facing), shoulder line, arm placement, hand placement (in-pocket vs at-side), elbow position, weight shift / hip tilt. Do NOT copy from IMAGE 1: skin tone, the specific top garment shown, background. The rendered model's head, face, hair, and skin come EXCLUSIVELY from IMAGE 2 + IMAGE 2B.`,
  });

  // IMAGE 1B: handcrop pose ref (t01/t02 only — hands-at-sides anti-default)
  if (pose.handcropUrl) {
    const handcrop = await fetchAsBuffer(pose.handcropUrl);
    refs.push({
      buffer: handcrop.buffer,
      mimeType: handcrop.mimeType,
      label: `IMAGE 1B — CROPPED POSE DETAIL (torso + hip + hand area). Isolates the silhouette signature for ${pose.id}: BOTH HANDS HANG FREELY AT THE SIDES OF THE BODY — neither hand is in a pocket. Match this exact silhouette: arms drop down past the hips, hands visible in front of the upper thighs, fingers gently curled, ZERO pocket interaction.`,
    });
  }

  // IMAGE 2: model identity (full card)
  const modelImg = await fetchAsBuffer(modelRefUrl);
  refs.push({
    buffer: modelImg.buffer,
    mimeType: modelImg.mimeType,
    label: `IMAGE 2 — MODEL IDENTITY (full-body identity source). The rendered model is the SAME PERSON as in IMAGE 2 — exact same skin tone, complexion, hair color, hair length, hair texture, facial features, body proportions. The pose in IMAGE 2 is NOT the target pose; pose comes from IMAGE 1.`,
  });

  // IMAGE 2B: head-and-shoulders crop of the model card — tightens identity
  try {
    const headCropBuf = await buildIdentityHeadCrop(modelImg.buffer);
    refs.push({
      buffer: headCropBuf,
      mimeType: 'image/png',
      label: `IMAGE 2B — IDENTITY ANCHOR (head + shoulders crop, same person as IMAGE 2). Cropped tight on the face + hair + neckline so the identity signal is unambiguous. The rendered model's FACE must match IMAGE 2B: same eye shape, same nose, same lip shape, same jawline. The rendered model's HAIR must match IMAGE 2B exactly: same color, same length, same parting, same texture.`,
    });
  } catch (e) {
    console.warn(`[GeminiM06:topfocus] identity head crop failed (non-blocking):`, (e as Error).message);
  }

  // IMAGE 3: TOP garment flat (the HERO garment for top-focus M06)
  if (topFlat) {
    const flatImg = await fetchAsBuffer(topFlat);
    refs.push({
      buffer: flatImg.buffer,
      mimeType: flatImg.mimeType,
      label: `IMAGE 3 — TOP GARMENT FLAT (the HERO GARMENT). This is the EXACT top the rendered model wears — same color, fabric, neckline/collar, sleeves, hem, fit, buttons/zippers, branding. The garment in IMAGE 1 is NOT the target — use ONLY IMAGE 3 + IMAGE 4+ for the top.`,
    });
  }

  // IMAGE 4+: TOP fit-model angles (drape/fit/shoulder/sleeve reference)
  for (let i = 0; i < topAngles.length && i < 3; i++) {
    const a = await fetchAsBuffer(topAngles[i]);
    refs.push({
      buffer: a.buffer,
      mimeType: a.mimeType,
      label: `IMAGE ${4 + i} — TOP FIT MODEL ANGLE ${i + 1}. Source for the top garment's fit, drape, shoulder fit, sleeve cap, hem length on body. Pose and identity here are NOT used.`,
    });
  }

  // Build top-focus prompt
  const finalPrompt = `Photorealistic studio e-commerce photograph, 1:1 square, full body, light grey backdrop (#D9DAD2). Soft diffused studio lighting, white-balanced 5500K. Sharp focus, ultra-high detail.

═══ FRAMING — MANDATORY (top-focus full-body) ═══
FULL-BODY composition with HEADROOM. The ENTIRE model is visible inside the frame from the very top of the head DOWN to the soles of the feet. ~8-12% clear background ABOVE the top of the head; ~5-8% clear floor BELOW the heels. Subject centered horizontally. If the chosen pose would cause cropping, ZOOM OUT — make the model smaller within the frame rather than crop any part of the body. The TOP GARMENT must be fully visible from neckline to hem.

═══ IDENTITY (from IMAGE 2 + IMAGE 2B ONLY) ═══
The rendered model is the SAME PERSON as in IMAGE 2 and IMAGE 2B — a ${modelGender} model${modelDescription ? ` with these specific attributes: ${modelDescription.split('\n')[0].slice(0, 280)}` : ''}. IMAGE 1 (POSE REFERENCE) is BODY-ONLY — the head is intentionally cropped because IMAGE 1's model is a DIFFERENT person whose identity must NOT appear in the rendered output. Even though IMAGE 1 has no head, you must NOT invent a head based on IMAGE 1's body shape, skin tone, or gender. The head — face, hair, skin tone, eye color, ${modelGender === 'male' ? 'facial-hair / beard pattern,' : ''} facial features — comes EXCLUSIVELY from IMAGE 2 + IMAGE 2B. The rendered model is ${modelGender.toUpperCase()} — never render a different gender.

═══ POSE (from IMAGE 1 + text below) ═══
The rendered model is in EXACTLY the body pose shown in IMAGE 1, reinforced by the text description below. All 5 top-focus poses are STRICTLY FRONT-FACING — body squared to the camera, no 3/4 turn, no profile. Eyes direct at the lens. Head level, chin neutral. Shoulders relaxed. Fingers soft, never clenched. Match hand placement and weight shift from IMAGE 1 literally (no mirroring).

═══ POSE DESCRIPTION ═══
Pose archetype: ${pose.label} (${pose.id})
${pose.description}

═══ TOP GARMENT — THE HERO (from IMAGE 3 + IMAGE 4+) ═══
The model's UPPER BODY wears the TOP shown in IMAGE 3 (FLAT FRONT) and IMAGE 4+ (FIT MODEL ANGLES). This is the focal garment — render it with maximum fidelity.

Top description (reinforcement): ${topDescription}

Match the top EXACTLY: color, fabric, neckline/collar, sleeves, hem position on body, fit profile (slim/regular/oversized), all hardware (buttons, zippers, snaps), any branding or labels visible in IMAGE 3.

CRITICAL — the top in IMAGE 1 (POSE REFERENCE) is NOT the target top. IGNORE the top garment shown in IMAGE 1. The rendered model's top is the garment in IMAGE 3 + IMAGE 4+, period.

═══ BOTTOM (from wardrobe — supporting, do not distract from the top) ═══
${wardrobeBottomDescription
  ? `The model wears: ${wardrobeBottomDescription}. Match this bottom description faithfully — color, wash, fit, fabric, length. The bottom is supporting context for the top (which is the hero) — render accurately but do not over-emphasize.`
  : `The model wears plain medium-wash blue denim jeans (straight-leg or relaxed-straight fit), clean and neutral.`
}

═══ FOOTWEAR (from wardrobe) ═══
${wardrobeShoeDescription
  ? `The model wears: ${wardrobeShoeDescription}. Match this footwear EXACTLY — material, color, sole, height, lacing, branding. The footwear in IMAGE 1 (if visible) is NOT the rendered footwear — IGNORE it. The model is NEVER barefoot. Footwear is visible at the bottom of the frame with clear floor below.`
  : `The model wears appropriate, simple footwear matching the outfit. Visible at the bottom of the frame, never barefoot, clear floor below.`
}

═══ STUDIO ═══
Clean light-grey studio sweep (#D9DAD2), no scuffs / texture / marks. Floor: continuous backdrop extension with a faint contact shadow under the feet. Soft diffused 5500K lighting, even illumination, no harsh shadows.

═══ FAILURE MODES TO AVOID ═══
- WRONG: rendering the top from IMAGE 1 instead of IMAGE 3.
- WRONG: a different model identity than IMAGE 2 + IMAGE 2B (any hair/skin/face mismatch).
- WRONG: a 3/4 turn or profile — all 5 top-focus poses are FRONTAL.
- WRONG: head turned over the shoulder — these poses look STRAIGHT INTO THE CAMERA.
- WRONG: clenched fists / rigid fingers — fingers are soft.
- WRONG: distracting bottom (bright wash, rips, embellishments).
- WRONG: any part of the head, hair, scalp, or hairstyle cropped at the top edge.
- WRONG: heels or feet cut off at the bottom edge.${pose.handcropUrl ? `
- ABSOLUTELY WRONG for ${pose.id}: any hand inside a front pocket. The front pockets are EMPTY.
- ABSOLUTELY WRONG for ${pose.id}: any thumb hooked over a pocket edge or wrist tucked behind a pocket opening.
- REQUIRED for ${pose.id}: BOTH hands clearly VISIBLE, hanging at the SIDES of the body, fingers SHOWING.` : ''}

The pose MUST match IMAGE 1 + text. The identity MUST match IMAGE 2 + IMAGE 2B. The top MUST match IMAGE 3 + IMAGE 4+. These are non-negotiable.`;

  console.log(`[GeminiM06:topfocus] Calling Gemini (${refs.length} refs, pose=${pose.id}, prompt=${finalPrompt.length} chars)...`);
  const t0 = Date.now();
  const result = await generateImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  console.log(`[GeminiM06:topfocus] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.imageData.length} bytes`);

  return { imageData: result.imageData, mimeType: 'image/png' };
}
