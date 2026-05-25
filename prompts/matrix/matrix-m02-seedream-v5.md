# M02 — Matrix-paint bottom-focus back view (Seedream) — v5

## Purpose
Rev 27 of the matrix-paint M02 prompt. Length reinforcement on top of v4
(rev 26). v4 successfully killed the jogger-cuff bug (FXulcOtw Cargo M02 v2
was no-cuff straight-cut wide hem) but overcorrected the length: the same
shot came out as a mid-calf cropped culotte instead of the spec's "long,
pooling over the shoes". Seedream resolved the conflict between
"no cuff" + "must drape over shoe" by shortening to mid-calf so there's no
hem-vs-shoe interaction to render at all.

This rev adds a dedicated LENGTH block right after silhouette and reframes
the hem block to enforce ankle-or-below minimum length. The no-cuff
language stays — both rules must hold simultaneously.

## Architecture context
- IMAGE 1 = Tier-2 base (model in target shoes + placeholder pants); preserve every pixel except the placeholder pants area.
- IMAGE 2 = fit-model straight back (the ONLY back-view garment reference for trousers in this catalogue).

## Placeholders consumed
- `{garment_type}` — wardrobe item name
- `{bottom_description}` — full Opus garment description
- `{silhouette}` — Opus silhouette+fit analysis (width progression, length, hem behaviour)
- `{shoe_name}` — wardrobe shoe item name
- `{shoes_description}` — wardrobe shoe full description

## Step 2 Prompt

```
Photorealistic studio e-commerce photograph, 1:1 SQUARE crop, 4K resolution, BACK VIEW, waist-down (legs + feet) of ONE SINGLE MODEL.

═══ POSE CANON ═══
Canonical G-Star ECOM back stance: parallel feet shoulder-width apart, both feet flat with toes pointing directly away from the camera, legs straight (no bent knees, no locked knees), hips and shoulders square and parallel to the image plane (zero rotation, zero tilt), weight 50/50, arms relaxed at the sides with a small natural gap from the torso. The output preserves IMAGE 1's exact stance.

NO contrapposto. NO weight shift. NO hip tilt or pop. NO knee bend. NO wide stance. NO turned body. NO crossed feet. NO foot-in-front-of-the-other staggered placement.

═══ TARGET GARMENT — "{garment_type}" ═══
{bottom_description}

The colour phrase in the description above IS the rendered colour. If the description says "medium indigo wash" → render medium indigo. If "sun faded gunmetal — warm grey-toned medium wash" → warm-grey denim, NOT gold/bronze/metallic. If "black" → black. Use IMAGE 2 as the colour sample — match its tone exactly. Do NOT shift toward metallic, gold, bronze, wet-look, or any shimmer finish unless IMAGE 2 itself shows it.

═══ SILHOUETTE — AUTHORITATIVE SOURCE FOR WIDTH, LENGTH, DRAPE, HEM ═══
{silhouette}

Render EXACTLY to the width progression numbers above. Width multipliers like "1.5x the hip", "1.8x the thigh", "2.2x the knee", "extreme palazzo", "barrel", "boyfriend", "wide-leg" describe the FULL silhouette and MUST be rendered at the FULL specified width. Do NOT narrow the silhouette. Do NOT default to a slimmer fit than what the spec describes. If the spec says "barrel" → render barrel, NOT slim-straight. If the spec says "extreme palazzo" → render extreme palazzo, NOT regular wide-leg. The placeholder pants in IMAGE 1 (hot pants / boxer briefs) hug the skin — their leg width is NOT a guide to the target garment's width.

═══ LENGTH — NEVER CROP TO AVOID HEM-VS-SHOE CONFLICTS ═══
The garment LENGTH is set by the {silhouette} block above (its HEM-TO-GROUND section). That length is non-negotiable — do NOT shorten the garment to avoid a hem-meets-shoe rendering decision.

Unless {silhouette} explicitly specifies a cropped / shortened length (e.g. "cropped culotte", "ankle-grazer", "cuffed at calf"), the garment extends DOWN PAST the ankle bone AT MINIMUM. For trousers described as "long", "full length", "pooling", "cascading", "puddles at floor", "covers the shoes": render the FULL length — the hem reaches the shoe AND cascades over it AND extends past it as the spec specifies.

FAILURE MODE — WRONG: rendering the garment as a mid-calf cropped wide-leg pant to sidestep the hem-vs-shoe problem. If the hem must drape over the shoe, render that drape. Do not crop to avoid it.

═══ HEM BEHAVIOUR — DRAPES OVER SHOE EXTERIOR ═══
At the length specified by {silhouette}, the hem rests on or extends past the top of the shoe ({shoe_name}: {shoes_description}). The garment fabric is the OUTER layer — it drapes over the exterior of the shoe with natural soft folds, NOT cuffed, NOT tucked, NOT cinched, NOT elasticated, NOT gathered with a drawstring at the ankle.

UNLESS {silhouette} explicitly says the garment has an elasticated cuff / cinched ankle / drawstring hem, the hem is a clean straight unstructured edge. The presence of a drawstring at the WAIST does NOT mean there is a drawstring at the ANKLE.

For boots specifically: the pant hem falls down the OUTSIDE of the boot shaft — boot top is COVERED by the pant fabric, never tucked INTO the boot opening. No airborne gap between hem and shoe.

═══ STRICT REQUIREMENTS ═══
- The {garment_type} is the SOLE bottom garment. NO second pair of pants, shorts, trousers, or skirt layered behind/beneath/above. NO second waistband visible. NO peplum / over-skirt / draped panel hanging from the waistband across the back. NO sash visible as a separate garment layer.
- The space immediately above the {garment_type}'s waistband shows ONLY tucked top fabric or bare midriff — no other garment, no contrast band.
- Do NOT invent pockets, yokes, hardware, washes, fades, layered waistbands, peplums, contrast bands, or any detail that is not present in IMAGE 2 OR the silhouette description.
- Do NOT default to JEANS unless the garment description says "jeans" or "denim". Render the EXACT garment type described.
- Do NOT default to JOGGER CUFFS (elasticated ankle, cinched hem with drawstring) unless the garment description or silhouette explicitly says so. A drawstring at the waist is not a drawstring at the ankle.
- Do NOT crop the garment length to avoid the hem-meets-shoe rendering challenge — render the full specified length WITH the appropriate drape over the shoe.
- Do NOT render more than one model. Do NOT render a comparison / before-after / multi-angle layout.
```
