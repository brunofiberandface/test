# Hybrid Leather Label — Option B (Three-Tier) — Ready to Deploy

**Status:** Full 3-tier port is in. Gate added. `tsc --noEmit` clean. **Nothing deployed.** Waiting on you.

## TL;DR — What ships when you deploy

- Back shots (M02 / M04) get the hybrid-label composite **only** for garments that have a saved `labelStyles` + `labelColorways` pair resolvable from their `designNumber`.
- Garments **without** saved setup render exactly like today — no negative prompt, no composite.
- Kill switch: `ENABLE_HYBRID_LABEL_AUTO=0` on the Cloud Run service disables the whole path without a redeploy.

## Deploy command (your terminal — Desktop Commander can't survive the 5–8 min build)

```bash
cd "/Users/bdheedene/Documents/Claude folder.nosync/gstar/gstar-studio" && \
/Users/bdheedene/google-cloud-sdk/bin/gcloud run deploy gstar-ai-studio \
  --source . \
  --region europe-west1 \
  --project gstar-ai-studio
```

## What's in the branch (this session)

### New API routes
- `GET /api/label/templates` + `POST /api/label/templates` — list / upsert templates
- `GET /api/label/templates/[templateId]` — fetch one
- `GET /api/label/styles/[styleCode]` + `PUT` — geometry tier with 4-point quad validation
- `GET /api/label/colorways/[docId]` + `PUT` — color delta tier (`${styleCode}_${colorwayCode}`)
- `GET /api/label/bootstrap` + `POST` — idempotent `L2936-8.0` template seed
- `GET /api/label/image-proxy?url=...` — CORS proxy for canvas color sampling

### New lib files
- `src/lib/label-render.ts` — homography (pure TS 4-point DLT via 8×8 Gauss elimination), asset URL resolution, config bridge
- `src/lib/pocket-detector.ts` — Gemini 2.5 Flash Lite pocket corner detection (strict JSON-only prompt, bounds clamp, <20px reject)
- `src/lib/label-auto.ts` — `applyAutoHybridLabel()` — single entry point called from generate route. Reads `ENABLE_HYBRID_LABEL_AUTO` (default ON). **All failure paths return original buffer. Never throws.**
- `src/lib/design-number.ts` — `parseDesignNumber()` / `styleAndColorwayOf()` — `D22889-D933-H087` splitter
- `src/lib/label-hybrid.ts` — existing wrapper around `scripts/label_hybrid.py`, unchanged this session

### New setup UI
- `src/app/wardrobe/[id]/label-setup/page.tsx` (~1280 lines) — React port of `label_POC/wardrobe_mockup/index.html`
  - 4-photo picker (`fitModels.back`, `back45Left`, `back45Right`, `flatBackUrl`)
  - Pan/zoom canvas with 8 draggable corner points (pocket quad + label quad)
  - 5×5-pixel color sampler via `getImageData()` — uses `/api/label/image-proxy` for CORS
  - Grain variant selector + emboss slider
  - Luminance-preserving multiply tint live preview
  - Dual PUT save → `labelStyles` + `labelColorways`
  - Auto-bootstraps `L2936-8.0` template on first load
  - `designNumber` must parse or save is blocked

### Wardrobe detail panel
- `src/app/wardrobe/page.tsx` — added **"Configure leather label →"** button, shown only when `category === 'bottom'` and `designNumber` parses

### Pipeline wiring
- `src/app/api/generate/route.ts` — M02/M04 post-process now calls `applyAutoHybridLabel()` at 78% progress
- `src/lib/pipeline/generate.ts` —
  - Added `LABEL_NEGATIVE_PROMPT` constant + `appendLabelNegative()` helper
  - Added `hasLabelConfigForItem(focusItem)` gate — parses designNumber, calls `resolveLabelRenderConfig()`, returns true only if all three tiers exist. Never throws.
  - Wrapped three back-shot `finalPrompt` assignments (M04-dressed, M04-legacy, M02-legacy) with the gate: `if (hasLabel) finalPrompt = appendLabelNegative(finalPrompt)`
  - Each site logs `labelGate=true|false` for Cloud Run observability
  - **M05 is intentionally NOT wrapped** — pocket close-up has no composite pass, Gemini should draw its best-effort label

## The gate — why it matters

Previously the negative prompt was unconditional: every back shot got "don't draw label text". That meant for garments without saved setup, the pocket would come back as a plain unlettered leather patch (no Gemini label, no shader label). That's a visible regression on every back shot the moment you deploy.

With the gate in:
- `labelStyles/${styleCode}` + `labelColorways/${styleCode}_${colorwayCode}` both exist → add negative prompt + run shader
- Either missing → no negative prompt + no shader → back shot identical to today

The gate predicate is the same one the shader uses, so prompt and composite stay locked together. No orphan state.

