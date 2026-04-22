# G-Star AI Studio — Label Composite Strategy

## The Problem

Gemini hallucinates brand labels, logos, and embroidered text on garments. No amount of prompt engineering fixes this — the model regenerates from concept instead of pixel-copying, and even its edit/inpainting mode is still a generation step. For a rigid leather label with precise typography, only a deterministic composite works.

## Current Solution — Hybrid Shader Pipeline (Option B)

The real label is never drawn by Gemini. After the back shot is generated, a Python/OpenCV shader tints a saved leather grain tile, warps it into the pocket area, and debosses the artwork from a height map. Text comes from the template PNG byte-for-byte, so drift is impossible by construction.

### Pipeline — runtime (per M02 / M04 back shot)

```
Gemini returns back-shot buffer
    ↓
hasLabelConfigForItem(focusItem)?  ← gate: template + style + colorway all present?
    ↓ NO                                              ↓ YES
ship as-is                        add LABEL_NEGATIVE_PROMPT to the next prompt
                                                      ↓
                                  applyAutoHybridLabel(buffer):
                                    ├─ detectPocketCorners() — Gemini 2.5 Flash Lite
                                    ├─ projectLabelCornersViaHomography()
                                    │     (4-point DLT, pure TS)
                                    ├─ resolveLabelRenderConfig()
                                    │     (template + style + colorway → flat render config)
                                    └─ applyHybridLabel() — Python/OpenCV subprocess
                                          ├─ tint grain tile toward baseColor (Lab space)
                                          ├─ warp tile into projected quad
                                          └─ Sobel deboss via template height map
    ↓
final buffer (original on any failure)
```

**Any failure → original buffer**. Label zone is belt-and-braces: unparseable designNumber, missing tier, bad corners, degenerate homography, Python unavailable, subprocess crash — every path logs and returns the original. A broken label can never block a shot from shipping.

### Three-Tier Firestore Schema

The entire point of Option B is that corners are saved ONCE per styleCode and reused by every colorway. Setup data factors cleanly:

| Collection | Doc ID | Holds |
|---|---|---|
| `labelTemplates` | `L2936-8.0` (physical label SKU) | artwork PNG URL, grain tiles per variant (pebbled/smooth/coarse), aspect ratio |
| `labelStyles` | `D22889` (styleCode) | templateId + anchor photo + **pocketCorners** + **labelCorners** (geometry setup) |
| `labelColorways` | `D22889_D933` (`${styleCode}_${colorwayCode}`) | base color, stitch color, grain variant, emboss strength (color delta only) |

`resolveLabelRenderConfig(styleCode, colorwayCode)` joins all three. If any tier is missing, the gate and the shader both silently skip the composite.

### Pocket-Anchor Homography

The saved `pocketCorners` are on the setup anchor photo (a real mannequin back view). The `labelCorners` are saved in the same coordinate space. At generate time:

1. Gemini detects the **new** pocket quad in the just-generated image.
2. We compute a 4-point homography from the saved pocket quad to the new pocket quad.
3. We apply the **same** transform to the saved label corners.
4. The shader draws into the projected label quad.

This handles pose drift, scale, rotation, and skew automatically — the label moves with the pocket. Pure TypeScript DLT via 8×8 Gauss elimination (`src/lib/label-render.ts`), no OpenCV SVD in the hot path.

### Hybrid Shader (Python/OpenCV)

`scripts/label_hybrid.py` via `src/lib/label-hybrid.ts`:

1. **Tint** — Lab-space luminance-preserving multiply of the grain tile toward `baseColor`. Dark leather stays dark, highlights stay bright, hue shifts to match the colorway. Strength driven by the tile's mid-grey normalization.
2. **Warp** — `cv2.getPerspectiveTransform()` + `cv2.warpPerspective()` with `INTER_LANCZOS4` into the projected quad.
3. **Deboss** — Sobel gradient on the template PNG's alpha/height channel, applied as a soft multiply on top of the tinted warp. Emboss strength is a per-colorway knob.

No Poisson / seamless clone (tried twice, failed twice: V1 orange bleed from hallucinated label underneath, V2 Poisson shifted brown to denim blue). Alpha blend with Gaussian edge feathering preserves exact colors.

### Negative Prompt (Gated)

When `hasLabelConfigForItem()` returns true for the focus garment, `appendLabelNegative()` adds a block to the Gemini prompt telling it **NOT** to draw any text / letters / logos in the pocket patch area. This prevents Gemini's hallucinated label from bleeding through under the shader output.

The gate keeps prompt and shader in lockstep: garment has no saved setup → no negative prompt AND no composite (back shot looks like today). Garment has saved setup → negative prompt AND composite. No orphan state.

Applied in `src/lib/pipeline/generate.ts` at three call sites: `generateM04WithDressedBase()`, `generateM04()`, `generateM02()`. **M05 is intentionally NOT wrapped** — the pocket close-up has no composite pass, so Gemini should draw its best-effort label.

