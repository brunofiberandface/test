# M02 — Matrix-paint bottom-focus back view (Seedream) — v2

## Purpose
Rev 24 of the matrix-paint M02 prompt. Strengthens silhouette enforcement:
- {silhouette} block PROMOTED to top (after SINGLE-MODEL LOCK), before IMAGE 1
  description, so width-progression numbers are the FIRST instruction Seedream
  sees about garment geometry.
- Explicit anti-narrowing wording around the placeholder bottoms in IMAGE 1.
- Explicit colour anchor: quote the {bottom_description}'s colour phrase.

Triggered by F9 / Bowey Barrel rendering SKINNY despite silhouette block
saying "1.8x thigh, 2.2x knee, NOT skinny" (LEARNING #97: visual evidence
from the matrix-base placeholder beats deep-in-prompt text rules). Theory:
front-loading the width spec gives Seedream the geometry BEFORE it locks onto
the placeholder's slim profile.

## Architecture context
- IMAGE 1 = Tier-2 base (model already wearing target shoes + placeholder pants); preserve every pixel except the placeholder pants area.
- IMAGE 2 = fit-model straight back (the ONLY back-view garment reference — trousers never have a flat back in this catalogue; the 45° angles were tested but caused body-pose rotation drift in the render, reverted to 1 ref).
- No flat reference for back view: passing the front flat polluted renders with front pockets / fly / wrap-over closure (visual evidence beats text rules — LEARNING #97).

## Placeholders consumed
- `{garment_type}` — wardrobe item name (e.g. "Wrap-over wide leg tailored trouser")
- `{bottom_description}` — full Opus garment description
- `{silhouette}` — Opus silhouette+fit analysis (width progression, length, hem behaviour, floor distance)
- `{shoe_name}` — wardrobe shoe item name
- `{shoes_description}` — wardrobe shoe full description

## Step 2 Prompt

```
Photorealistic studio reference photo, 1:1 SQUARE crop, 4K resolution, BACK VIEW, waist-down (legs + feet) of ONE SINGLE MODEL.

═══ SINGLE-MODEL LOCK ═══
The output frame contains EXACTLY ONE model. ONE person. ONE body. Single-instance render. NOT a comparison shot. NOT a multi-angle layout. NOT two copies of the same model side-by-side. The fit-model reference images show the garment on a body for FIT REFERENCE ONLY — they are NOT an instruction to render multiple instances.

═══ GARMENT GEOMETRY — READ FIRST, BEFORE LOOKING AT ANY IMAGE ═══
The garment you must render is "{garment_type}". Its geometry is specified in numbers below. Lock these numbers in your output BEFORE you reference any image:

{silhouette}

The block above is the authoritative source for WIDTH at every leg point (hip, thigh, knee, calf, ankle, hem), LENGTH, FLOOR-DISTANCE, and HEM BEHAVIOUR. Render EXACTLY to these specifications. Width multipliers like "1.5x the hip", "1.8x the thigh", "2.2x the knee", "extremely wide", "palazzo", "barrel", "sweeping columns", "boyfriend" describe the FULL silhouette and MUST be rendered at the FULL specified width.

DO NOT narrow the silhouette. DO NOT default to a slimmer / straighter / more conservative fit than what the spec describes. If the spec says "barrel" → render barrel, NOT slim-straight. If the spec says "extreme palazzo" → render extreme palazzo, NOT regular wide-leg. If the spec says "boyfriend / relaxed / loose" → render loose with the multipliers specified, NOT a slim fit. If the spec says "skinny" → render skinny, NOT slim-straight.

PLACEHOLDER-PANTS DISCLAIMER: IMAGE 1 (described next) shows the model in hot pants / boxer briefs that hug the skin. Those placeholder bottoms have NEAR-ZERO width past the body outline. The TARGET garment's width may be 2x, 3x, or more times wider than the placeholder at every point below the waistband. DO NOT use the placeholder's leg profile as any kind of guide to the target's width — use ONLY the {silhouette} numbers above.

FIT-MODEL DISCLAIMER: IMAGE 2 (described later) is worn on a SLIM body. The fit model's body proportions do NOT determine the garment's width — the garment may sit far away from the fit-model's leg. The {silhouette} block above is the truth; read the multipliers and render the garment with the air-gap between fabric and leg the multipliers imply.

═══ THIS IS A NARROW EDIT — IMAGE 1 IS YOUR BLUEPRINT (except for the pants) ═══
The output is IMAGE 1 with ONLY the placeholder bottom replaced. Every pixel of IMAGE 1 EXCEPT the placeholder pants area MUST be preserved exactly:
- Model identity (visible skin, body proportions): preserved from IMAGE 1.
- Footwear from IMAGE 1 ({shoe_name} — {shoes_description}): preserved 100% as-is. Same style, colour, material, position, height. Both feet visible.
- Foot placement, stance, gap between feet, body angle: preserved from IMAGE 1.
- Background (light-grey studio sweep #D9DAD2), lighting, framing, camera angle, contact shadow: preserved from IMAGE 1.

═══ POSE / STANCE LOCK — CRITICAL ═══
The model's pose, body rotation, and stance come EXCLUSIVELY from IMAGE 1. IMAGE 1 shows the model standing with the back SQUARED to the camera (shoulders horizontal and parallel to the image plane, hips horizontal, both feet flat and pointing directly away from the camera, weight 50/50). The rendered output uses EXACTLY this stance — straight back, full back facing the lens, zero rotation toward either side.

The fit-model reference photo (IMAGE 2) may show the fit-model at a slightly rotated angle. THE POSE / BODY ANGLE / HIP TILT / WEIGHT SHIFT / HAND POSITION / HEAD TURN IN IMAGE 2 IS NOT THE TARGET POSE. IMAGE 2 exists ONLY to show the garment's back-panel construction and colour. Body angle is taken EXCLUSIVELY from IMAGE 1.

FAILURE MODE — WRONG: rendering the model rotated 30° / 45° / any non-frontal angle. The rendered model is STRAIGHT BACK matching IMAGE 1, regardless of the fit-model's angle in IMAGE 2.

═══ TARGET GARMENT — "{garment_type}" — COLOUR / FABRIC / CONSTRUCTION ═══
{bottom_description}

The colour phrase in the description above IS the rendered colour. If the description says "medium indigo wash" → render medium indigo, NOT pale blue, NOT dark navy, NOT gunmetal, NOT metallic. If the description says "sun faded gunmetal — warm grey-toned medium wash" → render warm-grey denim, NOT gold, NOT bronze, NOT metallic shimmer. If the description says "black" → render black, NOT charcoal, NOT brown. Use the fit-model BACK image (IMAGE 2) as the SAMPLE — match the IMAGE 2 colour exactly.

═══ FIT-MODEL REFERENCE — BACK CONSTRUCTION + COLOUR SOURCE OF TRUTH ═══
The model wears this {garment_type} as displayed in the fit-model BACK photograph (IMAGE 2). Use that fit-model photo as the EXCLUSIVE source of truth for the garment's colour (sample the denim / fabric tone directly from IMAGE 2 — do NOT shift toward metallic / gold / bronze / wet-look unless the photo itself shows that), fabric texture and finish, all back-panel seam lines, waistband and back-yoke construction (whatever shape and style the photo shows — a curved jean yoke, a flat tailored waistband, or any other), belt-loop positioning and spacing, the actual back-detail construction (patch pockets, welt pockets, flap pockets, or no pockets — render only what the photo shows).

WIDTH / SILHOUETTE comes from the {silhouette} block above (not from the fit-model's body — the fit-model is slim; the garment may billow with air between fabric and leg).

Reminder: any styling element visible in IMAGE 2 that is NOT part of the garment construction (a sash arranged as a peplum across the back, hand position, hair drape over the trousers, a tucked-in look that doesn't belong) is a one-day styling artifact, NOT part of the {garment_type}. Refer to the garment description + silhouette text above to distinguish actual construction from one-day styling.

═══ STRICT REQUIREMENT — NO LAYERED BOTTOMS, NO STYLING PEEKING ═══
- The {garment_type} is the SOLE bottom garment in this render. NO SECOND PAIR OF PANTS, SHORTS, TROUSERS, or SKIRT layered behind, beneath, above, or alongside the {garment_type}.
- NO SECOND WAISTBAND visible — only the {garment_type}'s own waistband appears in the frame.
- NO STYLING GARMENT PEEKING OUT from above, behind, beside, or below the {garment_type}. This includes: NO peplum / over-skirt / draped panel hanging from the waistband across the back, NO sash visible as a separate garment layer over the trousers (any wrap or tie that IS part of the {garment_type} stays integrated into the waistband / front closure, not draped across the back as a peplum), NO contrast band, NO exposed belt loop or fabric strip from a different layer.
- The space immediately above the {garment_type}'s waistband shows ONLY tucked top fabric (or, in this waist-down crop, bare midriff that the next pipeline stage repaints) — no other garment, no contrast band, no second waistband stacked behind.
- Apply regardless of the {garment_type}'s material — whether denim, wool, twill, velvet, or any other fabric, the {garment_type} is the only bottom garment present.

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
- DO NOT default to a SLIM/SKINNY/STRAIGHT silhouette when the {silhouette} block describes wider geometry (barrel, palazzo, wide-leg, boyfriend, loose, relaxed). Render the FULL specified width.
- DO NOT shift the colour toward metallic / gold / bronze / wet-look / shimmer unless the fit-model photo (IMAGE 2) itself shows that finish. Sample colour from IMAGE 2.
- DO NOT render a peplum, over-skirt, or draped panel hanging from the waistband.
- DO NOT render a second waistband, second pair of pants, or styling garment peeking out.
- DO NOT modify the footwear in any way — locked from IMAGE 1.
- DO NOT tuck the garment hem INSIDE the footwear (esp. boots). Hem always drapes over the OUTSIDE.
- DO NOT modify the model's identity, skin tone, body proportions, or pose. The stance in IMAGE 1 is squared to the camera (full back) — do NOT shift to a 45° angle.
- DO NOT change the background, lighting, or framing.
- DO NOT add belts, socks, accessories.
- DO NOT show the model barefoot.
```
