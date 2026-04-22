# M01 & M02 — Pose, Tuck, Crop, Hem — v2 drafts

**Goal:** match the G-Star reference crops (male + female, front + back). Three things change per shot:

1. **Crop** — top edge of frame at navel height (was: hip / lower back). Shows the bottom portion of the top plus entire waistband plus legs plus shoes. Matches the uploaded reference images.
2. **Pose** — dead-neutral two-foot stance. Symmetric, planted, no contrapposto, arms at sides, zero personality. Same pose both genders.
3. **Tuck** — canonical V2 "layered under waistband" block reused verbatim from `seedream-tee-edit.ts:68-69` (the wording you validated for M03/M04).
4. **Hem** — length is defined by the fit-model reference (long = floor pool, short = ankle break). The non-negotiable rule is that M01 front hem length and M02 back hem length must be identical. Replaces M02's garment-specific "4 inches longer" block with a universal "follow fit-model, front = back" rule in both M01 and M02.

**Scope:** pipeline = `seedream`, shot types = `M01` and `M02`. Gemini archived, not touched.

**Deploy status:** NONE. Drafts for validation. Vault edit only once you approve.

**Sports bra note:** the black sports bra is the model card base — the real top is painted on afterward by the `seedream-tee-edit` Gemini step. Not a problem. Leaving the `{top_description}` + tuck language in the primary prompt so Seedream already renders a tucked silhouette the tee-edit pass can follow.

---

## Summary of changes vs current active Seedream vault prompts

| Element | M01 before | M01 after | M02 before | M02 after |
|---|---|---|---|---|
| **Crop** | Waist-to-ankle, top cuts across hip | Navel-to-ankle, top cuts across torso at navel height | Waist-to-ankle, top cuts across lower back near navel | Navel-to-ankle, top cuts across lower back at navel height |
| **Pose** | Subtle contrapposto, weight on one leg | Dead-neutral 50/50, square hips, arms at sides | Standing straight symmetric, feet parallel | Dead-neutral 50/50, square hips, arms at sides (back-facing) |
| **Top** | "{top_description} visible just above waistband" | Canonical V2 tuck block | "{top_description} visible just above waistband" | Canonical V2 tuck block |
| **Hem** | "Match fit-model photos exactly — pool or ankle break" (front only) | Match fit-model reference, MUST equal M02 back length | Garment-specific "4 inches longer, pools on floor" | Match fit-model reference, MUST equal M01 front length |

---

## Canonical tuck block (verbatim from seedream-tee-edit.ts)

> CRITICAL LAYERING INSTRUCTION:
> The top covers the entire torso from shoulders to below the waistband. The bottom of the top is hidden UNDER the jeans — the denim waistband sits ON TOP of the shirt fabric. The shirt is completely tucked in with no fabric hanging over or bunching above the waistband. The waistband line is clean and unbroken.

## Canonical hem block (new — length follows fit-model reference; front = back)

> HEM LENGTH — MATCH THE FIT-MODEL REFERENCE, FRONT = BACK:
> The hem length of the {garment_type} is defined by the fit-model reference photos — whatever length and drape they show, reproduce exactly. If the reference shows a long inseam with the hem pooling over the shoes and reaching the floor, render it that way. If the reference shows a shorter inseam with a clean break at the ankle or a partial shoe-covering break, render that instead. NON-NEGOTIABLE: the front view hem length (M01) and the back view hem length (M02) must be identical — the amount of hem past the ankle, the degree of pooling, and the drape pattern must all match between the two views. Never render a long hem on one view and a short hem on the other.

## Canonical crop block (new — navel-level)

> CROP — NAVEL TO FLOOR:
> The top edge of the frame cuts horizontally across the torso at navel height. The entire waistband of the {garment_type} is visible with a strip of the top still showing above it. No chest, shoulders, upper arms, collarbones, neck, face, or head are visible. Both feet and shoes are fully in frame with about 3% padding below the shoes so the floor beneath is visible.

---

## Full new M01 generation prompt (drop-in replacement for /prompt-vault)

