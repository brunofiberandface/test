# Top-paint pass 2 — top-focus M01/M02 (Seedream) — v2

## Purpose
Pass 2 of the new two-Seedream-call top-focus pipeline. Pass 1 = the
existing fix-#1 matrix-paint call (5 refs: matrix base + 4 bottom refs)
producing a full-body render with the correct pants + the sports bra
still on the torso. Pass 2 (this prompt) takes that pass-1 output and
paints the chosen top over the bra, untucked, with the hem visible as
the outer layer in front of the pants waistband.

Replaces the legacy `applyTeeEdit` Gemini step for top-focus only.
Bottom-focus still uses `applyTeeEdit` unchanged.

## Architecture context
- **IMAGE 1** = pass-1 Seedream output (full-body, correct pants, bra still on the torso). 4K square.
- **IMAGE 2** = top flat — flat-front for BOTH M01 and M02 (color/texture authority is view-agnostic). For items without a flat-front (currently none in our test set), fall back to top fit-model.front.
- **IMAGE 3** = top fit-model (front for M01, back for M02 — supplies silhouette + the view direction the rendered output should match).
- No reference labels / inventory block prepended (seedream-client strips it).

## Placeholders
- `{topName}` — wardrobe top's `name` (e.g. "Resort Boxy Relaxed Overshirt")
- `{topDescription}` — wardrobe top's `topDescription || description || name`. Code-level: null-coalesce so that a missing description does NOT ship the line as `The top is "X". .` with a trailing period and empty string. If missing, drop the second sentence entirely (compose conditionally on the caller side).

## v2 Prompt

```
Replace the black sports bra in IMAGE 1 with the top shown in IMAGE 2 and IMAGE 3.

The top is "{topName}". {topDescription}

Render the top as the OUTER layer at the torso, hanging from the shoulders at the natural length shown in IMAGE 3 (fit-model). The bottom hem of the top sits IN FRONT OF the pants waistband from IMAGE 1 — fabric visible as a layer covering the waistband, with the pants emerging cleanly below the hem.

Take color, fabric texture, stripes / pattern, finish, and material from IMAGE 2 (flat product photo). Take silhouette, drape, sleeve shape, hem position on the body, view direction (front or back), and how the garment falls on the body from IMAGE 3 (fit-model).

Preserve every other pixel of IMAGE 1 exactly. The only change is the bra-and-bare-torso region becoming the top.

Render exactly one model in the frame. Single instance. No comparison layout, no side-by-side, no before-after.
```

## Why this language

- **"OUTER layer at the torso ... IN FRONT OF the pants waistband ... fabric visible as a layer covering the waistband, with the pants emerging cleanly below the hem"** — positive layer-order language per LEARNING #55 / #101. Avoids the "DO NOT tuck" trap that activates Seedream's tuck prior. Describes what the output looks like, not what it shouldn't be.
- **"natural length shown in IMAGE 3 (fit-model)"** — defers hem position to visual evidence rather than text. Per LEARNING #88, visual beats text. The Resort Boxy fit-model shows the hem at the hip; the Flowy Mock fit-model shows the hem at the waist. IMAGE 3 IS the spec.
- **"Take X from IMAGE 2 / Take Y from IMAGE 3"** — per-ref role scoping per LEARNING #56 / #101. IMAGE 2 (flat) is the material authority (view-agnostic); IMAGE 3 (fit-model) is the structural authority including view direction.
- **"view direction (front or back) ... from IMAGE 3"** — explicit assignment of view authority to IMAGE 3. Lets one prompt serve both M01 and M02 without branching: for M01 IMAGE 3 = fit-model.front; for M02 IMAGE 3 = fit-model.back. Seedream takes orientation from IMAGE 3 + IMAGE 1 (both same view), ignoring the front-facing flat in IMAGE 2.
- **"Preserve every other pixel of IMAGE 1 exactly"** — pass 2 is a NARROW edit; the pants pass already happened. Anchors the rest of the frame to IMAGE 1.
- **"Render exactly one model ... Single instance"** — anti-twin language, positive framing. Inherits the SINGLE-MODEL LOCK pattern from the working bottom-paint prompt. Fix #5 (silent-anchor ref) will further suppress.

## What changed v1 → v2

