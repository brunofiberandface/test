# M02 — Matrix-paint bottom-focus back view (Seedream) — v6 (lean)

## Purpose
Rev 28 of the matrix-paint M02 prompt. Bruno's 60-word lean prompt verbatim,
validated against 3 distinctive garments in the BytePlus web UI (wide
cargo, wide barrel jeans, slim flare dark denim) — all 3 produced perfect
renders. Local A/B confirms the lean approach is much better than the
over-specified rev 27 on Bowey (3/3 wide barrel-ish) and Kate (3/3 clean
grey, no metallic). Cargo+M2 still drifts to jogger because of Seedream's
male+boots+cargo prior, but that's a known limitation — manual rerun or
Seedream 5.0 acceptable per Bruno 2026-05-18.

Replaces v5 (rev 27) which had ~5KB of TIER framework + GLOBAL_RULES +
silhouette injection + anti-cuff defenses + anti-crop defenses. Bruno's
hypothesis confirmed: that verbiage was drowning Seedream, not helping it.

## Architecture context
- IMAGE 1 = Tier-2 base (model in target shoes + placeholder pants).
- IMAGE 2 = fit-model straight back.
- No reference labels / inventory block prepended (seedream-client strips it).

## Placeholders
None. The lean prompt has no substitutions — visual evidence from the
fit-model image carries silhouette, length, color, hem treatment.

## Step 2 Prompt

```
Apply the fitmodel trousers onto the AI model with shoes. so merge the two images, but the trousers should be fully respected in form and fit. all details need to be preserved, IMPORTANT is the trousers run naturally down respecting the fitmodel lenght of the trousers. the model needs to stand equally on 2 feet, 50% on each foot, keeping the same position as the underwear model.
```