```
Photorealistic studio e-commerce photograph, cropped front view, 3:4 portrait. Clean seamless warm light-grey backdrop (hex #D5D3CC), bright even studio lighting, soft drop shadow beneath the feet.

CROP — NAVEL TO FLOOR:
The top edge of the frame cuts horizontally across the torso at navel height. The entire waistband of the {garment_type} is visible with a strip of the top still showing above it. No chest, shoulders, upper arms, collarbones, neck, face, or head are visible. Both feet and shoes are fully in frame with about 3% padding below the shoes so the floor beneath is visible.

Body type and skin tone match the model reference photo provided, but only the lower body (navel to floor) is rendered. One reference photo shows the same model wearing the {garment_type} in a full-body front view — use it for exact color, wash, hem break, and fit; ignore its full-body composition.

The person wears the {garment_type} shown in the flat image and fit-model front photos, reproducing its exact color, wash gradient, seams, fly stitching, front pocket placement, and silhouette. Use the fit-model photos ONLY for the {garment_type} construction — ignore how any shirt or top appears in those photos. {silhouette}

The model wears a {top_description}.

CRITICAL LAYERING INSTRUCTION:
The top covers the entire torso from shoulders to below the waistband. The bottom of the top is hidden UNDER the jeans — the denim waistband sits ON TOP of the shirt fabric. The shirt is completely tucked in with no fabric hanging over or bunching above the waistband. The waistband line is clean and unbroken.

HEM LENGTH — MATCH THE FIT-MODEL REFERENCE, FRONT = BACK:
The hem length of the {garment_type} is defined by the fit-model reference photos — whatever length and drape they show, reproduce exactly. If the reference shows a long inseam with the hem pooling over the shoes and reaching the floor, render it that way. If the reference shows a shorter inseam with a clean break at the ankle or a partial shoe-covering break, render that instead. NON-NEGOTIABLE: the front view hem length (M01) and the back view hem length (M02) must be identical — the amount of hem past the ankle, the degree of pooling, and the drape pattern must all match between the two views. Never render a long hem on one view and a short hem on the other.

Footwear (described as "{shoes_description}") matches the provided shoes reference in color and silhouette. The visible portion of the shoe is determined by the hem length from the fit-model reference.

STANCE — DEAD-NEUTRAL TWO-FOOT:
Dead-neutral symmetric standing pose. Weight distributed 50/50 on both feet. Feet parallel, shoulder-width apart, toes pointing straight toward the camera, both heels flat on the floor. Hips perfectly square — zero tilt, belt line horizontal. Both legs straight, no knee bend, no weight shift. Shoulders level and square to the camera, no rotation. Arms hanging fully relaxed at the sides with a small natural gap between arms and torso so the waistband and side pockets remain fully visible. Hands loose and open, not clenched, not in pockets, not resting on hips.

No branding, text, logos, leather patches, or visible undergarments.
```

---

## Full new M02 generation prompt (drop-in replacement for /prompt-vault)

