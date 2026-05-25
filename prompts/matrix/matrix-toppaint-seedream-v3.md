# Top-paint pass 2 — top-focus M01/M02 (Seedream) — v3

## Purpose
Pass 2 of the two-Seedream-call top-focus pipeline. Pass 1 produces a full-body
render with correct pants + sports bra placeholder. Pass 2 (this prompt)
replaces the bra with the chosen top, untucked, hem visible as outer layer
over the pants waistband.

v3 evolves v2 with the discipline that fixed pass-1 (step 6 → 8 progression):
- 1-sentence positive augmentation: single-instance + view-anchor + framing
- Silent-anchor ref pattern (pass-1 output repeated at slot 4) to suppress twins

## Architecture context
- **IMAGE 1** = pass-1 Seedream output (full-body, correct pants, bra still on torso). 4K square.
- **IMAGE 2** = top flat-front (color/texture authority — view-agnostic, used for both M01 and M02).
- **IMAGE 3** = top fit-model in matching view (fm.front for M01, fm.back for M02 — silhouette + drape + view authority).
- **IMAGE 4** = pass-1 output, repeated as silent anchor (mirror step 8 M01 + M02 anti-twin pattern, matrix-paint.ts:436).
- 4 refs total. Empty labels (seedream-client strips inventory).

## Placeholders
- `{topName}` — wardrobe top's `name`
- `{topDescription}` — wardrobe top's `topDescription || description || name`. Null-coalesce in caller: if missing, drop the second sentence entirely (don't ship `The top is "X". .`).
- `{VIEW}` — `front` for M01 or `back` for M02.

## v3 Prompt

```
Replace the black sports bra in IMAGE 1 with the top shown in IMAGE 2 and IMAGE 3.

The top is "{topName}". {topDescription}

Render the top as the OUTER layer at the torso, hanging from the shoulders at the natural length shown in IMAGE 3 (fit-model). The bottom hem of the top sits IN FRONT OF the pants waistband from IMAGE 1 — fabric visible as a layer covering the waistband, with the pants emerging cleanly below the hem.

Take color, fabric texture, stripes / pattern, finish, and material from IMAGE 2 (flat product photo). Take silhouette, drape, sleeve shape, hem position on the body, view direction, and how the garment falls on the body from IMAGE 3 (fit-model).

Preserve every other pixel of IMAGE 1 exactly.

The output is a single-instance render of one model — the same model shown in IMAGE 1, in {VIEW} view, full body head-to-toe, centered horizontally.
```

## What changed v2 → v3

| | v2 | v3 |
|---|---|---|
| Closing line | "Render exactly one model in the frame. Single instance. No comparison layout, no side-by-side, no before-after." | **Replaced with step-7-validated augmentation sentence**: "single-instance render of one model — the same model shown in IMAGE 1, in {VIEW} view, full body head-to-toe, centered horizontally." |
| Refs | 3 (matrix base + 2 top refs) | **4 (added pass-1 output as silent anchor at slot 4)** — mirrors the step-8 M01 fix that took pass-1 from 5/8 → 8/8 |
| Anti-twin | Negative-style ("No comparison layout, no side-by-side, no before-after") | Positive-style + structural (silent anchor ref). Negative-style was LEARNING #55 risk. |
| Other | unchanged | per-ref scoping, positive layer-order, IMAGE 1 preservation — all kept verbatim from v2 |

## Why this should work

- **Pass-1 baseline is now reliably clean** (step 8 = 8/8). The pass-2 input is no longer the confounding factor.
- **Silent anchor pattern proven** on pass-1 (M02 always-anchored; M01 added at step 8 → fixed remaining twins). Applying same pattern to pass-2 should suppress pass-2 twins.
- **Single sentence augmentation proven** on pass-1 (step 6 → 7 jumped from 2/8 clean to 5/8 clean on the same refs).
- **Per-ref scoping kept verbatim** from v2 (LEARNING #56, #101). IMAGE 2 = material; IMAGE 3 = silhouette + view direction.
- **Layer-order language kept positive** (LEARNING #55). "OUTER layer", "IN FRONT OF", "emerging below". No "DO NOT tuck".

## Risks I'm watching

1. **Pass-1 pants drift through pass 2.** Generative regen of IMAGE 1 might shift the pants. Per LEARNING #102, the structural fix is recomposite, not prompt. v3 doesn't add recomposite — flagged for the writeup.
2. **Top color drift on the Flowy Mock T-Shirt.** Even after the #184 Firestore fix (blush-pink → ecru), the top is a soft tonal color that may render with seasonal variance. Watch for it in A/B.
3. **Resort Boxy front-buttons leaking to M02 back.** Same risk as v2 (Flag 4 in v2 risks). IMAGE 2 = flat-front shows buttons; M02 should render the back without them. "View direction from IMAGE 3" is the defense. If buttons leak, that's where we restore "hardware" in IMAGE 2's list or further OUT-scope IMAGE 2.

## Validation plan

4 combos × 2 shirts × 2 views = 16 renders. ~19 min, ~$0.64.

Combos:
1. F1 × White leather low-top sneaker × Judee
2. F9 × Black leather chunky platform loafer × Midge Straight 52
3. F9 × Black leather chunky platform loafer × Bowey Barrel 53
4. F9 × Black leather chunky platform loafer × G-star Roxx wide

Shirts:
- Flowy Slim Mock T-Shirt (D28956-E513-1603, ecru/off-white sleeveless mock-neck cropped)
- Resort Boxy Relaxed Overshirt (D29076-D592-G459, light blue/white pinstripe cropped boxy button-front)

Pass-1 inputs: existing step8 outputs (already on disk, will upload to GCS for pass-2 input).

Per-render criterion:
- Correct top color + material + silhouette
- Top untucked, hem visible as outer layer
- Pants preserved from pass 1 (no drift)
- Single model, head visible, centered
- M02: no front-feature leak (buttons stay on M01 only)

Writeup: per-render visual tally, plus pants-drift count and any twin/composition regressions.

## What I'm NOT doing in v3

- No anti-X "DO NOT tuck / DO NOT comparison / DO NOT two-panel" language
- No "FAILURE MODE" enumeration block (LEARNING #101 trap)
- No length descriptors ("cropped", "boxy") — silhouette from IMAGE 3 visual
- No recomposite step yet — flagged as structural follow-up if v3 A/B shows pants drift
- No code change to matrix-paint.ts — A/B only; integration happens after v3 validates
