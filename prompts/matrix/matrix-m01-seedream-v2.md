# M01 — Matrix-paint bottom-focus front view (Seedream) — v2

## Purpose
Rev 22 of the matrix-paint M01 prompt. Streamlined to complement the
ByteDance TIER framework in matrix-paint.ts ref labels (deployed rev
00591-5hh, 2026-05-18). The TIER framework handles "what each image
is" + identity/pose/EDIT ZONE preservation rules. This vault prompt
focuses on what the OUTPUT should look like: silhouette accuracy,
colour anchoring, hem behaviour, canonical neutral pose.

Replaces v1 (rev 21) which was a 6650-char disclaimer-heavy prompt
that duplicated rules now handled by the TIER ref labels.

## Architecture context
- IMAGE 1 = Tier-2 base (model in target shoes + placeholder pants).
- IMAGE 2 = flat front of the garment (canonical colour/fabric/construction).
- IMAGE 3 (when available) = fit-model straight front (drape on a body).

## Placeholders consumed
- `{garment_type}` — wardrobe item name
- `{bottom_description}` — full Opus garment description
- `{silhouette}` — Opus silhouette+fit analysis
- `{shoe_name}` — wardrobe shoe item name
- `{shoes_description}` — wardrobe shoe full description

## Step 2 Prompt

```
Photorealistic studio e-commerce photograph, 1:1 SQUARE crop, 4K resolution, FRONT VIEW, waist-down (legs + feet) of ONE SINGLE MODEL.

═══ POSE CANON ═══
Canonical G-Star ECOM front stance: parallel feet shoulder-width apart, both feet flat with toes pointing directly toward the camera, legs straight (no bent knees, no locked knees), hips and shoulders square and parallel to the image plane (zero rotation, zero tilt), weight 50/50, arms relaxed at the sides with a small natural gap from the torso. The output preserves IMAGE 1's exact stance.

NO contrapposto. NO weight shift. NO hip tilt or pop. NO knee bend. NO wide stance. NO turned body. NO crossed feet. NO foot-in-front-of-the-other staggered placement.

═══ TARGET GARMENT — "{garment_type}" ═══
{bottom_description}

The colour phrase in the description above IS the rendered colour. If the description says "medium indigo wash" → render medium indigo. If "sun faded gunmetal — warm grey-toned medium wash" → warm-grey denim, NOT gold/bronze/metallic. If "black" → black. Use IMAGE 2 (flat front) as the colour sample — match its tone exactly. Do NOT shift toward metallic, gold, bronze, wet-look, or any shimmer finish unless IMAGE 2 itself shows it.

═══ SILHOUETTE — AUTHORITATIVE SOURCE FOR WIDTH, LENGTH, DRAPE, HEM ═══
{silhouette}

Render EXACTLY to the width progression numbers above. Width multipliers like "1.5x the hip", "1.8x the thigh", "2.2x the knee", "extreme palazzo", "barrel", "boyfriend", "wide-leg" describe the FULL silhouette and MUST be rendered at the FULL specified width. Do NOT narrow the silhouette. Do NOT default to a slimmer fit than what the spec describes. If the spec says "barrel" → render barrel, NOT slim-straight. If the spec says "extreme palazzo" → render extreme palazzo, NOT regular wide-leg. The placeholder pants in IMAGE 1 (hot pants / boxer briefs) hug the skin — their leg width is NOT a guide to the target garment's width.

═══ HEM BEHAVIOUR ═══
The hem terminates where {silhouette} specifies (covering laces / mid-vamp / ankle bone / boot shaft / floor pool). Where the hem reaches the shoe, the garment fabric is the OUTER layer — it drapes over and on top of the shoe ({shoe_name}: {shoes_description}). For boots, the hem ends ABOVE the boot top and falls down the OUTSIDE of the boot, never INTO it. No airborne gap between hem and shoe.

═══ STRICT REQUIREMENTS ═══
- The {garment_type} is the SOLE bottom garment. NO second pair of pants, shorts, trousers, or skirt layered behind/beneath/above. NO second waistband visible. NO peplum / over-skirt / draped panel hanging from the waistband.
- The space immediately above the {garment_type}'s waistband shows ONLY tucked top fabric or bare midriff — no other garment, no contrast band.
- Do NOT invent pockets, yokes, hardware, washes, fades, layered waistbands, peplums, contrast bands, or any detail that is not present in IMAGE 2 (flat front), IMAGE 3 (fit-model front, when present), OR the silhouette description.
- Do NOT default to JEANS unless the garment description says "jeans" or "denim". Render the EXACT garment type described.
- Do NOT render more than one model. Do NOT render a comparison / before-after / multi-angle layout.
```
