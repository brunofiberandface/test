/**
 * Two-pass Seedream — M04 (back-view) only.
 *
 * Why two-pass:
 *   Single-pass Seedream M04 renders model + sports bra placeholder + jeans
 *   + shoes simultaneously. With tall boots, the silhouette description's
 *   "hem at fit-model floor (bare feet)" anchor pushes the rendered hem to
 *   the boot top, leaving the boot fully exposed. Prompt iteration can't
 *   reliably push the hem past tall boots.
 *
 * Two-pass solution (validated 2026-05-07 on JwkvmgkVxUIkHGATlsyG + Slide1):
 *   Pass 1: Render the model with sports bra + briefs placeholder + shoes
 *           (NO jeans, bare legs). Locks in pose + identity + shoe geometry.
 *   Pass 2: Paint jeans on the Pass 1 base, with ONLY 2 refs (Pass 1 + jeans
 *           fit-model back). Simple prompt — Bruno locked: "add jeans using
 *           fit model back image. fit the jeans to the model, respect the
 *           original length. jeans go over the shoes, falling naturally over
 *           the shoes — never resting on top of the shoes."
 *   Tee-edit (existing Gemini step in route.ts) runs after Pass 2 to paint
 *   the actual top tucked into the waistband.
 *
 * SCOPE: M04 only. M03/M06 (front views) keep the existing single-pass path
 * — front-view two-pass had inconsistent results in testing (boot-top cluster
 * persisted with this prompt set).
 */
import { getWardrobeItem, getModel } from '@/lib/firestore';
import { normalizeWardrobeItem } from '@/lib/wardrobe-compat';
import type { JobWardrobe } from '@/types';
import { generateSeedreamImage, type SeedreamReferenceImage } from './seedream-client';
import { ensureSeedreamSafeUrl } from './seedream-image-safe';
import { uploadGeneratedImage } from '@/lib/gcs';
import { silhouetteIndicatesCroppedHem } from './cropped-hem-detector';

const STUDIO_BACKDROP_URL =
  'https://storage.googleapis.com/gstar-ai-studio-assets/backdrops/clean-studio-grey.jpg';

function cleanUrl(url: string): string {
  return url.split('?')[0];
}

async function refFromUrl(url: string, label: string): Promise<SeedreamReferenceImage> {
  const safeUrl = await ensureSeedreamSafeUrl(cleanUrl(url));
  return { url: safeUrl, label };
}

// ── PASS 1 prompt — bare-legs base ──────────────────────────────────────────
// Renders the model in basic underwear placeholder + actual shoes. Pass 2
// then paints the jeans over the bare legs. Tee-edit paints the actual top
// over the sports bra. The bike-shorts placeholder appears here is a
// Seedream-distribution artefact; it gets fully covered by Pass 2's jeans.
const PASS1_PROMPT = `Photorealistic studio e-commerce photograph, 3:4 portrait, BACK VIEW. Full body head-to-toe in frame, model facing away from camera. Backdrop: neutral cool light-grey (#D9DAD2). Soft diffused studio lighting, white-balanced 5500K.

Female model with the body and hair shown in MODEL BACK REFERENCE (Image 2). STANCE — both legs drop STRAIGHT DOWN vertically from hip to floor (no outward angle, legs do NOT widen or splay at the feet beyond the hip line), feet planted flat on the floor parallel to each other with approximately ONE FOOT-WIDTH of clear space between the inner edges of the two feet — i.e. the gap between the inner side of the left foot and the inner side of the right foot equals roughly the WIDTH (NOT the length) of one shoe (~10cm for an adult — narrow gap, feet near each other but not touching). NOT touching / sole-to-sole. NOT wider than hip-width. NOT crossed. NOT one foot in front of the other, weight 50/50 across both feet, hips centered and level, NO hip tilt, NO contrapposto, NO weight shift onto one leg. Arms hanging straight at the sides with a small natural gap from the torso, hands relaxed.

### Outfit — base undergarments + footwear ONLY
This is a base render for downstream compositing. The model wears ONLY:
- A simple black sports bra (back view: thin straps, plain band, no detail)
- Simple low-rise black briefs / underwear bottom (plain athletic style)
- The footwear shown in SHOE REFERENCE (Image 4)

NOT wearing: NO t-shirt, NO top, NO pants, NO jeans, NO leggings. Bare arms, bare upper back, bare midriff, bare upper thighs visible — natural skin tone matching the model reference.

### Footwear
Match SHOE REFERENCE (Image 4) for shape, color, material, and sole construction. Render the shoe at the AI model's natural foot proportions — a normal adult female shoe footprint, sized to match the body and stance shown in the model references. The product-photography perspective in the shoe reference is not a guide for render scale.

Clean studio-product render. Plain bra + briefs + shoes only. Back view, full body.`;

