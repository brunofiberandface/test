# M06 — Bottom-focus free-pose (Seedream pipeline → Gemini-3-pro-image-preview)

## Purpose
Replaces vault rev 16 (which was hardcoded to the "Effortless Natural Standing" pose) with a fully placeholder-driven version that supports the M06 pose library (p01-p11) + threads garment description + silhouette so non-jeans garments (culottes, cargos, palazzo trousers, etc.) render correctly.

Used by `generateM06WithGemini()` in `src/lib/pipeline/gemini-m06.ts` when `focusSlot !== 'top'`.

## Why this revision
Vault rev 16 was never actually loaded by gemini-m06.ts — that module built its own hardcoded prompt inline with hardcoded "JEANS" / "denim" wording (16 occurrences). For non-jeans focus garments (e.g. Cargo trouser, Wrap-over wide-leg palazzo) the inline prompt instructed Gemini to render jeans regardless of the garment refs → low focus-garment fidelity. This rev moves the prompt into the vault + genericizes the garment language + threads silhouette.

## Placeholders consumed
- `{gender}` — "Male" / "Female" (via `injectGender`)
- `{model_description}` — model's identity description text (via new `injectM06Context`)
- `{pose_label}` — selected pose label, e.g. "Effortless Natural Standing"
- `{pose_description}` — selected pose body-geometry text from `m06-poses.ts`
- `{garment_type}` — wardrobe bottom item name (e.g. "Cargo trouser")
- `{bottom_description}` — full Opus garment description
- `{silhouette}` — Opus silhouette+fit analysis (width, length, hem behaviour)
- `{top_description}` — top description or fallback fragment (caller decides)
- `{shoes_description}` — shoes description

## Step 2 Prompt

