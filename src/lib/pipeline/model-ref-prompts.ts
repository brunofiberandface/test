/**
 * Shared prompts for model identity reference generation.
 *
 * Used by generate-front and generate-back endpoints.
 * These prompts produce UNIFORM identity refs across all models:
 * - Women: simple black sports bra + black compression shorts
 * - Men: bare torso + black compression shorts
 * - Seamless infinity cove (no horizon line, no wall-floor seam)
 * - Identical lighting, background, framing, and proportions
 *
 * v2: Designed for Seedream pipeline compatibility — sports bra
 * avoids the body seam artifact in Seedream generation.
 */
import type { ModelGender } from '@/types';

/** Clothing description based on gender */
function topForGender(gender: ModelGender): string {
  return gender === 'male'
    ? 'BARE TORSO — no shirt, no top. Chest, shoulders, and arms fully visible.'
    : 'Simple plain BLACK SPORTS BRA — minimal design, no logos, no text, thin straps.';
}

/** Shared studio environment block — identical for front and back.
 *
 * 2026-05-10: switched from warm light grey infinity cove (#D5D3CC) to PURE WHITE
 * (#FFFFFF). Aligns with LEARNING #75: model cards on pure white backdrop fixed
 * the warm-cast leak from beige cards into downstream M03/M04 renders ("F1 Culotte
 * job, M04 re-run → v3. Floor now reads as Seedance's clean light grey (~RGB
 * 200-210), no warm cast"). The May 5 batch re-mattéd 20 active models onto
 * white; new generations / regenerations now match that target directly without
 * needing a separate matte step. Bruno: "models should also be on a white
 * background as F1." */
const STUDIO_ENVIRONMENT = `
STUDIO ENVIRONMENT (CRITICAL — must be identical across all shots):
- Background: SOLID PURE WHITE (#FFFFFF). The entire background is a flat, featureless, uniform pure white sweep. NO walls, NO horizon line, NO seam between wall and floor, NO gradient, NO infinity cove, NO grey, NO beige. Think product photography cutout on white.
- Floor: same pure white (#FFFFFF) as the backdrop, completely smooth and featureless. No tiles, no texture lines, no reflections, no markings.
- Lighting: bright, even, diffused studio lighting from large softboxes on both sides + overhead. Flat and uniform — no directional shadows, no warm color cast, no golden tones, no rim light. Neutral white-balanced light.
- Shadow: ONE very subtle soft drop shadow directly beneath the feet (so the model is grounded, not floating). No secondary shadows.
- No props, no furniture, no set pieces, no background objects.`;

/** Shared proportion and camera block */
const PROPORTIONS = `
PROPORTION RULES:
- Head = 1/8.5 of total body height.
- Camera: 85mm portrait lens, 5 meters distance, waist height. ZERO wide-angle distortion — no barrel distortion, no perspective exaggeration.
- Feet are proportionally correct — EU size 38 (women) or 42 (men). BAREFOOT — no shoes, no socks, bare feet flat on the studio floor.
- FRAMING: Top of hair sits 4% below the top edge. Feet sit 3% above the bottom edge. Full body head-to-feet, no crop.`;

/**
 * Two-pass "clean extraction" prompt — Pass 1.
 * Generates the person on a PURE WHITE background to break any
 * wall/floor/studio associations from the original reference photo.
 * The result of Pass 1 is then used as the identity anchor for Pass 2
 * (the standard MODEL_REF_PROMPT_FRONT).
 */
export function MODEL_REF_PROMPT_CLEAN_EXTRACT(gender: ModelGender): string {
  const genderWord = gender === 'female' ? 'woman' : 'man';
  const top = topForGender(gender);

  return `Photorealistic photograph of a ${genderWord}, FULL BODY, FRONT VIEW, 3:4 portrait.

Match the reference photo EXACTLY: same face shape, same hair (color, length, texture, style), same skin tone, same body proportions and build. This is the SAME PERSON — only the background and clothing change.

CLOTHING:
- ${top}
- Black compression shorts (mid-thigh length, fitted).
- BAREFOOT.

BACKGROUND: SOLID PURE WHITE (#FFFFFF). The entire background is a flat, featureless, uniform pure white. No walls, no floor, no studio, no horizon line, no shadows on the background, no gradient — just pure white everywhere behind the person. Think product photography cutout on white.

POSE: Standing straight, relaxed, arms at sides, facing camera directly.

LIGHTING: Bright, flat, even. No directional shadows. Clean product photography lighting.

FRAMING: Full body head-to-feet centered in frame.

The ONLY purpose of this image is to extract the person's identity cleanly. Photorealistic quality.`;
}