// ── PASS 2 prompt — paint jeans (Bruno-locked, simple) ─────────────────────
// Default path: long jeans that drape OVER the shoes. Used when the bottom
// garment is a standard floor-length jean.
const PASS2_PROMPT = `add jeans using fit model back image. fit the jeans to the model, respect the original length. jeans go over the shoes, falling naturally over the shoes — never resting on top of the shoes.`;

// ── PASS 2 prompt — CUFFED variant (2026-05-12) ────────────────────────────
// Used when the bottom garment's cached silhouette indicates a rolled /
// cuffed / cropped / above-ankle / mid-calf hem. The default PASS2_PROMPT's
// "jeans go over the shoes" instruction would actively destroy the cuff by
// extending the leg over the heel. This variant inverts that: respect the
// cuff EXACTLY as shown in the fit-model ref; the shoes / ankles are
// FULLY VISIBLE below the cuff. Detector: silhouetteIndicatesCroppedHem.
//
// Bruno 2026-05-07 fixed the same disease one stage later (gemini-shoe-edit
// CROPPED_HEM_PATTERNS skip rule). 2026-05-12 traced the same failure mode
// hitting Kate Boyfriend Jeans on M04 even with shoe-edit disabled — root
// cause was HERE, in the upstream Seedream Pass 2.
const PASS2_PROMPT_CUFFED = `add jeans using fit model back image. fit the jeans to the model. RESPECT THE ROLLED / CUFFED HEM EXACTLY AS SHOWN IN THE FIT MODEL REFERENCE — the hem ends at mid-ankle as a visible folded cuff, NOT at the floor, NOT over the shoes. The shoes are FULLY VISIBLE below the cuff (entire shoe, heel, ankle bone, sock area all visible — nothing covered by the jeans). Do NOT extend the leg downward over the shoes. Do NOT lengthen the jeans. Preserve the cuff fold, cuff height above the ankle, and exposed lower-leg area exactly as the fit model wears them.`;

interface TwoPassContext {
  wardrobe: JobWardrobe;
  modelId: string;
  apiKey?: string;
  /** Job name for Pass 1 intermediate save path. */
  jobName: string;
  /** Shot type filename component, e.g. "M04_v1". */
  shotTag: string;
}

/**
 * Render M04 via two-pass Seedream. Returns the Pass 2 result buffer.
 * Pass 1 intermediate is saved to GCS for debug + so Pass 2 can reference
 * it via URL (BytePlus only accepts URL refs, not raw buffers).
 */