### Setup UI — `/wardrobe/[id]/label-setup`

Ported from `label_POC/wardrobe_mockup/index.html`. React Client Component at `src/app/wardrobe/[id]/label-setup/page.tsx` (~1280 lines).

Flow:
1. Loads wardrobe item + existing `labelStyle` + `labelColorway` (edit mode if present).
2. Calls `/api/label/bootstrap` once to idempotently seed the `L2936-8.0` template.
3. User picks one of 4 back-view photos (`fitModels.back`, `back45Left`, `back45Right`, `flatBackUrl`) as the anchor.
4. Pan/zoom canvas with 8 draggable corner points (4 for the pocket quad, 4 for the label quad). `sortQuad` enforces TL/TR/BR/BL via sum/diff trick.
5. 5×5-pixel color sampler (via `getImageData()`; needs CORS → `/api/label/image-proxy`).
6. Material controls: grain variant selector, emboss slider.
7. Live preview: luminance-preserving multiply tint in JS (POC math: `norm = pow(clamp((lum - 0.02)/0.63, 0, 1), 0.85)`).
8. Save: dual PUT — `/api/label/styles/${styleCode}` (geometry) + `/api/label/colorways/${styleCode}_${colorwayCode}` (color delta).

`designNumber` must parse (`D22889-D933-H087` → `{styleCode, colorwayCode, sizeCode}`). Unparseable values block the save button and skip silently at generate time.

Entry: "Configure leather label →" button in the wardrobe detail panel, visible only when `category === 'bottom'` and `designNumber` parses.

### API Routes

| Route | Method | Role |
|---|---|---|
| `/api/label/templates` | GET, POST | list / upsert templates |
| `/api/label/templates/[templateId]` | GET | fetch one |
| `/api/label/styles/[styleCode]` | GET, PUT | geometry tier (quad validation) |
| `/api/label/colorways/[docId]` | GET, PUT | color tier (docId = `${styleCode}_${colorwayCode}`) |
| `/api/label/bootstrap` | GET, POST | idempotent L2936-8.0 seed |
| `/api/label/image-proxy?url=...` | GET | CORS proxy for canvas sampling (http/https only) |

### Rollback — `ENABLE_HYBRID_LABEL_AUTO`

Default ON. To kill the entire auto-label path without a redeploy:

```bash
gcloud run services update gstar-ai-studio \
  --region europe-west1 --project gstar-ai-studio \
  --set-env-vars ENABLE_HYBRID_LABEL_AUTO=0
```

OFF values (case-insensitive): `0`, `false`, `off`, `no`. Anything else = ON.

When OFF, `applyAutoHybridLabel()` returns the original buffer immediately. The gate in `hasLabelConfigForItem()` **still runs**, which means the negative prompt still gets applied to configured garments even though the shader is disabled. If that's not what you want, set the flag **before** kicking new jobs, not during a job.

The manual escape hatch `/api/shots/[id]/apply-label` remains available.

### Assets

- Template artwork + tiles: `public/label-assets/L2936-8.0.png`, `public/label-assets/leather-pebbled.png`. Next.js serves these at build time. Stored in Firestore as relative `/label-assets/...` URLs; `resolveAssetUrl()` converts to `http://localhost:${PORT}/...` for Cloud Run self-fetch.
- Python shader: `scripts/label_hybrid.py` — MUST stay out of `.gcloudignore` / `.dockerignore`.

---

## What Was Rejected and Why

### Rejected: Mannequin HSV/GrabCut Extraction (previous pipeline)

The old pipeline extracted the label from the mannequin back-view photo using HSV color detection → GrabCut segmentation → warp → alpha blend. It worked but had three problems:

1. **Per-garment setup drift** — every time a colorway was re-shot, corners had to be re-picked because the mannequin photo changed. No reuse across colorways of the same style.
2. **GrabCut fragility** — low-contrast fabric (raw indigo + dark leather) caused the segmentation to bleed or miss edges. The HSV range was tuned for brown/tan only.
3. **Text fidelity** — the extracted label texture came from whatever lighting the mannequin shoot had. Multiply bakery across a GrabCut'd RGBA was slightly inconsistent shot to shot.

The hybrid shader replaces all of this. Text comes from a single canonical template PNG. Geometry is saved once per style and reused across every colorway. Grain comes from a shared material tile, tinted per colorway.

### Rejected: Gemini Inpainting

- Model prioritizes seamless blending over pixel fidelity
- Text reproduction unreliable (wrong font, spacing, characters)
- Leather grain approximated, not transferred
- Inconsistent retries
- A shader is deterministic — same input always produces same output

### Rejected: Seamless Clone (`cv2.seamlessClone`)

Tried twice, failed twice:
- V1 (without inpainting): orange color bleeding from the hallucinated label underneath
- V2 (with inpainting): Poisson blending shifted label brown to match surrounding denim blue