```
Photorealistic studio e-commerce photograph, 1:1 square aspect ratio, full body view. Photorealistic, sharp focus across the entire subject, ultra-high detail, color accurate, neutral white balance, professional commercial studio quality.

═══ FRAMING — MANDATORY ═══
FULL-BODY composition with HEADROOM. The ENTIRE model is visible inside the frame from the very top of the head (including any hairstyle volume — top of the hair, crown, top of a ponytail / bun / updo) DOWN to the soles of the feet (heels touching the floor). There MUST be approximately 8-12% clear background ABOVE the top of the head before the frame's top edge — NEVER let the head, hair, scalp, or hairstyle volume touch or pass the top of the frame. There MUST be approximately 5-8% clear floor BELOW the heels before the frame's bottom edge — the heels never touch the bottom edge. The subject is centered horizontally. Reserve roughly equal background to the left and right of the body.

If the chosen pose would cause cropping, ZOOM OUT — make the model smaller within the frame rather than crop any part of the body.

═══ BACKDROP & LIGHTING ═══
Backdrop and floor: a single continuous smooth sweep of neutral light-grey (averaging hex #D9DAD2, with a subtle natural studio falloff from #DADBD3 at the top of the frame to #D7D8D0 at the floor), wrapping seamlessly from wall to floor across the entire 1:1 frame. Studio lighting is soft, fully diffused, white-balanced precisely to 5500K daylight, positioned from the front and slightly above eye level. Even illumination across the subject. A faint soft contact shadow rests naturally beneath the feet. The frame contains only the backdrop, the model, and the floor surface beneath the feet.

═══ IDENTITY (from IMAGE 2 + IMAGE 2B ONLY) ═══
The rendered model is the SAME PERSON as in IMAGE 2 and IMAGE 2B — a {gender} model with these specific attributes: {model_description}. Exact same skin tone with the SAME undertone and depth as IMAGE 2B (do NOT shift toward editorial warmth, do NOT shift paler or darker), exact same complexion, exact same hair color, hair length, and hair texture, exact same facial features, body proportions. The model in IMAGE 1 (if present) is a DIFFERENT person whose pose is being copied — the rendered model's identity does NOT take ANY attributes from IMAGE 1. If IMAGE 1's model has lighter skin, different hair, different ethnicity, or a different gender, the rendered model still has IMAGE 2 + IMAGE 2B's exact identity. The rendered model is {gender} — never invent a different gender.

═══ SKIN & FACE RENDERING — CRITICAL ═══
This is a documentary product photograph, not a glamour or fashion editorial. The model's face is rendered as completely natural and unretouched. NO makeup, NO blush, NO rouge, NO contour, NO bronzer, NO cosmetic color anywhere on the face. NO color grading or color enhancement applied to skin areas. The face is rendered raw, plain, and bare.

In the rendered output, the cheek apples are the SAME tone as the forehead and chin — no localized color shift, no makeup-style cheek accent, no rosy bloom on the cheekbones. The skin pigmentation is even and continuous across the entire face. The cheekbone area shows soft natural shadow modeling under even studio light, but the COLOR of the cheek is identical to the COLOR of the forehead.

The MODEL IDENTITY REFERENCE (IMAGE 2 + IMAGE 2B) is the exclusive authority for: skin tone, skin pigmentation, complexion, hair color, eye color, facial features, and the model's overall coloration.

The FIT MODEL REFERENCE photographs are real studio photography with their own particular lighting and color rendering baked into the source pixels. Use the fit-model photographs ONLY for the garment's fit, drape, silhouette, fabric behavior, and construction details. The fit-model photographs are NOT a source for skin tone, complexion, hair color, lighting tint, color rendering, or any aspect of the model's appearance — those come exclusively from the MODEL IDENTITY REFERENCE.

═══ POSE — FROM IMAGE 1 / TEXT BELOW ═══
The model in the rendered output is in EXACTLY the body pose specified below. Specifically:

1. **BODY ROTATION DEGREE — literal**: If a strict frontal stance (body squared to camera) is described, the rendered model is also strictly frontal — do NOT add a 3/4 turn. If a 30°, 45°, 60°, or 75° rotation away from camera is described, render that EXACT degree of rotation — do NOT soften toward frontal. Match the rotation precisely.

2. **HAND PLACEMENT — literal, no mirroring**: If the LEFT hand is in a pocket and the RIGHT hand is at the side, render the LEFT hand in the pocket and the RIGHT hand at the side. Do NOT flip or mirror.

3. **HANDS HIDDEN BEHIND BODY**: If hands are NOT visible from the front (tucked behind the body, behind the back, or in back pockets), the rendered model's hands are also HIDDEN behind the body — only the upper arms are visible falling slightly back from the shoulders.

4. **HEAD AND NECK ANGLE — copy precisely**: If the head is turned over the shoulder back toward the camera while the body faces away, render that exact head turn. The head can rotate independently of the body.

5. **GAZE DIRECTION — copy precisely**: Match the gaze direction described (at camera, upward off-lens, over shoulder, etc.). Do NOT default to a forward-camera gaze if the spec says otherwise.

6. **ASYMMETRY AND WEIGHT SHIFT**: Copy any subtle asymmetry — weight on one leg, slight hip tilt, slight diagonal lean. Do NOT smooth the pose toward perfect symmetry.

═══ POSE ARCHETYPE — {pose_label} ═══
{pose_description}

═══ {garment_type} — THE HERO GARMENT (from GARMENT FLAT + FIT MODEL ANGLES) ═══
The model wears the {garment_type} shown in the GARMENT FLAT and the FIT MODEL ANGLES. This is the focal garment in this shot — render it with MAXIMUM fidelity. Render EXACTLY the garment type described in the description below — if the description says "culotte", render a culotte (wide-leg, cropped); if "cargo trouser", render cargo (utility pockets, technical fabric); if "jeans" / "denim", render jeans. DO NOT default to jeans unless the description explicitly says so.

Garment description (authoritative — read carefully): {bottom_description}

Silhouette & fit analysis (specifies the garment's WIDTH, LENGTH, FLOOR DISTANCE, HEM BEHAVIOUR — pay particular attention to width multipliers like "1.5x the hip", "3x the ankle", "extremely wide", "palazzo", "sweeping columns"): {silhouette}

DO NOT narrow the silhouette. DO NOT default to a slimmer / straighter / more conservative fit than what the spec describes. DO NOT invent pockets, hardware, layered bottoms, second waistbands, contrast bands, or any detail that is not present in the references OR the description above.

Match the {garment_type} EXACTLY:
- Color and finish: the precise tone, contrast, and surface character shown in the GARMENT FLAT.
- Hem treatment: per the silhouette analysis (cropped / cuffed / full-length / pooling / etc.). Match LITERALLY — no editorial drift.
- Fit profile: silhouette, leg opening, rise, and break exactly as shown in the FIT MODEL ANGLES.
- Hardware: button/snap/zip closure, rivets, pocket placement and shape, label position — all as shown in the GARMENT FLAT.
- Fabric finish: matte unless the description specifies otherwise. NO unwanted satin sheen, NO glossy editorial cast.

CRITICAL — the garment in IMAGE 1 (POSE REFERENCE) is NOT the target garment. IGNORE the bottom garment in IMAGE 1 completely (different garment, different model). The rendered model's bottom garment is EXCLUSIVELY the {garment_type} shown in the GARMENT FLAT + FIT MODEL ANGLES + the description above.

═══ TOP ═══
{top_description}

CLOTHING ISOLATION: The clothing visible in IMAGE 1 (if present) is NOT the rendered model's clothing. IGNORE everything the IMAGE 1 model wears on the upper body. The rendered upper body wears EXACTLY the top described above — nothing else, nothing extra.

═══ FOOTWEAR ═══
The model wears: {shoes_description}. Match this footwear description EXACTLY — material, color, sole shape, height, lacing/buckles, branding. The footwear shown in IMAGE 1 (if present) is NOT the rendered footwear — IGNORE that and render EXACTLY the shoes described. The model is NEVER barefoot.

═══ HEM ↔ FOOTWEAR LAYER ORDER ═══
Whenever the {garment_type}'s hem reaches or extends past the top of the shoe:
- The pant fabric is the OUTER layer; the shoe is the INNER layer beneath it. The hem fabric drapes over and on top of the shoe, layered ABOVE the shoe upper.
- For lace-up shoes: laces and tongue sit beneath the pant fabric, partially or fully covered. The pant hem cascades onto the shoe vamp. The shoe sole, toe-box, and the front-most edge of the upper remain visible below.
- For boots (ankle, chelsea, knee-high, tall): the pant fabric falls OUTSIDE the boot shaft, draping down the exterior. The boot opening contains only the leg, NEVER the pant fabric.
- For sandals/slides/mules: pant fabric drapes over the foot and any straps in the same OUTER-layer relationship.

If the silhouette says the hem is shorter than the shoe top (e.g. cropped culotte + knee-high boots): the boot top is VISIBLE and the garment hem cleanly ends ABOVE it with a small gap.

═══ FAILURE MODES TO AVOID ═══
- WRONG: rendering a different model identity than IMAGE 2 + IMAGE 2B (any face, skin tone, or hair mismatch — skin tone in particular must match IMAGE 2B exactly).
- WRONG: mirroring the hands or rendering hands in front pockets when the spec says hidden behind body.
- WRONG: rendering the head facing forward when the spec says the head turns back.
- WRONG: rendering a direct camera gaze when the spec says the gaze is upward off-lens.
- WRONG: rendering a top other than what the TOP section above describes.
- WRONG: barefoot.
- WRONG: any part of the head, hair, scalp, or hairstyle being cut off, cropped, or touching the top edge of the frame. The head MUST sit at least 8% below the top edge with clear background visible above it.
- WRONG: heels or feet cut off or touching the bottom edge. There MUST be clear floor visible below the heels.
- WRONG: defaulting to jeans / denim wash drift when the {garment_type} is NOT jeans. Render the EXACT garment type from the description and refs.
- WRONG: tucking the {garment_type} hem INSIDE the footwear (boots etc). Hem always drapes over the OUTSIDE.
- WRONG: inventing a second waistband, peplum, sash, or styling layer not shown in the refs.

The pose MUST match the spec. The identity MUST match IMAGE 2 + IMAGE 2B ({gender} model, exact skin tone). The TOP MUST match the TOP section. The {garment_type} MUST match the description + refs (no jeans default unless garment is jeans). The footwear MUST match the FOOTWEAR section. These are non-negotiable.
```