| | v1 | v2 |
|---|---|---|
| Y-coordinate sentence | included | **cut** (Seedream doesn't process coordinate math; preceding spatial sentence covers it) |
| Enumerated preservation list | "Preserve... the pants (color, wash, fit, waistband, pockets, hem at floor), the shoes, the studio backdrop, the model's face, hair, neck, arms, hands..." | "Preserve every other pixel of IMAGE 1 exactly." (each enumerated noun was a Seedream activation target per LEARNING #55) |
| "The top is the hero garment" | included | **cut** (filler; role implicit in "Replace the bra…") |
| "placeholder" qualifier | "the black sports-bra placeholder" | "the black sports bra" (Seedream doesn't know it's a placeholder; the word adds nothing) |
| "hardware" in IMAGE 2 list | included | **cut** (acceptable for v2 — restore in v3 IF buttons/snaps/closures render wrong in A/B for #176 or #181) |
| M02 IMAGE 2 ref source | flat-back if exists, else fit-model.back | **flat-front for both M01 and M02** (color/texture is view-agnostic — flat-front works for both views, no degenerate "both refs are the same image" case) |
| IMAGE 3's role | silhouette + drape | silhouette + drape + **view direction (front or back)** — IMAGE 3 is now the view authority |
| Word count | ~235 | ~140 |

## What I deliberately did NOT include

- **No "DO NOT tuck" anywhere.** That's the LEARNING #55 trap. The layering rule is expressed as positive composition ("OUTER layer", "IN FRONT OF", "emerging below").
- **No "FAILURE MODE" enumeration block.** Per LEARNING #101 — failure-mode noun dumps in the prompt body activate the very behaviors they enumerate.
- **No length / fit / "cropped vs long" verbiage.** Silhouette comes from IMAGE 3 visually. Text descriptors of length compete with the visual evidence.

## Risks I'm watching

1. **Strong learned prior: shirt + jeans → tucked.** This is the entire reason for the positive-layer framing. If v2 still tucks in A/B, strengthen the positive composition language before reverting to anti-X.
2. **Pants drift between pass 1 and pass 2.** Seedream is generative; "preserve every pixel" is advisory. If pants drift in A/B, the structural answer is recomposite per LEARNING #102 — flagged in the A/B writeup.
3. **Pass 2 may twin.** Adding 3 refs in a top-focus context is the same vector that triggered twins in 6/18 fix-#1 renders. Anti-twin language won't fully suppress until fix #5.
4. **Buttons / snaps / closures on M02.** For Resort Boxy (#176/#181), the visible front buttons are on IMAGE 2 (flat-front). On an M02 back render, those buttons should NOT appear on the back panel. The "view direction from IMAGE 3" scoping is the v2 defense. If buttons leak to back, that's where we'd restore "hardware" in IMAGE 2's list specifically — or further OUT-scope IMAGE 2 in v3.
5. **{topName} prior risk** (LEARNING #103). "Resort Boxy Relaxed Overshirt" pings overshirt prior; "Flowy Slim Mock T-Shirt" pings mock-tee prior. Visual evidence dominates; watch for "right category, wrong specifics" in A/B.

## What pass-1 prompt does NOT change

Pass 1 (fix #1) keeps using `buildBottomPaintPromptInline` with `isFullBody=true`. The `upperBodyClause` + `upperBodyForbidden` blocks still instruct pass-1 Seedream to PRESERVE the bra — exactly right, because pass 2 needs the bra in place to replace it.

## Validation plan

Same 3-garment A/B as fix #1: #176 (CONTOR + Resort Boxy), #181 (DARTT + Resort Boxy), #184 (CONTOR + Flowy Mock). Both M01 and M02. 3 seeds each. FULL pipeline (pass 1 + pass 2 + upper-body crop). 18 final renders. ~$1.50, ~45 min.

#184 topDescription has been fixed in Firestore (#184 fix shipped 2026-05-24 — Option A) so the A/B runs against clean data.

Pass criterion per garment: 3/3 final renders show
- correct pants (from pass 1)
- correct top color + material + silhouette + buttons / closures (from pass 2)
- top untucked, hem visible as outer layer over the pants waistband
- single model, head free, mid-femur crop

Writeup includes: garment fidelity tally, twin rate, pants-drift count (Flag 1 from review), audit count of polluted topDescription items (Flag 2 follow-up).
