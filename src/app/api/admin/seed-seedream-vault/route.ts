/**
 * POST /api/admin/seed-seedream-vault
 *
 * One-off endpoint: seeds the 5 Seedream-specific prompts (M01–M05) into the
 * promptVault collection with `pipeline: 'seedream'` and `isActive: true`.
 *
 * Each prompt becomes the active Seedream prompt for its shot type.
 * Existing Gemini (untagged) prompts are left untouched.
 *
 * Idempotent: if a Seedream active prompt already exists for a shot type,
 * it's deactivated before the new one is inserted (same as uploadPromptFile).
 *
 * Returns { seeded: ['M01', 'M02', ...] }.
 */
import { NextResponse } from 'next/server';
import { db, promptVaultCol } from '@/lib/firestore';

// ── Seedream vault prompts v3.0 — SPORTS BRA + TEE-EDIT PIPELINE ────────────
// Seedream renders with sports bra (clean body, no seam artifact).
// Gemini tee-edit paints the real top afterward (M01-M04).
// M05: lateral left-side angle + even studio lighting.
// M02/M04: CRITICAL HEM LENGTH block (hem past shoes to floor).

const SEEDREAM_PROMPTS: Record<string, { generation: string; silhouette: string | null }> = {
  M01: {
    silhouette: null,
    generation: `Photorealistic studio e-commerce photograph, cropped front view, 3:4 portrait. Waist-to-ankle crop only — the top edge of the frame cuts across the hip, no head, face, chest, or shoulders visible. Both feet and shoes fully in frame with about 3% padding below the shoes. Clean seamless warm light-grey backdrop (hex #D5D3CC), bright even studio lighting, soft drop shadow beneath the feet.

Body type and skin tone match the model reference photo provided, but only the lower body is rendered. One reference photo shows the same model wearing the {garment_type} in a full-body front view — use it for exact color, wash, hem break, and fit; ignore its full-body composition.

The person wears the {garment_type} shown in the flat image and fit-model front photos, reproducing its exact color, wash gradient, seams, fly stitching, front pocket placement, hem break, and silhouette. Use the fit-model photos ONLY for the {garment_type} construction — ignore how any shirt or top appears in those photos. {silhouette}

A {top_description} is visible at the very top of the frame, just above the waistband. The waistband and belt loops are fully visible.

Footwear (described as "{shoes_description}") matches the provided shoes reference. The {garment_type} hem length and drape match the fit-model reference photos exactly — if the reference shows the hem pooling on or near the floor, reproduce that pool; if it shows a clean break at the ankle, match that instead.

Stance: subtle contrapposto, weight gently on one leg, hip-width stance, both feet parallel to the camera line, both heels flat on the floor.

No branding, text, logos, leather patches, or visible undergarments.`,
  },

  M02: {
    silhouette: null,
    generation: `Photorealistic studio e-commerce photograph, cropped back view, 3:4 portrait. The model faces directly away from the camera. Waist-to-ankle crop only — the top edge of the frame cuts across the lower back near navel height, no head, upper back, shoulders, or chest visible. Both feet and shoes fully in frame with about 3% padding below the shoes. Clean seamless warm light-grey backdrop (hex #D5D3CC), bright even studio lighting, soft drop shadow beneath the feet.

Body type and skin tone match the model reference photo provided, but only the lower body is rendered.

The person wears the {garment_type} shown in the fit-model back photos, reproducing its exact color, wash gradient, back panel seams, yoke, belt loops, back pocket placement and stitching, and silhouette. Use the fit-model photos ONLY for the {garment_type} construction — ignore how any shirt or top appears in those photos. {silhouette}

A {top_description} is visible at the very top of the frame, just above the waistband. The waistband and belt loops are fully visible.

Footwear (described as "{shoes_description}") matches the provided shoes reference.

CRITICAL — EXTRA-LONG INSEAM: These {garment_type} have an inseam 4 inches LONGER than the model's legs. The excess denim fabric falls past the shoes and pools on the floor. The hem does NOT break at the ankle — the fabric continues straight down, drapes over the top of each shoe, and touches the ground. From behind, the shoes are almost invisible — buried under pooling denim. Only the very front toe tip of each shoe peeks out. Study the fit-model reference photos: the hem covers most of the shoe. MATCH THIS EXACT LENGTH.

Stance: standing straight and symmetric, feet parallel and shoulder-width apart, weight evenly distributed on both legs, no hip tilt, no knee bend. Arms relaxed at the sides.

No branding, text, logos, leather patches, or visible undergarments.`,
  },

  M03: {
    silhouette: null,
    generation: `Photorealistic studio e-commerce photograph, front view, 3:4 portrait.

Render the person from the model reference photo provided, full body head to feet — the top of the hair sits about 4% below the top edge of the frame, the shoes sit about 3% above the bottom edge, with the floor visible beneath. Clean seamless warm light-grey backdrop (hex #D5D3CC) under bright even studio lighting, a single soft drop shadow beneath the feet.

The person wears the {garment_type} shown in the flat image and the fit-model front photos — reproduce its exact color, wash gradient, seams, fly stitching, front pocket placement, hem break, and silhouette. Use the fit-model photos ONLY for the {garment_type} construction — ignore how any shirt or top appears in those photos. {silhouette}

The model wears a {top_description}. The waistband and belt loops of the {garment_type} are fully visible.

Footwear, described as "{shoes_description}", matches the provided shoes reference for style and color. The {garment_type} hem length and drape match the fit-model reference photos exactly — if the reference shows the hem pooling on or near the floor, reproduce that pool; if it shows a clean break at the ankle, match that instead.

Stance: subtle contrapposto, weight gently on one leg with the other knee softly relaxed, hip-width stance, both feet parallel to the camera line, both heels flat on the floor. Hands naturally at the sides.

No branding, text, logos, leather patches, caps, sunglasses, or visible undergarments.`,
  },

  M04: {
    silhouette: null,
    generation: `Photorealistic studio e-commerce photograph, back view, 3:4 portrait. The model faces directly away from the camera.

Render the person from the model reference photos provided (match hair color, hair style and length, skin tone, and body build), full body head to feet — the top of the hair sits about 4% below the top edge of the frame, the shoes sit about 3% above the bottom edge, with the floor visible beneath. Clean seamless warm light-grey backdrop (hex #D5D3CC) under bright even studio lighting, a single soft drop shadow beneath the feet.

The person wears the {garment_type} shown in the fit-model back photos — reproduce its exact color, wash gradient, back panel seams, yoke, belt loops, back pocket placement and stitching, hem break, and silhouette. A garment flat front image is also provided — use it only to measure the garment's overall length, leg line, and silhouette proportions; do not copy front details (fly, front pockets) onto the back. Use the fit-model photos ONLY for the {garment_type} construction — ignore how any shirt or top appears in those photos. {silhouette}

The model wears a {top_description}. The waistband and belt loops of the {garment_type} are fully visible.

Footwear, described as "{shoes_description}", matches the provided shoes reference for style and color.

CRITICAL — EXTRA-LONG INSEAM: These {garment_type} have an inseam 4 inches LONGER than the model's legs. The excess denim fabric falls past the shoes and pools on the floor. The hem does NOT break at the ankle — the fabric continues straight down, drapes over the top of each shoe, and touches the ground. From behind, the shoes are almost invisible — buried under pooling denim. Only the very front toe tip of each shoe peeks out. Study the fit-model reference photos: the hem covers most of the shoe. MATCH THIS EXACT LENGTH.

Stance: subtle contrapposto, weight gently on one leg with the other knee softly relaxed, hip-width stance, both feet parallel to the camera line, both heels flat on the floor. Hands naturally at the sides.

No branding, text, logos, leather patches, caps, sunglasses, or visible undergarments.`,
  },

  M05: {
    silhouette: null,
    generation: `Tight product-photography close-up of the LEFT back pocket on the {garment_type}, shot from a three-quarter lateral angle. The camera is positioned to the MODEL'S RIGHT side, aimed at the MODEL'S LEFT back pocket. The viewer sees the left side of the body — the left hip and left back pocket are prominent and closest to the camera, while the right side of the body recedes away.

Study the fit-model back and three-quarter back photos provided — use them for the exact pocket shape, pocket placement, stitching pattern, thread color, fabric texture, wash, and surrounding body contour. Reproduce the left pocket exactly as shown, with the surrounding fabric drape matching how the pants sit on a real body.

The left pocket fills roughly 40–50% of the frame. The left hip, part of the waistband, and the upper left thigh are visible to give the shot anatomical context. The right pocket is NOT visible or barely visible at the far edge. Sharp focus on the pocket surface and stitching detail; surrounding fabric softly defined.

Clean seamless light-grey backdrop (hex #D5D3CC), bright even studio lighting from directly in front — flat, diffused, no directional shadows, no warm color cast, no golden tones. Neutral white-balanced light. Color, wash, and thread match the provided references exactly — pristine fabric, no fading.

No branding, text, logos, leather patches, or watermarks.`,
  },
};

