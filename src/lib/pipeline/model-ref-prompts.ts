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

/** Shared studio environment block — identical for front and back */
const STUDIO_ENVIRONMENT = `
STUDIO ENVIRONMENT (CRITICAL — must be identical across all shots):
- Background: seamless INFINITY COVE in warm light grey (hex #D5D3CC). The curved cove sweeps from the back wall smoothly into the floor with ZERO visible seam, crease, horizon line, or edge between wall and floor. The entire background is one continuous smooth surface.
- Floor: same warm light grey (#D5D3CC) as the backdrop, completely smooth and featureless. No tiles, no texture lines, no reflections, no markings.
- Lighting: bright, even, diffused studio lighting from large softboxes on both sides + overhead. Flat and uniform — no directional shadows, no warm color cast, no golden tones, no rim light. Neutral white-balanced light.
- Shadow: ONE soft drop shadow directly beneath the feet, no secondary shadows.
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

POSE: Standing with subtle contrapposto — weight gently on one leg, hip-width stance, both feet parallel to the camera, both heels flat on the floor. Arms relaxed naturally at the sides. Expression neutral and composed, mouth closed, looking directly at camera.
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

POSE: Standing naturally with slight weight shift, arms relaxed at sides. Back facing camera with very slight 3/4 turn (5-10 degrees) so silhouette is clear. Both heels flat on the floor.
${STUDIO_ENVIRONMENT}
${PROPORTIONS}

This is a MODEL IDENTITY REFERENCE photo used to anchor all future generations. Photorealistic studio quality. No branding, text, logos, jewelry, watches, or accessories.`;
}