Alpha blend with Gaussian feathering preserves exact label colors.

### Rejected: ControlNet / Stable Diffusion

Would require a second AI stack. SD quality is below Gemini for fashion ECOM. The shader already solves the problem deterministically at near-zero marginal cost.

---

## Edge Cases & Known Issues

1. **Pocket detection misses** — Gemini 2.5 Flash Lite occasionally returns corners outside bounds or a degenerate quad. `detectPocketCorners()` validates and rejects anything <20px wide or tall. On rejection → original buffer.

2. **Homography ill-conditioned** — if the saved pocket quad and the new detected quad are near-collinear, the 8×8 system is ill-conditioned. `computeHomography()` catches this and returns null → original buffer.

3. **Multiple pockets** — we only configure the wearer's **right** back pocket (image-left for a front-facing person). The prompt explicitly asks for the right pocket. Garments with a different label position need a new styleCode setup.

4. **Non-L2936-8.0 templates** — currently only one template is seeded. Adding a new physical label SKU means: (a) upload artwork + tiles to `public/label-assets/`, (b) POST to `/api/label/templates` with the new `templateId`, (c) reference it in new `labelStyles` docs.

5. **Flat back image as anchor** — the setup UI allows picking `flatBackUrl` as the anchor photo, but homography against a flat lay is geometrically unsound for a 3D drape. Prefer one of the `fitModels.back*` photos.

---

## Decision Record

| Date | Decision | Rationale |
|---|---|---|
| 2026-03 (v10) | Alpha blend over seamless clone | Preserves exact label colors; Poisson washes out |
| 2026-03-27 (v12) | Reject Gemini inpainting | Still generation, not transfer |
| 2026-03-27 (v12) | Reject ControlNet/Stable Diffusion | Second AI stack; SD below Gemini for ECOM |
| 2026-04-04 | Drop mannequin HSV/GrabCut pipeline | Per-garment drift, fragile on low-contrast fabrics |
| 2026-04-04 | Adopt hybrid shader (template + tile + emboss) | Byte-identical text from template; grain from shared tile |
| 2026-04-11 | Three-tier schema (Option B) | labelTemplates + labelStyles + labelColorways — corners saved once per styleCode, reused by every colorway |
| 2026-04-11 | Pocket-anchor homography | Label follows pocket across poses; no per-shot corner picking |
| 2026-04-11 | Gate negative prompt on `hasLabelConfigForItem` | Prompt and shader stay in lockstep; unconfigured garments render exactly like today |
| 2026-04-11 | `ENABLE_HYBRID_LABEL_AUTO` env flag (default ON) | Kill switch without redeploy |

---

## What To Do To Onboard A New Garment

1. Create the wardrobe item with a valid `designNumber` in the form `D{style}-D{colorway}-H{size}` (e.g. `D22889-D933-H087`).
2. Upload the back fit-model photos.
3. Open the wardrobe detail panel → click **Configure leather label →**.
4. Pick one of the back fit-model photos as the anchor.
5. Place the 4 pocket corners and the 4 label corners.
6. Sample the base leather color from the photo.
7. Pick grain variant + emboss strength.
8. **Save.** Writes `labelStyles/${styleCode}` + `labelColorways/${styleCode}_${colorwayCode}`.
9. For each additional colorway of the same style, you only need steps 1, 6, 7, 8 — the geometry in `labelStyles` is reused automatically.
10. Run a test M04 job. Check Cloud Run logs for `[Generate] M04 (...) labelGate=true` and `[LabelHybrid] composited NN bytes`.

---

## Files

| File | Role |
|---|---|
| `scripts/label_hybrid.py` | OpenCV shader: tint + warp + deboss |
| `src/lib/label-hybrid.ts` | TS wrapper — spawns Python subprocess |
| `src/lib/label-auto.ts` | Orchestrator called from generate route (gate + skip on failure) |
| `src/lib/label-render.ts` | Homography, asset URL resolution, config bridge |
| `src/lib/pocket-detector.ts` | Gemini 2.5 Flash Lite pocket corner detection |
| `src/lib/design-number.ts` | `D{style}-D{colorway}-H{size}` parser |
| `src/lib/firestore.ts` | `getLabelTemplate`, `getLabelStyle`, `getLabelColorway`, `resolveLabelRenderConfig` |
| `src/app/api/label/*` | CRUD routes for all three tiers + bootstrap + image proxy |
| `src/app/wardrobe/[id]/label-setup/page.tsx` | Setup UI |
| `src/app/api/generate/route.ts` | Post-process hook `applyAutoHybridLabel()` |
| `src/lib/pipeline/generate.ts` | `hasLabelConfigForItem` gate + `appendLabelNegative` wiring |
| `public/label-assets/L2936-8.0.png` | Template artwork (RGBA, height map comes from alpha) |
| `public/label-assets/leather-pebbled.png` | Shared pebbled grain tile |