export async function POST() {
  try {
    const batch = db.batch();
    const seeded: string[] = [];
    const now = new Date();

    for (const [shotType, prompts] of Object.entries(SEEDREAM_PROMPTS)) {
      // Deactivate any existing active Seedream prompts for this shot type
      const existingSnap = await promptVaultCol
        .where('shotType', '==', shotType)
        .where('pipeline', '==', 'seedream')
        .where('isActive', '==', true)
        .get();

      existingSnap.docs.forEach(doc => {
        batch.update(doc.ref, { isActive: false });
      });

      // Find latest revision for this shot type (across all pipelines)
      const revSnap = await promptVaultCol
        .where('shotType', '==', shotType)
        .orderBy('revision', 'desc')
        .limit(1)
        .get();
      const latestRevision = revSnap.empty ? 0 : (revSnap.docs[0].data().revision || 0);
      const newRevision = latestRevision + 1;

      // Build the markdown content (matches vault .md format)
      const mdContent = prompts.silhouette
        ? `## Step 1 Prompt\n\n\`\`\`\n${prompts.silhouette}\n\`\`\`\n\n## Step 2 Prompt\n\n\`\`\`\n${prompts.generation}\n\`\`\``
        : `## Prompt\n\n\`\`\`\n${prompts.generation}\n\`\`\``;

      const ref = promptVaultCol.doc();
      batch.set(ref, {
        id: ref.id,
        filename: `seedream-${shotType.toLowerCase()}-v2.0.md`,
        shotType,
        // category omitted — general (no category filter)
        content: mdContent,
        gcsUrl: '',  // seeded, not uploaded from GCS
        uploadedBy: 'admin-seed',
        generationPrompt: prompts.generation,
        silhouettePrompt: prompts.silhouette || null,
        revision: newRevision,
        isActive: true,
        isAlternative: false,
        pipeline: 'seedream',
        uploadedAt: now,
      });

      seeded.push(shotType);
    }

    await batch.commit();

    console.log(`[SeedSeedreamVault] Seeded ${seeded.length} Seedream prompts: ${seeded.join(', ')}`);

    return NextResponse.json({
      success: true,
      seeded,
      message: `Seeded ${seeded.length} Seedream prompts (v3.0 tee-edit pipeline) into promptVault with pipeline=seedream`,
    });

  } catch (err: any) {
    console.error('[SeedSeedreamVault] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