export async function seedreamM04TwoPass(
  ctx: TwoPassContext
): Promise<{ imageData: Buffer; mimeType: string; pass1Url?: string }> {
  // ── Resolve refs ─────────────────────────────────────────────────────────
  // Pass 2 reference is ALWAYS the BOTTOM (pants) fit-model, regardless of
  // which item is focus. Bug fix 2026-05-08: when focus was a TOP (jacket),
  // earlier code pulled the JACKET's fit-model as the "jeans reference" →
  // Seedream rendered a jacket fit-model with no pants visible.
  const bottomConfig = ctx.wardrobe['bottom' as keyof JobWardrobe];
  if (!bottomConfig?.itemId) throw new Error('TwoPass M04: no bottom (pants) item in wardrobe');
  const bottomItem = await getWardrobeItem(bottomConfig.itemId) as any;
  if (!bottomItem) throw new Error(`TwoPass M04: bottom garment ${bottomConfig.itemId} not found`);
  const bottomNorm = normalizeWardrobeItem(bottomItem);
  // Prefer back, fall back to back45 angles, then front (last resort).
  const jeansFitUrl = bottomNorm?.fitModels?.back
    || bottomNorm?.fitModels?.back45Right
    || bottomNorm?.fitModels?.back45Left
    || bottomNorm?.fitModels?.front;
  if (!jeansFitUrl) {
    throw new Error('TwoPass M04: bottom garment has no fitModels (need back, back45, or front)');
  }

  const shoeConfig = ctx.wardrobe['shoe' as keyof JobWardrobe];
  if (!shoeConfig?.itemId) throw new Error('TwoPass M04: no shoe in wardrobe');
  const shoeItem = await getWardrobeItem(shoeConfig.itemId) as any;
  if (!shoeItem) throw new Error('TwoPass M04: shoe item not found');
  const shoeNorm = normalizeWardrobeItem(shoeItem);
  // Prefer flat back for shoe; fall back to flat front.
  const shoeRefUrl = shoeNorm?.flatBackUrl || shoeItem.flatBackUrl
    || shoeNorm?.flatFrontUrl || shoeItem.flatFrontUrl;
  if (!shoeRefUrl) throw new Error('TwoPass M04: shoe has no flat-front/back ref');

  const model = await getModel(ctx.modelId) as any;
  const modelFrontUrl = model?.referenceImageUrl || model?.cardImageUrl;
  if (!modelFrontUrl) throw new Error(`TwoPass M04: model front ref missing for ${ctx.modelId}`);
  const modelBackUrl = model?.backReferenceImageUrl || modelFrontUrl;

  // ── PASS 1: bare-legs base ───────────────────────────────────────────────
  const pass1Refs: SeedreamReferenceImage[] = [
    await refFromUrl(STUDIO_BACKDROP_URL, 'STUDIO BACKDROP'),
    await refFromUrl(modelBackUrl, 'MODEL CARD (BACK) — canonical, exclusive source of truth for the model\'s back-view identity. Match the model shown in this card identically: hair color and texture (back-view detail), skin tone with undertone, freckle pattern, body proportions, presence as captured here. Render the back of the model exactly as shown in this card. Lighting on the rendered model is neutral — do not transfer warm key lighting from any other reference. STANCE, FOOT POSITION, HIP TILT, WEIGHT DISTRIBUTION, AND BODY POSE are NOT taken from this card — those follow the explicit STANCE block in the prompt above (legs straight down vertically, feet one foot-WIDTH apart at the inner edges, weight 50/50, bilaterally symmetric).'),
    await refFromUrl(modelFrontUrl, 'MODEL CARD (FRONT) — canonical, exclusive source of truth for the model\'s identity. Match the model shown in this card identically: every facial feature (eye shape, eye color, nose, mouth, brow shape), the natural facial expression and presence as captured here, skin tone with undertone, freckle pattern, hair color and texture, body proportions. The face and expression in this card are exactly correct — preserve them precisely when the model\'s face is rendered. Lighting on the rendered model is neutral — do not transfer warm key lighting from any other reference. STANCE, FOOT POSITION, HIP TILT, WEIGHT DISTRIBUTION, AND BODY POSE are NOT taken from this card — those follow the explicit STANCE block in the prompt above (legs straight down vertically, feet one foot-WIDTH apart at the inner edges, weight 50/50, bilaterally symmetric). Do not copy the contrapposto stance shown in this card image.'),
    await refFromUrl(shoeRefUrl, 'SHOE REFERENCE — visual reference for the focus footwear style, color, material, leather finish, sole construction, and silhouette. Use this image for the shoe\'s appearance and design details only. The product-photography perspective in this reference is not a guide for render scale. Render the shoe at correct anatomical foot proportions for the AI model — a normal adult female shoe footprint, scaled to match the body and stance shown in the model reference.'),
  ];

  console.log(`[TwoPass M04] Pass 1 (bare-legs base) — ${pass1Refs.length} refs`);
  const t1 = Date.now();
  const pass1 = await generateSeedreamImage({
    prompt: PASS1_PROMPT,
    referenceImages: pass1Refs,
    aspectRatio: '3:4',
    apiKey: ctx.apiKey,
  });
  console.log(`[TwoPass M04] Pass 1 done in ${((Date.now() - t1) / 1000).toFixed(1)}s (${pass1.imageData.length} bytes)`);

  // Save Pass 1 to GCS so Pass 2 can reference it by URL (BytePlus accepts URLs only)
  const pass1Filename = `${ctx.shotTag}_pass1_bareleg.png`;
  const pass1Url = await uploadGeneratedImage(
    `${ctx.jobName}/debug`,
    pass1Filename,
    pass1.imageData,
  );
  console.log(`[TwoPass M04] Pass 1 saved → ${pass1Url}`);

  // ── PASS 2: paint jeans ──────────────────────────────────────────────────
  // Cuff-aware branch (2026-05-12): if the bottom garment's silhouette
  // indicates a cropped / cuffed / rolled hem, swap to the cuff-preserving
  // prompt + ref labels. The default "jeans go over the shoes" path destroys
  // the cuff; the CUFFED path respects the fit-model cuff exactly.
  const silhouetteBack: string = (bottomItem.silhouetteBack || bottomItem.silhouetteFront || '') as string;
  const isCuffed = silhouetteIndicatesCroppedHem(silhouetteBack);

  let pass2Prompt: string;
  let pass2Refs: SeedreamReferenceImage[];

  if (isCuffed) {
    console.log(`[TwoPass M04] CUFFED branch — silhouette indicates rolled/cuffed/cropped hem; preserving cuff`);
    pass2Prompt = PASS2_PROMPT_CUFFED;
    pass2Refs = [
      await refFromUrl(pass1Url, 'BASE IMAGE — pre-rendered canvas. Preserve EXACTLY: model identity (face, hair, complexion, body proportions), body pose, the model\'s STANCE (legs straight down vertically from hip to floor, feet planted flat parallel to each other with approximately one foot-WIDTH of gap between the inner edges (~10cm, narrow), weight 50/50 across both feet, hips centered and level, arms relaxed at sides), and the shoes\' position on the floor as shown. The jeans painted in this step have a ROLLED CUFFED HEM at mid-ankle as shown in the fit-model reference — the shoes, ankles, and sock area remain FULLY VISIBLE below the cuff. The bra and briefs placeholders are replaced by the new jean paint, but the cuffed hem leaves the lower leg visible above the shoes.'),
      await refFromUrl(jeansFitUrl, 'FIT MODEL BACK — the jeans on a fit model. SOURCE OF TRUTH for jean color, wash, fit, leg silhouette, AND THE ROLLED / CUFFED HEM. Match the cuff fold, the cuff height above the ankle, and the visible exposed lower-leg area EXACTLY as shown in this photograph. Do NOT lengthen the jeans. Do NOT extend the hem over the shoes. The hem position visible here IS the target hem position in the rendered output — the cuff above the ankle is preserved literally.'),
    ];
  } else {
    // Default path — Ref labels rewritten 2026-05-10 (post-00475 Path B).
    // Before Path B these labels were logging-only no-ops; now they reach
    // Seedream's text encoder and "shoes are locked" / "drape" wording was
    // fighting the Pass 2 simplified prompt's "jeans go over the shoes"
    // instruction. Ref labels here REINFORCE the simplified prompt.
    // Anti-X discipline: avoid "locked", "anchored", "drape" (ambiguous when
    // the fit-model wears bare feet but the rendered model wears shoes).
    pass2Prompt = PASS2_PROMPT;
    pass2Refs = [
      await refFromUrl(pass1Url, 'BASE IMAGE — pre-rendered canvas. Preserve EXACTLY: model identity (face, hair, complexion, body proportions), body pose, the model\'s STANCE (legs straight down vertically from hip to floor, feet planted flat parallel to each other with approximately one foot-WIDTH of gap between the inner edges (~10cm, narrow), weight 50/50 across both feet, hips centered and level, arms relaxed at sides), and the shoes\' position on the floor as shown. The jeans painted in this step descend OVER the shoes per the prompt instruction below — only heel and sole are visible at floor level. The bra and briefs placeholders are replaced by the new jean paint.'),
      await refFromUrl(jeansFitUrl, 'FIT MODEL BACK — the jeans on a fit model. Source of truth for jean color, wash, length proportion (waist-to-hem distance), fit, and leg silhouette. The fit model wears bare feet in this reference; on the rendered model the jean hem extends OVER the shoes per the prompt instruction below — the hem-to-shoe interaction comes from the prompt, NOT from this photograph.'),
    ];
  }

  console.log(`[TwoPass M04] Pass 2 (paint jeans, ${isCuffed ? 'CUFFED' : 'default'}) — ${pass2Refs.length} refs`);
  const t2 = Date.now();
  const pass2 = await generateSeedreamImage({
    prompt: pass2Prompt,
    referenceImages: pass2Refs,
    aspectRatio: '3:4',
    apiKey: ctx.apiKey,
  });
  console.log(`[TwoPass M04] Pass 2 done in ${((Date.now() - t2) / 1000).toFixed(1)}s (${pass2.imageData.length} bytes)`);

  return { imageData: pass2.imageData, mimeType: pass2.mimeType, pass1Url };
}