```
Photorealistic studio e-commerce photograph, cropped back view, 3:4 portrait. The model faces directly away from the camera. Clean seamless warm light-grey backdrop (hex #D5D3CC), bright even studio lighting, soft drop shadow beneath the feet.

CROP — NAVEL TO FLOOR:
The top edge of the frame cuts horizontally across the lower back at navel height (the front-body equivalent of the navel line, from behind). The entire back waistband of the {garment_type} is visible with a strip of the top still showing above it. No upper back, shoulders, upper arms, neck, or head are visible. Both feet and shoes are fully in frame with about 3% padding below the shoes so the floor beneath is visible.

Body type and skin tone match the model reference photo provided, but only the lower body (navel to floor) is rendered.

The person wears the {garment_type} shown in the fit-model back photos, reproducing its exact color, wash gradient, back panel seams, yoke, belt loops, back pocket placement and stitching, and silhouette. Use the fit-model photos ONLY for the {garment_type} construction — ignore how any shirt or top appears in those photos. {silhouette}

The model wears a {top_description}.

CRITICAL LAYERING INSTRUCTION:
The top covers the entire torso from shoulders to below the waistband. The bottom of the top is hidden UNDER the jeans — the denim waistband sits ON TOP of the shirt fabric. The shirt is completely tucked in with no fabric hanging over or bunching above the waistband. The waistband line is clean and unbroken.

HEM LENGTH — MATCH THE FIT-MODEL REFERENCE, FRONT = BACK:
The hem length of the {garment_type} is defined by the fit-model reference photos — whatever length and drape they show, reproduce exactly. If the reference shows a long inseam with the hem pooling over the shoes and reaching the floor, render it that way. If the reference shows a shorter inseam with a clean break at the ankle or a partial shoe-covering break, render that instead. NON-NEGOTIABLE: the back view hem length (M02) and the front view hem length (M01) must be identical — the amount of hem past the ankle, the degree of pooling, and the drape pattern must all match between the two views. Never render a long hem on one view and a short hem on the other.

Footwear (described as "{shoes_description}") matches the provided shoes reference in color and silhouette. The visible portion of the shoe is determined by the hem length from the fit-model reference.

STANCE — DEAD-NEUTRAL TWO-FOOT:
Dead-neutral symmetric standing pose, model facing directly away from the camera. Weight distributed 50/50 on both feet. Feet parallel, shoulder-width apart, toes pointing straight away from the camera, both heels flat on the floor. Hips perfectly square — zero tilt, belt line horizontal. Both legs straight, no knee bend, no weight shift. Shoulders level and square to the camera (back directly facing the lens), no rotation. Arms hanging fully relaxed at the sides with a small natural gap between arms and torso so the waistband and back pockets remain fully visible. Hands loose and open, not clenched, not in pockets.

No branding, text, logos, leather patches, or visible undergarments.
```

---

## Diff vs current active vault (at-a-glance)

**M01:**
- REMOVED: "Waist-to-ankle crop only — the top edge of the frame cuts across the hip, no head, face, chest, or shoulders visible."
- REMOVED: "A {top_description} is visible at the very top of the frame, just above the waistband. The waistband and belt loops are fully visible."
- REMOVED: "The {garment_type} hem length and drape match the fit-model reference photos exactly — if the reference shows the hem pooling on or near the floor, reproduce that pool; if it shows a clean break at the ankle, match that instead." (merged into the new HEM block with the explicit front=back rule)
- REMOVED: "Stance: subtle contrapposto, weight gently on one leg, hip-width stance, both feet parallel to the camera line, both heels flat on the floor."
- ADDED: CROP block (navel-to-floor), LAYERING block (V2 tuck), HEM block (fit-model reference + front=back), STANCE block (dead-neutral two-foot).

**M02:**
- REMOVED: "Waist-to-ankle crop only — the top edge of the frame cuts across the lower back near navel height, no head, upper back, shoulders, or chest visible."
- REMOVED: "A {top_description} is visible at the very top of the frame, just above the waistband. The waistband and belt loops are fully visible."
- REMOVED: "CRITICAL — EXTRA-LONG INSEAM: These {garment_type} have an inseam 4 inches LONGER than the model's legs..." (garment-specific, was forcing floor-pool for every M02 regardless of actual garment — replaced by fit-model reference rule).
- REMOVED: "Stance: standing straight and symmetric, feet parallel and shoulder-width apart, weight evenly distributed on both legs, no hip tilt, no knee bend. Arms relaxed at the sides."
- ADDED: CROP block, LAYERING block, HEM block (fit-model reference + front=back), STANCE block.

---

## Validation plan

Once you sign off on the wording:

1. Open `/prompt-vault` in Chrome → filter to Seedream → open active M01 → save a new revision with the text above → mark active.
2. Same for M02.
3. Run one test job on a known garment (either D27463 or whatever is loaded in job `VEY5wiSJOOhCad8gD42Z`) so we can compare M01 + M02 before vs after on identical inputs.
4. If the render is off, revert by reactivating the previous revision — no code, no deploy involved.

Ready to push to `/prompt-vault` once you sign off on the wording.