/**
 * From-description prompt — used by /api/models/generate-card to create the
 * FIRST reference image for a brand-new model from text alone (no identity
 * anchor image yet). Same v2 styling as MODEL_REF_PROMPT_FRONT (sports bra /
 * bare torso + compression shorts + infinity cove + barefoot) so the
 * generated card matches every other model in the system out of the box.
 *
 * Replaced the old v1 styling (white tee/tank + black compression boxer
 * briefs on white backdrop) on 2026-05-10. Bruno test on F999 surfaced that
 * the v1 styling looked nothing like the existing roster — all 20+ models
 * had been regenerated to v2 via `regenerate-refs` long ago.
 */
export function MODEL_REF_PROMPT_FRONT_FROM_DESCRIPTION(gender: ModelGender, description: string): string {
  const genderWord = gender === 'female' ? 'woman' : 'man';
  const top = topForGender(gender);
  const cleanDescription = description.replace(/^["']/, '').trim();

  return `Photorealistic studio identity reference photograph of a ${genderWord}, FULL BODY, FRONT VIEW, 3:4 portrait.

Subject: ${cleanDescription}

The person faces the camera directly. Render the model with the appearance described above — ethnicity, age, build, hair (color, length, texture, style), skin tone with undertone, eye color, facial features, expression, and attitude exactly as written. Photorealistic, NOT illustrated.

CLOTHING:
- ${top}
- Black compression shorts (mid-thigh length, fitted).
- BAREFOOT — bare feet visible on studio floor.

POSE: Standing in bilaterally symmetric stance — both legs straight down vertically from hip to floor, both feet planted flat on the floor parallel to each other (pointing forward) with approximately ONE FOOT-WIDTH of clear space between the inner edges of the two feet (~10cm gap, narrow — feet near each other but not touching, NOT shoulder-width, NOT wider than hip), weight 50/50 across both feet, hips centered and level (NO hip tilt, NO contrapposto, NO weight shift onto one leg). Arms relaxed naturally at the sides. Expression neutral and composed, mouth closed, looking directly at camera.
${STUDIO_ENVIRONMENT}
${PROPORTIONS}

This is a MODEL IDENTITY REFERENCE photo used to anchor all future generations. Photorealistic studio quality. No branding, text, logos, jewelry, watches, or accessories.`;
}

/** Front view prompt */
export function MODEL_REF_PROMPT_FRONT(gender: ModelGender): string {
  const genderWord = gender === 'female' ? 'woman' : 'man';
  const top = topForGender(gender);

  return `Photorealistic studio identity reference photograph of a ${genderWord}, FULL BODY, FRONT VIEW, 3:4 portrait.

The person faces the camera directly. Match the reference photo EXACTLY: same face shape, same hair (color, length, texture, style), same skin tone, same body proportions and build.

CLOTHING:
- ${top}
- Black compression shorts (mid-thigh length, fitted).
- BAREFOOT — bare feet visible on studio floor.

POSE: Standing in bilaterally symmetric stance — both legs straight down vertically from hip to floor, both feet planted flat on the floor parallel to each other (pointing forward) with approximately ONE FOOT-WIDTH of clear space between the inner edges of the two feet (~10cm gap, narrow — feet near each other but not touching, NOT shoulder-width, NOT wider than hip), weight 50/50 across both feet, hips centered and level (NO hip tilt, NO contrapposto, NO weight shift onto one leg). Arms relaxed naturally at the sides. Expression neutral and composed, mouth closed, looking directly at camera.
${STUDIO_ENVIRONMENT}
${PROPORTIONS}

This is a MODEL IDENTITY REFERENCE photo used to anchor all future generations. Photorealistic studio quality. No branding, text, logos, jewelry, watches, or accessories.`;
}

/** Back view prompt */
export function MODEL_REF_PROMPT_BACK(gender: ModelGender): string {
  const genderWord = gender === 'female' ? 'woman' : 'man';
  const top = topForGender(gender);

  return `Photorealistic studio identity reference photograph of a ${genderWord}, FULL BODY, BACK VIEW, 3:4 portrait. The model faces DIRECTLY AWAY from the camera.

IMAGE 1 shows the FRONT VIEW of this EXACT person. Generate the BACK VIEW — match PRECISELY: same hair (color, length, texture, style — visible from behind), same skin tone, same body proportions, same build, same height.

CLOTHING:
- ${top}
- Black compression shorts (mid-thigh length, fitted).
- BAREFOOT — bare feet visible on studio floor.

POSE: Standing in bilaterally symmetric stance — both legs straight down vertically from hip to floor, both feet planted flat on the floor parallel to each other (pointing forward) with approximately ONE FOOT-WIDTH of clear space between the inner edges of the two feet (~10cm gap, narrow), weight 50/50 across both feet, hips centered and level (NO hip tilt, NO weight shift onto one leg). Back facing camera with very slight 3/4 turn (5-10 degrees) so silhouette is clear. Arms relaxed naturally at the sides.
${STUDIO_ENVIRONMENT}
${PROPORTIONS}

This is a MODEL IDENTITY REFERENCE photo used to anchor all future generations. Photorealistic studio quality. No branding, text, logos, jewelry, watches, or accessories.`;
}
