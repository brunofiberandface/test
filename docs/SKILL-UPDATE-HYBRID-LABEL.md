# SKILL.md — Hybrid Label Section Replacement

The skill file at `/sessions/.../mnt/.claude/skills/gstar-studio/SKILL.md` is on a read-only mount this session — I couldn't edit it directly. This file contains the exact text to paste in as a replacement for the old "Label Composite Pipeline (Python/OpenCV)" section.

## How to apply

On your Mac:

```bash
# Replace <path-to-skill> with wherever the skill file lives on your machine
open -a TextEdit ~/.claude/skills/gstar-studio/SKILL.md
# or use any editor
```

Find the `## Label Composite Pipeline (Python/OpenCV)` section (starts around line 206) and replace everything from that header up to — but not including — `## Prompt Conventions` with the block below.

---

## PASTE START — Hybrid Leather-Label Pipeline — Option B (Three-Tier)

```markdown
## Hybrid Leather-Label Pipeline — Option B (Three-Tier)

Back shots (M02, M04) get the REAL G-Star leather label rendered onto AI-generated images via a pocket-anchor homography + Python/OpenCV shader compositor. Gemini hallucinates labels, so we shade them in post.

### Why Option B (three tiers)

Previously each wardrobe item carried its own hand-picked label corners. That broke the first time a colorway was re-shot — corners drift, so every garment needed a new setup even if the artwork was identical. The three-tier schema factors the problem:

- **labelTemplates** — ONE shared artwork + grain tiles per physical patch (e.g. `L2936-8.0`). Holds the RGBA art, the material tile URLs per grain (pebbled/smooth/coarse), and the aspect ratio.
- **labelStyles** — one doc per styleCode (e.g. `D22889`). Holds `templateId` + the saved `pocketCorners` and `labelCorners` on an `anchorPhoto` (the first colorway's back mannequin). This is the geometry setup. Done once per style, reused for all colorways.
- **labelColorways** — one doc per `${styleCode}_${colorwayCode}` (e.g. `D22889_D933`). Holds ONLY the color delta: base color, stitch color, grain variant, emboss strength. Geometry is inherited from labelStyles.

At generate time: `resolveLabelRenderConfig(styleCode, colorwayCode)` joins all three. If any tier is missing, the label silently skips and the unchanged buffer ships.

### Runtime Pipeline (per back shot)

1. **Guard** — only M02/M04, only if `ENABLE_HYBRID_LABEL_AUTO` is unset/true, only if Python+opencv is available, only if the focus wardrobe item has a parseable `designNumber` and a resolvable render config. ANY failure at ANY step → returns the original buffer unchanged. A broken label must never block a shot. (`src/lib/label-auto.ts`)

2. **Pocket detection** — `detectPocketCorners(buf)` calls Gemini 2.5 Flash Lite with a strict JSON-only prompt to find the right back pocket's 4 corners in the generated image. Returns null on any error / bad quad / <20px w or h. (`src/lib/pocket-detector.ts`)

3. **Homography re-projection** — `projectLabelCornersViaHomography()` computes a 4-point DLT homography from the saved `pocketCorners` (on the setup anchor photo) to the newly detected pocket, then applies that same transform to the saved `labelCorners`. Pure-TS 8x8 Gauss elimination, no OpenCV SVD. (`src/lib/label-render.ts`)

4. **Hybrid shader** — `applyHybridLabel(buf, projectedCorners, hybridConfig)` spawns `scripts/label_hybrid.py`: tints the grain tile with `baseColor`, warps it into the target quad, and debosses it using a Sobel height map from the template artwork. Output is a JPEG buffer. (`src/lib/label-hybrid.ts` + `scripts/label_hybrid.py`)

5. **Gated negative prompt** — `hasLabelConfigForItem(focusItem)` runs BEFORE Gemini generation. If all three tiers exist for the focus garment's designNumber, `appendLabelNegative()` adds a block telling Gemini NOT to draw any letters/logos on the pocket patch — the shader fills it in. This stops Gemini's text from bleeding through under the shader output. If no config exists, NO negative prompt is added and the back shot renders exactly like before. Gate and shader both use `resolveLabelRenderConfig`, so prompt and composite stay locked in step. Applied in `src/lib/pipeline/generate.ts` at three call sites: M04-dressed, M04-legacy, M02-legacy. **M05 is intentionally NOT wrapped** — the pocket close-up has no composite pass.

### Setup UI

- **Route**: `/wardrobe/[id]/label-setup` (port of `label_POC/wardrobe_mockup/index.html`)
- **Entry**: wardrobe detail panel shows "Configure leather label →" button when category=bottom and designNumber parses.
- **Auto-bootstrap**: first load calls `/api/label/bootstrap` which idempotently seeds the `L2936-8.0` template (artwork + pebbled tile from `public/label-assets/`).
- **Photo picker**: 4 possible back-view photos (fitModels.back, back45Left, back45Right, flatBackUrl). User picks ONE as the anchor.
- **Pocket + label quads**: 4 draggable corner points each, pan/zoom canvas, CSS transform scale with `--ptscale` for inverted point sizes. TL/TR/BR/BL enforced via `sortQuad` (sum/diff trick).
- **Color picker**: 5x5 pixel sample via `getImageData()` — requires CORS, served through `/api/label/image-proxy` with `Access-Control-Allow-Origin: *`.
- **Live preview**: luminance-preserving multiply tint on the canvas (POC math: `norm = pow(clamp((lum-0.02)/0.63, 0, 1), 0.85)`).
- **Save**: PUT `/api/label/styles/${styleCode}` (geometry + anchorPhoto) + PUT `/api/label/colorways/${styleCode}_${colorwayCode}` (base/stitch color, grain, emboss). Both idempotent upsert.
- **designNumber parsing** (`src/lib/design-number.ts`): `D22889-D933-H087` → `{styleCode: D22889, colorwayCode: D933, sizeCode: H087}`. Unparseable → save is blocked in the UI and skipped silently at generate time.

### API Routes

- `GET/POST /api/label/templates` — list + upsert templates
- `GET /api/label/templates/[templateId]` — fetch one
- `GET/PUT /api/label/styles/[styleCode]` — geometry tier (validates 4-length quads of `{x,y}`)
- `GET/PUT /api/label/colorways/[docId]` — color tier (docId = `${styleCode}_${colorwayCode}`)
- `GET/POST /api/label/bootstrap` — idempotent L2936-8.0 seed
- `GET /api/label/image-proxy?url=...` — CORS proxy for canvas sampling (http(s) only)

### Rollback: ENABLE_HYBRID_LABEL_AUTO

Default ON. To kill the entire auto-label path without a redeploy:

\`\`\`bash
gcloud run services update gstar-ai-studio \\
  --region europe-west1 --project gstar-ai-studio \\
  --update-env-vars ENABLE_HYBRID_LABEL_AUTO=0
\`\`\`

Values that count as OFF: `0`, `false`, `off`, `no` (case-insensitive). Anything else = ON. When off, back shots ship exactly as Gemini produced them. The gate predicate still runs — if you want to disable the whole thing cleanly during a running job, set the flag BEFORE kicking new jobs. The manual `/api/shots/[id]/apply-label` path still works as the escape hatch.

### Asset Locations

- Artwork + tiles: `public/label-assets/L2936-8.0.png` and `public/label-assets/leather-pebbled.png`. Served at build time by Next.js. Referenced in Firestore as relative `/label-assets/...` URLs; `resolveAssetUrl()` converts to `http://localhost:${PORT}/...` for Cloud Run self-fetch.
- Python shader: `scripts/label_hybrid.py` — MUST stay in `.gcloudignore` / `.dockerignore` whitelist.

### Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-04 | Drop mannequin HSV/GrabCut extraction | Per-garment drift, fragile on low-contrast fabrics, no reuse across colorways |
| 2026-04-04 | Adopt hybrid shader (template + tile + emboss) | Byte-identical text; grain from shared tile |
| 2026-04-11 | Three-tier schema (Option B) | Corners saved once per styleCode, reused by every colorway |
| 2026-04-11 | Pocket-anchor homography | Label follows pocket across poses; no per-shot corner picking |
| 2026-04-11 | Gate negative prompt on `hasLabelConfigForItem` | Prompt and shader stay in lockstep; unconfigured garments render like today |
| 2026-04-11 | `ENABLE_HYBRID_LABEL_AUTO` env flag (default ON) | Kill switch without redeploy |
```

## PASTE END

---

## Also update the section index at the top of SKILL.md

If the top of SKILL.md has a section index listing "Label Composite Pipeline", rename that entry to **"Hybrid Leather-Label Pipeline — Option B (Three-Tier)"** to match the new header.

## Cross-reference

Full implementation details live in `LABEL-STRATEGY.md` at the repo root. That doc has:

- The complete pipeline diagram (gate → detect → homography → shader)
- The three-tier Firestore schema explained
- Every edge case and what rollback option handles it
- "What to do to onboard a new garment" checklist
- File-by-file map of the implementation

The skill version above is the compressed operational reference. For deep dives, point to `LABEL-STRATEGY.md`.
