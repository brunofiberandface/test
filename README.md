# G-Star AI Studio

AI e-commerce photography generation web app for G-Star RAW. Takes mannequin rotation photos → generates virtual models wearing the garments → produces e-commerce-ready shots with automated quality control.

**Live:** `https://gstar-ai-studio-674145888056.europe-west1.run.app`
**Current version:** v11

## Two-Project Architecture

| Project | ID | Number | Purpose |
|---------|----|--------|---------|
| Studio | `gstar-ai-studio` | `674145888056` | Cloud Run, Firestore, GCS, OAuth |
| Pipeline | `gen-lang-client-0396152930` | `796981916231` | Gemini API keys, Vertex AI billing |

**CRITICAL:** Always deploy to `gstar-ai-studio`. Check with `gcloud config get-value project` before deploying.

## Stack

- **Framework:** Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Database:** Google Cloud Firestore (Native mode)
- **Storage:** Google Cloud Storage
- **Image Gen:** Gemini API (Pro for garment templates, Flash for model combo)
- **QC:** Gemini 2.5 Flash-Lite (3 dimensions: color match, waist height, garment length)
- **Auth:** NextAuth with Google OAuth + OTP email fallback
- **Deploy:** Google Cloud Run (europe-west1)

## Generation Pipeline

### Two-Phase Architecture

**Phase 1 — Garment Template** (gemini-3-pro-image-preview, 2K)
Mannequin 360° + fit model photos + flat image → anonymous model wearing the garment on white background. M03 generates first and saves as "anchor" for cross-shot color consistency.

**Phase 2 — Model Combination** (gemini-3.1-flash-image-preview, 2K)
Garment template + model card (or dressed base) → final e-commerce shot. Flash handles identity and photographic realism.

### Shot Types

| Shot | Code | Description | QC |
|------|------|-------------|-----|
| Cropped Front | M01 | Waist to feet, front view | Skipped (cropped) |
| Cropped Back | M02 | Waist to feet, back view | Skipped (cropped) |
| Full Body Front | M03 | Head to toe, front | Flash-Lite, 3 dims |
| Full Body Back | M04 | Head to toe, back | Flash-Lite, 3 dims |
| Dynamic Front | M05 | Editorial pose, front | Flash-Lite, 3 dims |

### Dressed Bases

Pre-rendered model cards wearing specific wardrobe combos (shirt + shoes). Generated in 4 views (front/right/back/left). Short compression shorts as base layer (not leggings). Wardrobe hash for deterministic matching.

### QC Gate (v3)

3 focused dimensions scored 1-10: color match, waist height, garment length. Uses gemini-2.5-flash-lite. Pass threshold: average ≥ 7.0, no dimension below 4. Max 1 auto-regen attempt. M01/M02 skip QC entirely.

### ECOM Guidelines (Feb 2026)

Gender-aware posing, footwear matrix by fit type × gender, neutral styling tops (white/beige/black/grey, always tucked), warm directional lighting, friendly open expression. No-gos enforced in both phases.

### Heels Detection

Wardrobe shoe items have `hasHeels` flag. When detected, M01/M02 crop adjusts from 28% to 23% from top to keep waistband visible with longer legs.

## Job Creation Flow

1. **Garment** — Select focus garment from wardrobe (grouped by gender + category). No upload in job wizard — all garments managed via Wardrobe page.
2. **Details** — Pre-filled from wardrobe. Category-specific metadata fields.
3. **Model** — Single model select.
4. **Outfit** — Select or generate dressed base.
5. **Review** — Submit.

## Key Source Files

| File | What it does |
|------|-------------|
| `src/lib/prompts.ts` | All generation/QC prompts, ECOM rules, posing, footwear matrix, no-gos |
| `src/app/api/generate/route.ts` | Main 2-phase generation pipeline (M01-M05) |
| `src/app/api/models/generate-dressed/route.ts` | Dressed base generation (4 views) |
| `src/app/api/qc/route.ts` | QC v3 — 3 dimensions on flash-lite |
| `src/lib/vertex.ts` | Gemini API wrapper + model card generation |
| `src/lib/garment-dna.ts` | Garment analysis via Gemini |
| `src/lib/firestore.ts` | Database layer, all collections |
| `src/app/jobs/new/page.tsx` | Job creation wizard (wardrobe-first) |
| `src/app/wardrobe/page.tsx` | Wardrobe management (focus garments + styling items) |
| `batch_regenerate.mjs` | Batch re-render script (run from local machine) |

## Deploy

```bash
# ALWAYS check project first!
gcloud config get-value project
# Must show: gstar-ai-studio
# If wrong:
gcloud config set project gstar-ai-studio

# Deploy
gcloud run deploy gstar-ai-studio \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 540 \
  --set-env-vars "GEMINI_API_KEY=AIzaSyDijMqHU0kaYcUVUz1AcP5pCaQRbihIY9Q"
```

**Service URL:** `https://gstar-ai-studio-674145888056.europe-west1.run.app`

## Batch Regeneration

After code changes to prompts/generation, re-render model cards + dressed bases:

```bash
# Test with one model first
node batch_regenerate.mjs --model F1

# All models, cards only
node batch_regenerate.mjs --cards-only

# All models, dressed bases only
node batch_regenerate.mjs --dressed-only

# Everything
node batch_regenerate.mjs
```

## Cost Per Job (5 shots, all optimizations)

| Item | Cost |
|------|------|
| Phase 1 (Pro, 2K) × 2 | $0.27 |
| Phase 2 (Flash, 2K) × 5 | $0.51 |
| QC (Flash-Lite) × 3 | $0.02 |
| Auto-regen (~30% rate) | $0.21 |
| **Total per job** | **~$1.00** |

## Local Development

```bash
cp .env.example .env.local
# Fill in values (see SETUP.md)
npm install
npm run dev
```

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v11 | 2026-03-25 | ECOM guidelines, cost optimizations (2K, flash-lite QC, 3-dim QC), wardrobe-first job wizard, heels detection + crop, batch regenerate |
| v10.1 | 2026-03-24 | Lean body proportions, jacket V-taper fix, back-view QC tolerance |
| v10 | 2026-03 | Two-phase generation, 4K bases, garment DNA, zone grids |
