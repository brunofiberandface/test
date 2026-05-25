# M01 — Matrix-paint bottom-focus front view (Seedream)

## Purpose
First vault revision of the matrix-paint M01 prompt (was previously hardcoded in `src/lib/pipeline/matrix-paint.ts`). Used by `matrixPaint()` when `shotType='M01'` and `focusSlot !== 'top'`. Front-view sibling of `matrix-m02-seedream-v1.md`.

## Architecture context
- IMAGE 1 = Tier-2 base (model already wearing target shoes + placeholder pants); preserve every pixel except the placeholder pants area.
- IMAGE 2 = flat front of the bottom garment (canonical colour/fabric/front-construction source — front pockets, fly, rivets).
- IMAGE 3 = fit-model straight front (drape on a body).

## Placeholders consumed
- `{garment_type}` — wardrobe item name
- `{bottom_description}` — full Opus garment description
- `{silhouette}` — Opus silhouette+fit analysis
- `{shoe_name}` — wardrobe shoe item name
- `{shoes_description}` — wardrobe shoe full description

## Step 2 Prompt

```
Photorealistic studio reference photo, 1:1 SQUARE crop, 4K resolution, FRONT VIEW, waist-down (legs + feet) of ONE SINGLE MODEL.

═══ SINGLE-MODEL LOCK ═══
The output frame contains EXACTLY ONE model. ONE person. ONE body. Single-instance render. NOT a comparison shot. NOT a multi-angle layout. NOT two copies of the same model side-by-side. The fit-model reference image shows the garment on a body for FIT REFERENCE ONLY — it is NOT an instruction to render multiple instances.

═══ THIS IS A NARROW EDIT — IMAGE 1 IS YOUR BLUEPRINT ═══
The output is IMAGE 1 with ONLY the placeholder bottom replaced. Every pixel of IMAGE 1 EXCEPT the placeholder pants area MUST be preserved exactly:
- Model identity (visible skin, body proportions): preserved from IMAGE 1.
- Footwear from IMAGE 1 ({shoe_name} — {shoes_description}): preserved 100% as-is. Same style, colour, material, position, height. Both feet visible.
- Foot placement, stance, gap between feet, body angle: preserved from IMAGE 1. The body in IMAGE 1 is squared to the camera with the front fully facing the lens — render the SAME stance, NOT a 45° turn.
- Background (light-grey studio sweep #D9DAD2), lighting, framing, camera angle, contact shadow: preserved from IMAGE 1.

═══ TARGET GARMENT — "{garment_type}" ═══
{bottom_description}

═══ SILHOUETTE & FIT — AUTHORITATIVE SOURCE FOR WIDTH, LENGTH, DRAPE, HEM ═══
The block below specifies the garment's width progression (at hip, thigh, knee, ankle, hem opening), length, floor distance, and hem behaviour. RENDER EXACTLY to these specifications. Pay particular attention to width multipliers like "1.5x the hip", "3x the ankle", "extremely wide", "palazzo", "sweeping columns" — those describe the FULL silhouette and must be rendered at the FULL specified width.

DO NOT narrow the silhouette. DO NOT default to a slimmer / straighter / more conservative fit than what the spec describes. If the spec says "extreme palazzo" → render extreme palazzo, NOT regular wide-leg. If the spec says "skinny" → render skinny, NOT slim-straight. The placeholder pants in IMAGE 1 (hot pants / boxer briefs) are NOT a guide to the target garment's width — they are placeholders to be replaced.

{silhouette}

═══ FIT-MODEL REFERENCES ═══
The model wears this {garment_type} as displayed in the flat-front (IMAGE 2) and fit-model front (IMAGE 3 when present). Use IMAGE 2 + IMAGE 3 as the EXCLUSIVE source of truth for the garment's identity — base colour, fabric texture and finish, all front-panel seam lines, fly, rivet placement, front-pocket geometry, and overall silhouette shape.

═══ STRICT REQUIREMENT — NO LAYERED BOTTOMS, NO STYLING PEEKING ═══
- The {garment_type} is the SOLE bottom garment in this render. NO SECOND PAIR OF PANTS, SHORTS, TROUSERS, or SKIRT layered behind, beneath, above, or alongside the {garment_type}.
- NO SECOND WAISTBAND visible — only the {garment_type}'s own waistband appears in the frame.
- NO STYLING GARMENT PEEKING OUT from above, behind, beside, or below the {garment_type}.
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
- DO NOT render a peplum, over-skirt, or draped panel hanging from the waistband.
- DO NOT render a second waistband, second pair of pants, or styling garment peeking out.
- DO NOT modify the footwear in any way — locked from IMAGE 1.
- DO NOT tuck the garment hem INSIDE the footwear (esp. boots). Hem always drapes over the OUTSIDE.
- DO NOT modify the model's identity, skin tone, body proportions, or pose. The stance in IMAGE 1 is squared to the camera (full front) — do NOT shift to a 45° angle.
- DO NOT change the background, lighting, or framing.
- DO NOT add belts, socks, accessories.
- DO NOT show the model barefoot.
```