Cost of the gate: one extra Firestore read per back shot (two or three if the first tier misses). Marginal (~€0.0001/doc).

## After deploy — what to do

1. **Smoke check** — hit the service root, make sure revision serves:
   ```bash
   curl -I https://gstar-ai-studio-674145888056.europe-west1.run.app
   ```
2. **Run a regression test** — any existing job should produce M02/M04 identical to before, because no garment has saved setup yet. Check Cloud Run logs for `labelGate=false` on all back shots:
   ```bash
   gcloud run services logs read gstar-ai-studio \
     --region=europe-west1 --limit=200 --project=gstar-ai-studio \
     | grep -iE "labelGate|label|hybrid"
   ```
3. **Configure one garment end-to-end**:
   - Open `/wardrobe` → pick a `bottom` with a valid `designNumber` (e.g. `D22889-D933-H087`)
   - Click **Configure leather label →**
   - Let the bootstrap seed `L2936-8.0` on first load
   - Pick a back fit-model photo as anchor
   - Place pocket quad + label quad corners
   - Sample the leather color from the photo
   - Pick grain + emboss strength
   - Save
4. **Run an M04 job** for that garment. Check the logs for:
   - `[Generate] M04 (...) labelGate=true`
   - `[LabelHybrid] Python + OpenCV available`
   - `[LabelAuto] applying hybrid leather label (...)`
   - `[LabelHybrid] composited NN bytes`
5. **Inspect the M04 output** — label should be clean text from the template, embossed onto the tinted grain tile.
6. **If it looks wrong, DON'T patch live.** Pull logs, come back, we diagnose.

## Rollback options (no redeploy needed)

**Kill the whole auto-label path:**
```bash
gcloud run services update gstar-ai-studio \
  --region europe-west1 --project gstar-ai-studio \
  --set-env-vars ENABLE_HYBRID_LABEL_AUTO=0
```
Values that count as OFF (case-insensitive): `0`, `false`, `off`, `no`.

**Revert a single broken garment's config:**
Delete the `labelStyles/${styleCode}` doc in Firestore. The gate immediately flips that garment to unconfigured on the next job.

**Nuclear escape hatch:**
`POST /api/shots/[id]/apply-label` — manual label application for already-generated shots.

## Verification done this session

| Check | Result |
|---|---|
| `./node_modules/.bin/tsc --noEmit` | clean, exit 0 |
| `applyAutoHybridLabel` failure isolation audit | every error path returns original buffer |
| Gate predicate matches shader predicate | yes, both use `resolveLabelRenderConfig` |
| Wardrobe detail link visibility guard | only `bottom` + parseable `designNumber` |
| Negative prompt M05 exclusion | confirmed — M05 has no gate wrap |

## What was NOT done (still on the backlog)

1. **Runtime smoke test against a real shot** — nobody has executed `applyAutoHybridLabel` end-to-end yet. First run will be in prod. Failure isolation is belt-and-braces, so worst case is today's output, not a crash.
2. **Multi-template support** — only `L2936-8.0` is seeded. Adding a new physical label SKU means: (a) upload artwork + tile to `public/label-assets/`, (b) POST to `/api/label/templates`, (c) reference it in new `labelStyles` docs.
3. **SKILL.md update** — the `.claude/skills/gstar-studio/SKILL.md` mount is read-only in this session. See `docs/SKILL-UPDATE-HYBRID-LABEL.md` for the replacement text to paste manually.
4. **Memory headroom verification** — current `--memory=2Gi`. Python + OpenCV + numpy on 3K×5K images could peak around 1.5 GB. Bump to 4Gi if you see OOM in logs.
5. **Status badge on wardrobe cards** — would need a batch endpoint like `POST /api/label/styles/status` that takes a list of styleCodes and returns `{[styleCode]: boolean}`. Skipped for now; the link visibility is enough signal in the detail panel.

## Files changed / added (this session, relative to HEAD)

**Modified (tracked):**
- `src/lib/pipeline/generate.ts` — negative prompt + gate
- `src/app/api/generate/route.ts` — post-process hook
- `src/app/wardrobe/page.tsx` — label-setup link

**New (untracked):**
- `src/app/api/label/templates/route.ts`
- `src/app/api/label/templates/[templateId]/route.ts`
- `src/app/api/label/styles/[styleCode]/route.ts`
- `src/app/api/label/colorways/[docId]/route.ts`
- `src/app/api/label/bootstrap/route.ts`
- `src/app/api/label/image-proxy/route.ts`
- `src/lib/label-auto.ts`
- `src/lib/label-render.ts`
- `src/lib/pocket-detector.ts`
- `src/app/wardrobe/[id]/label-setup/page.tsx`
- `LABEL-STRATEGY.md` (rewrite)
- `NEXT-STEP.md` (this file, rewrite)
- `docs/SKILL-UPDATE-HYBRID-LABEL.md` (patch for the read-only skill file)
