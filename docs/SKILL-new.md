---
name: gstar-studio
description: |
  G-Star AI Studio development skill — a Next.js + Gemini AI application that generates e-commerce model photography for G-Star RAW denim. Use this skill whenever working on the gstar-studio codebase: fixing prompts, adjusting generation pipelines, deploying to Cloud Run, editing dressed base logic, modifying QC scoring, updating shot types, working with wardrobe/model/job entities, or debugging image generation issues. Also trigger when the user mentions "gstar", "G-Star", "studio", "model shots", "dressed bases", "generation pipeline", "Gemini image generation", "garment template", or anything related to AI-generated fashion photography. This skill contains the full architectural context, file map, prompt conventions, deploy commands, and known pitfalls accumulated over months of development.
---

# G-Star AI Studio — Development Context

## What This App Does

G-Star AI Studio generates e-commerce model photography using Gemini's image generation API. Users upload garment reference photos (flat images + 360° mannequin views), configure AI models (virtual people), and generate 5 standardized shot types per garment-model combination. The system produces studio-quality images that match G-Star RAW's ECOM photography guidelines.

## Two-GCP-Project Architecture

This is critical to understand — there are TWO separate GCP projects:

| Project | ID | Number | Purpose |
|---|---|---|---|
| **gstar-ai-studio** | gstar-ai-studio | 674145888056 | Cloud Run, Firestore, GCS — hosts the app |
| **gen-lang-client** | gen-lang-client-0396152930 | 796981916231 | Gemini API billing — the API key lives here |

The `GEMINI_API_KEY` env var on Cloud Run points to a key in the gen-lang-client project. All Firestore/GCS operations use the gstar-ai-studio project's service account (Application Default Credentials on Cloud Run).

## Tech Stack

- **Framework**: Next.js 16 (App Router) with React 19, TypeScript, Tailwind CSS
- **AI**: Gemini 3.1 Flash for image generation, Gemini 2.5 Flash Lite for QC scoring
- **Image processing**: Sharp (resize, composite, blur, background sampling), Python/OpenCV (label composite)
- **Database**: Firestore (collections: users, models, jobs, shots, wardrobe, modifications, promptAdjustments, otpCodes)
- **Storage**: Google Cloud Storage (garment images, generated shots, dressed bases)
- **Auth**: NextAuth with OTP email (domain-restricted to @gstar-raw.com)
- **Deploy**: Cloud Run (europe-west1), Dockerfile with standalone Next.js output
- **Tests**: Vitest (103 tests across 5 test files)

## Project Structure — Key Files

```
gstar-studio/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── generate/route.ts          ← MAIN: job shot generation (two-phase pipeline, v38 front/back isolation)
│   │   │   ├── models/
│   │   │   │   ├── generate-dressed/route.ts   ← Dressed base generation (single view)
│   │   │   │   ├── generate-dressed-all/route.ts ← SSE: all 4 dressed base views server-side
│   │   │   │   ├── generate-card/route.ts  ← Model card (identity reference) generation
│   │   │   │   ├── batch-redress/route.ts  ← Batch re-generate dressed bases
│   │   │   │   └── [id]/route.ts           ← Model CRUD
│   │   │   ├── jobs/
│   │   │   │   ├── route.ts                ← Job creation + worker kick (respond-then-fire pattern)
│   │   │   │   ├── process-queue/route.ts  ← Worker: processes generation queue sequentially
│   │   │   │   ├── [id]/run-all/route.ts   ← Enqueue + kick worker (respond-then-fire pattern)
│   │   │   │   ├── [id]/route.ts           ← Job CRUD
│   │   │   │   └── [id]/clone/route.ts     ← Clone job
│   │   │   ├── qc/route.ts                ← QC scoring endpoint
│   │   │   ├── shots/[id]/approve/route.ts ← Shot approval
│   │   │   ├── wardrobe/route.ts           ← Wardrobe CRUD
│   │   │   ├── auth/                       ← OTP auth flow
│   │   │   └── seed/route.ts               ← DB seeding
│   │   ├── models/[id]/page.tsx            ← Model detail page (dressed bases UI)
│   │   ├── jobs/[id]/results/page.tsx      ← Job results page (shot review)
│   │   ├── jobs/new/page.tsx               ← New job wizard
│   │   ├── wardrobe/page.tsx               ← Wardrobe management
│   │   └── dashboard/page.tsx              ← Main dashboard
│   ├── lib/
│   │   ├── config.ts          ← Shot descriptions (M01-M05), app config, aspect ratios
│   │   ├── prompts.ts         ← ANTI_AI_RULES, ANTI_HALLUCINATION, posing rules, styling rules
│   │   ├── vertex.ts          ← Gemini API client (REST, not Vertex AI SDK)
│   │   ├── firestore.ts       ← All Firestore operations, collection refs, typed helpers
│   │   ├── gcs.ts             ← GCS upload/download helpers
│   │   ├── garment-dna.ts     ← Extracts garment DNA (color, wash, fabric) from images via Gemini
│   │   ├── label-composite.ts ← TypeScript wrapper for Python label composite (Gemini corner detection + subprocess)
│   │   ├── zone-grids.ts      ← Panoramic strip generation — v38 front/back isolated strips
│   │   ├── zone-detection.ts  ← Detects garment zones in images
│   │   ├── wardrobe-hash.ts   ← Deterministic hash of wardrobe combo for dressed base lookup
│   │   ├── drive.ts           ← Google Drive integration
│   │   └── email.ts           ← OTP email sending (nodemailer)
│   ├── types/index.ts         ← All TypeScript interfaces (User, Job, Shot, Model, WardrobeItem, etc.)
│   └── __tests__/             ← 5 test files, 103 tests total
├── scripts/
│   └── label_composite.py     ← Python/OpenCV label extraction + compositing (called by label-composite.ts)
├── Dockerfile                 ← Multi-stage build → standalone Node.js + Python/OpenCV
├── .gcloudignore              ← MUST NOT exclude scripts/ or *.py (label pipeline needs them)
├── .dockerignore              ← MUST NOT exclude *.py
├── next.config.ts
├── vitest.config.ts
└── package.json
```

## Generation Pipeline

### Dressed Bases (pre-rendered model references)

Before generating job shots, each model needs **dressed bases** — 4 views (front, right, back, left) of the AI model wearing the wardrobe outfit. These serve as identity + outfit anchors for all subsequent shots.

**Endpoint**: `POST /api/models/generate-dressed` (single view)
**Bulk endpoint**: `POST /api/models/generate-dressed-all` (SSE stream, all 4 views)

Each dressed base:
1. Collects wardrobe item images as references
2. Builds a prompt with view-specific pose instructions (VIEW_POSES)
3. Generates via Gemini 3.1 Flash (2K resolution)
4. Runs QC via Gemini 2.5 Flash Lite (threshold 7.0, max 2 attempts)
5. Post-processes with Sharp: foot resize detection + Gaussian blur seam blending
6. Stores in GCS with Firestore metadata (linked by modelId + wardrobeHash + view)

**Foot resize logic** (in generate-dressed/route.ts):
- Checks bottom 12% of image for oversized feet
- Samples actual background color from bottom 10x10 corner pixels
- Edge detection zone covers bottom 15% — if >10% non-background pixels found, skips resize
- When resize runs: scales bottom 12% to 75% width, centers it, blends with 6px Gaussian blur band

### Job Shots (the 5 final e-commerce images)

**Endpoint**: `POST /api/generate` (single shot)
**Bulk endpoint**: `POST /api/jobs/[id]/run-all` (enqueues job + kicks worker)

5 shot types per job:

| Shot | Description | Aspect | Phase 1 | Notes |
|------|-------------|--------|---------|-------|
| M03 | Full body front | 9:16 | Flash (2K) | Generated FIRST as garment anchor. v38: 3 front angles only |
| M01 | Cropped front (waist to ankle) | 3:4 | Flash (2K) | No model card ref (would defeat crop) |
| M02 | Cropped back | 3:4 | Flash (2K) | Uses back dressed base, LABEL COMPOSITE applied |
| M04 | Full body back | 9:16 | Flash (2K) | Uses back dressed base, LABEL COMPOSITE applied. v38: 3 back angles only |
| M05 | Detail shot (back pocket close-up) | 3:4 | Flash (2K) | Uses back dressed base, tight crop |

**Two-phase pipeline** (for full-body shots M03/M04):
- **Phase 1** (Gemini Flash, 2K): Generates garment template from flat + fit model references. View-specific: front shots get FRONT VIEW CONSTRUCTION prompt block, back shots get BACK VIEW CONSTRUCTION block.
- **Phase 2** (Gemini Flash, 2K): Combines garment template with model identity from dressed base. View-specific construction details in prompt.

**For cropped shots** (M01/M02): Single phase, no model card, generates anonymous model wearing garment.
**For detail shot** (M05): Single phase, tight close-up of one back pocket. Gets M03 garment template as color lock + color anchor fit model.

### v38 Front/Back Reference Isolation (CRITICAL ARCHITECTURE)

The generation pipeline fully isolates front and back references to prevent cross-contamination. This was the key fix for M04 (full body back) quality — front seam details were bleeding into back generation.

**Symmetric 3-angle isolation** — both front and back get exactly 3 fit model angles at 2000px:

| | Back shots (M02, M04, M05) | Front shots (M01, M03) |
|---|---|---|
| **Fit model angles** | 3 back angles (center ±1, typically indices 3,4,5) at 2000px | 3 front angles (indices 0, 1, last) at 2000px |
| **Flat image** | Flat BACK at 2000px (front flat SKIPPED) | Flat FRONT at 2000px (back flat SKIPPED) |
| **Panoramic strips** | Back flat + 3 back angles = 4 panels at 1200px height | Front flat + 3 front angles = 4 panels at 1200px height |
| **Phase 1 prompt** | BACK VIEW CONSTRUCTION block | FRONT VIEW CONSTRUCTION block |
| **Phase 2 prompt** | Back panel seams, yoke, pocket arcs | Front pockets, fly, rivet placement |
| **Fit model description** | "3 back-view fit model angles + 1 flat back image" | "3 front-view fit model angles + 1 flat front image" |

**Why this matters**: Gemini was picking up front seam patterns from front fit model images and hallucinating them onto back views. Full isolation means back shots see ZERO front references, and front shots see ZERO back references. Each view gets maximum resolution (2000px) because fewer images = more pixel budget per image.

**Reference image labels are view-specific**:
- Back angles get: `BACK CONSTRUCTION REFERENCE — back panel seam lines, pocket shapes, yoke construction, diagonal seams below knee...`
- Front angle 0 gets: `FRONT COLOR ANCHOR — DEFINITIVE WASH/COLOR REFERENCE...`
- Other front angles get: `FRONT CONSTRUCTION REFERENCE — fabric drape, silhouette, front pocket placement...`

**Version history**:
- v37: First front/back isolation — back shots got 3 back angles at 2000px, front shots got ALL 8 angles at 1200px. M04 improved but M03 broke (Gemini lost garment context with only 3 front angles at first attempt).
- v37b: Asymmetric fix — back stayed isolated (3 angles), front reverted to all 8 angles. Stabilized both M03 and M04.
- v38: Symmetric isolation — BOTH front and back get 3 angles at 2000px. Front uses indices 0, 1, last (front-facing views). Fewer angles + higher resolution = better fidelity for both views.

### Panoramic Strips (zone-grids.ts)

Panoramic strips are horizontal concatenations of cropped zone regions (waist, knee, ankle) from fit model images + flat images. They give Gemini a zoomed-in 360° view of construction details per zone.

**v38 architecture**:
- Both front and back shots get 4 panels per strip: 1 primary flat crop + 3 fit model angle crops
- Panel height: 1200px (high resolution since only 4 panels vs old 10-panel strips)
- Back shots: back flat + 3 back angles (no front flat, no front angles)
- Front shots: front flat + 3 front angles (no back flat, no back angles)
- `generatePanoramicStrips()` receives `null` for the irrelevant flat buffer based on shot type
- `concatenateHighRes()` accepts configurable `maxPanelHeight` parameter (default 600, panoramic uses 1200)

### Worker Kick Pattern (respond-then-fire)

Both `jobs/route.ts` and `jobs/[id]/run-all/route.ts` use a respond-then-fire pattern:

```typescript
// Build the response FIRST
const response = NextResponse.json({ success: true, jobId, shotsCreated: shotIds.length });

// Fire worker kick AFTER building response — don't await it
fetch(`${getInternalBase()}/api/jobs/process-queue`, { method: 'POST' })
  .then(res => console.log(`[Job] Worker kick response: ${res.status}`))
  .catch(err => console.warn(`[Job] Worker kick failed (non-blocking):`, err));

return response;
```

**Why this specific pattern**: Cloud Run kills fire-and-forget requests when the handler returns. Awaiting process-queue blocks for minutes (generation time), causing the frontend to hang on "Submitting...". The respond-then-fire pattern works because the internal fetch creates a new request that keeps the container alive independently.

**THIS HAS CAUSED BUGS 3 TIMES. Never change this pattern without understanding the implications:**
1. `await fetch(process-queue)` → frontend hangs for minutes (Submitting... bug)
2. Fire-and-forget without response → Cloud Run kills the process
3. Only correct: build response → fire kick → return response

### Server-Side Generation (Queue-Based)

- `POST /api/jobs` creates job + enqueues + kicks worker (respond-then-fire)
- `POST /api/jobs/[id]/run-all` enqueues job + kicks worker (respond-then-fire)
- `POST /api/jobs/process-queue` is the worker that processes the queue sequentially
- Queue stored in Firestore document: `system/generationQueue`
- Frontend polls job status — tab can be closed, Cloud Run continues
- Internal API calls use **localhost loopback**: `http://localhost:${PORT}`

## Label Composite Pipeline (Python/OpenCV)

Back shots (M02, M04) need the REAL G-Star leather label composited onto AI-generated images. Gemini hallucinates labels, so we extract the real one from mannequin photos and composite it with Photoshop-quality results.

### Architecture: Two-Layer System

1. **TypeScript wrapper** (`src/lib/label-composite.ts`):
   - Downloads source/target images from GCS to temp files
   - Calls Gemini (`detectLabelCorners()`) to find 4 corner points of the label area in the generated image
   - Spawns Python subprocess with paths + corners JSON
   - Parses JSON result from stdout, cleans up temp files

2. **Python script** (`scripts/label_composite.py`):
   - All OpenCV pixel operations: HSV detection, GrabCut, perspective warp, blending
   - Three commands: `extract`, `composite`, `full` (extract + composite in one call)
   - Outputs JSON to stdout, logs to stderr

### Label Extraction (from mannequin image)

1. **HSV Color Detection** — Three overlapping ranges to find brown/tan leather pixels:
   - Range 1: H 8-25, S 40-200, V 60-200 (core brown)
   - Range 2: H 0-8, S 30-180, V 80-210 (reddish leather)
   - Range 3: H 20-35, S 25-150, V 100-220 (tan/light leather)
   - Combined with morphological close (15x15 kernel) to fill gaps

2. **Contour Selection** — Finds largest leather-colored contour by area (minimum 500px²)

3. **GrabCut Segmentation** — Pixel-perfect isolation with alpha transparency:
   - Initialized with bounding rect from contour + 8% padding (tighter than default)
   - 7 iterations of GrabCut refinement
   - **Leather mask constraint**: Only keeps pixels that match leather HSV ranges (dilated 7x7, 2 iterations)
   - Morphological cleanup: erode(1) → close(2) → open(1) → GaussianBlur(5x5)
   - Saves RGBA PNG with transparent background

### Label Compositing (onto generated image)

1. **Inpainting** — Removes Gemini's hallucinated label BEFORE compositing:
   - Dilates the target mask (7x7 kernel, 2 iterations) for coverage
   - `cv2.inpaint()` with TELEA algorithm, radius=5
   - This prevents color bleeding from the hallucinated label underneath

2. **Perspective Warp** — Maps extracted label to detected corner positions:
   - 4-corner homography via `cv2.getPerspectiveTransform()`
   - Corners come from Gemini `detectLabelCorners()` in the TypeScript layer
   - Warp flags: `cv2.INTER_LANCZOS4` for quality

3. **Alpha Blend with Gaussian Edge Feathering** — Natural integration:
   - Erodes mask by 1px (3x3 kernel) to avoid hard edges
   - Gaussian blur on mask edges: radius = max(3, min(width,height) * 0.004), must be odd
   - Normalized feathered mask [0,1] as 3-channel float
   - `result = warped * mask + clean_target * (1 - mask)`
   - **NOT seamless clone** — Poisson blending was washing out label colors

### Why NOT Seamless Clone (cv2.seamlessClone)

We tried seamless clone twice and it failed both times:
- **V1**: Without inpainting → orange color bleeding from hallucinated label underneath
- **V2**: With inpainting → Poisson blending still shifted label gray/brown to match surrounding denim blue
- Alpha blending with Gaussian feathering preserves exact label colors while blending edges naturally

### Integration Points in generate/route.ts

- **Section "3-LABEL"**: Extracts label from mannequin back view (angle index = totalAngles/2)
- **Section "POST-PROCESS 5"**: Composites real label onto generated back shots (M02, M04)
- The mannequin back view URL is pulled from the wardrobe item's `angles` array

## Prompt Conventions

Key prompt building blocks in `src/lib/prompts.ts`:
- `ANTI_AI_RULES` — Prevents AI-looking artifacts (plastic skin, symmetric faces, etc.)
- `ANTI_HALLUCINATION` — Forces garment fidelity to reference images
- `VIEW_POSES` — View-specific pose instructions (front relaxed, back 3/4 turn, etc.)
- `STYLING_RULES` — G-Star brand styling (raw denim aesthetic, urban, minimal)

Prompts reference images by index: `"image 1 shows the flat lay, image 2 shows the mannequin front..."` — order matters and must match the images array passed to Gemini.

**v38 view-specific prompt blocks** (in generate/route.ts Phase 1):
- `CRITICAL — BACK VIEW CONSTRUCTION:` block for back shots — emphasizes back panel seam lines, yoke seams, pocket arcs, diagonal seams below knee
- `CRITICAL — FRONT VIEW CONSTRUCTION:` block for front shots — emphasizes front pocket shapes, fly stitching, rivet placement, front panel seams
- Fit model description changes per view: back says "3 back-view fit model angles + 1 flat back image", front says original rotating description

**v38 view-specific prompt blocks** (in generate/route.ts Phase 2):
- Back: "back panel seam lines, yoke seams, back pocket stitching arcs"
- Front: "front pocket shapes, fly stitching, rivet placement"

## Deploy Commands

**HARD RULE: NEVER go into a deploy just like that.** Bruno has seen too many patches go wrong from thoughtless deploys. Think about the question first, come back with an answer, then propose a deploy as a *proposal* — never start compiling one without his explicit "deploy" / "go" / "A" (option chosen).

**Rule of thumb before proposing a deploy:**
1. Have you answered the question he actually asked? (If he said "diagnose X", don't deploy a fix for Y.)
2. Is the change scoped to the one thing being tested? (Arch-pivot work, refactors, unrelated cleanups → park them in a backup folder, not in the deploy.)
3. Is there a clean rollback path if the pose-test / smoke-test shows a regression? (If not, see "Git hygiene" below.)
4. Has `./node_modules/.bin/tsc --noEmit` passed clean?

### Deploy command (from Bruno's Mac — gcloud not in Cowork sandbox)

```bash
cd "/Users/bdheedene/Documents/Claude folder.nosync/gstar/gstar-studio" && \
/Users/bdheedene/google-cloud-sdk/bin/gcloud run deploy gstar-ai-studio \
  --source . \
  --region europe-west1 \
  --project gstar-ai-studio
```

Takes 5–8 minutes. Desktop Commander / Cowork bash tools have 2-minute limits, so this must be pasted in Bruno's terminal. Do not try to run it via `run_in_background` — the Cowork sandbox cannot reach gcloud anyway.

**Cloud Run URL**: https://gstar-ai-studio-674145888056.europe-west1.run.app

### Rollback — fastest first

**1. Instant rollback via traffic revision** (seconds, no rebuild):
```bash
gcloud run revisions list --service gstar-ai-studio \
  --region europe-west1 --project gstar-ai-studio --limit 5

gcloud run services update-traffic gstar-ai-studio \
  --region europe-west1 --project gstar-ai-studio \
  --to-revisions=gstar-ai-studio-<PREV-REVISION-TAG>=100
```
Cloud Run keeps every revision. Reverting traffic to a previous revision is instant — no build, no deploy, zero risk. Always prefer this for emergency rollback.

**2. Git revert + redeploy** (5–8 min, permanent):
Only if traffic-revision rollback is insufficient (e.g. the bad revision has been promoted and needs to be reverted in git history for future deploys). Requires the git hygiene below to be in place.

### Git hygiene — baseline-commit-first discipline

The repo has historically shipped from the uncommitted working tree (~400 deploys). That breaks clean rollback because every "revert" pulls back hundreds of commingled changes.

**Before a new-behavior deploy**, the working tree should look like this:

```
* <new-commit> — the isolated change being tested
* <baseline-commit> — "baseline: snapshot prod state prior to <date>"
* <last-pushed-commit>
```

Pattern when the working tree has accumulated many untracked changes:

1. Let Bruno choose **Option 2 (baseline-first)** — commits the current (pre-change) working tree as a baseline snapshot, then the new change as an isolated commit on top.
2. Temporarily undo the new change in the working tree (usually one small Edit).
3. `git add -A && git commit -m "baseline: snapshot prod state prior to <date> <feature> deploy"` — captures the 30–60+ uncommitted files as a single recoverable snapshot.
4. Re-apply the new change.
5. `git add <specific files> && git commit -m "<feature>: <short description>"` — the isolated change commit.
6. Now Bruno can `git revert <feature-sha>` to roll back cleanly without touching the baseline.

**If the working tree is already clean** (rare), skip the baseline step and just commit the change as usual.

### Cowork sandbox gotcha — stale `.git/index.lock`

The Cowork sandbox cannot delete files in the mounted `.git/` folder (sandbox permission, not a git issue). Every `git add` / `git commit` from the sandbox leaves a stale `index.lock` that blocks the next write operation.

**Workflow when committing from Cowork**:
- Sandbox runs `git add` / `git commit` — operation succeeds but leaves a stale lock.
- Before the next operation, tell Bruno to paste this on his Mac:
  ```bash
  cd "/Users/bdheedene/Documents/Claude folder.nosync/gstar/gstar-studio" && \
  find .git -name "*.lock" -delete
  ```
  `find -delete` sweeps both `index.lock` and `HEAD.lock` in one go.

**If making more than one commit in a session**: chain them into a single Bash command in *Bruno's terminal* instead of alternating sandbox + Mac. Example (uses a heredoc for the commit message):

```bash
cd "/Users/bdheedene/Documents/Claude folder.nosync/gstar/gstar-studio" && \
find .git -name "*.lock" -delete && \
git add -A && \
git commit -m "baseline: snapshot prod state prior to <date> <feature> deploy" && \
git add <specific files> && \
git commit -m "<feature>: <short description>"
```

### Git identity

The Mac has no `~/.gitconfig` by default. Commits from the Cowork sandbox pass identity per-command with:
```bash
git -c user.name="Bruno Dheedene" -c user.email="bruno.dheedene@rods-cones.com" commit -m "..."
```
(Never modify the user's global git config without explicit permission.)

## Known Issues & Pitfalls

1. **`.gcloudignore` and `.dockerignore` MUST include `scripts/` and `*.py`** — The label composite pipeline needs `scripts/label_composite.py` in the Docker image. If excluded, label compositing silently falls back to the old Sharp approach (which produces worse results).

2. **Dockerfile must install Python + OpenCV** — The multi-stage build installs `python3`, `python3-pip`, `opencv-python-headless`, and `numpy` in the final image. Without these, `isPythonAvailable()` returns false and the fallback Sharp path runs.

3. **Gemini corner detection can return bad corners** — `detectLabelCorners()` sometimes returns corners outside image bounds or in wrong order (not TL→TR→BR→BL). The Python script validates and clamps corners. If corners are degenerate (zero area), it falls back to center-placement.

4. **GrabCut can fail on low-contrast images** — If the leather label is very similar in color to surrounding fabric (e.g., raw indigo denim), GrabCut may not separate cleanly. The leather HSV mask constraint helps but isn't perfect.

5. **Foot resize can clip legs** — The bottom-12% resize logic assumes feet are in the bottom portion. On some poses where feet are higher, it can clip legs. The edge detection guard (>10% non-background pixels) usually prevents this.

6. **SSE streams and Cloud Run timeouts** — Generation can take 2-5 minutes per shot. Cloud Run's default timeout is 300s. For bulk generation (5 shots), ensure the Cloud Run service timeout is set high enough (currently 600s).

7. **Auth cookies on loopback** — Internal SSE calls to `localhost:${PORT}` must forward the original request's cookies. Without this, the internal endpoints return 401.

8. **Worker kick pattern — DO NOT CHANGE** — The respond-then-fire pattern in `jobs/route.ts` and `run-all/route.ts` has broken 3 times. NEVER `await` the process-queue fetch. NEVER fire-and-forget without building the response first. The ONLY correct pattern: build response → fire kick → return response. See "Worker Kick Pattern" section above.

9. **Front/back reference isolation is asymmetric in impact** — Back shots benefit enormously from isolation (removes front contamination that causes hallucinated seam lines). Front shots are less sensitive but still benefit from higher resolution per image. If M04 back construction looks wrong, check that back shots are getting ONLY back angles and flat back — any front reference leaking in will cause problems.

10. **Codebase path has `.nosync` suffix** — The actual path is `/Users/bdheedene/Documents/Claude folder.nosync/gstar/gstar-studio`. The `.nosync` prevents iCloud sync. If deploys or file operations fail with "directory not found", check for this suffix.

11. **gcloud deploy via Desktop Commander is unreliable** — The MCP has a 60s timeout but deploys take 5-8 min. Background nohup processes don't capture gcloud's progress output well (carriage return buffering). Best approach: give Bruno the command to run in his terminal, or use `gcloud builds list` to check status.

## Shot Regeneration

Individual shots can be re-run from the job results page (`/jobs/[id]/results`):
- Each shot card has a "Re-run This Shot" button
- Optional "MODIFICATION INSTRUCTIONS" textarea for prompt tweaks
- Calls `POST /api/generate` with `{ shotId, jobId, modification, originalPrompt: '', version: shot.version + 1 }`
- The shot version increments, previous versions are kept in GCS

## Entities & Data Model (Firestore)

- **User**: email, name, role (admin/user), domain-restricted to @gstar-raw.com
- **Model**: AI person — name, description, model card image URL, dressed bases (4 views × N wardrobe combos)
- **WardrobeItem**: garment — name, category (top/bottom/shoes/accessory), flat image URLs, mannequin angle URLs (360° views), fitModelUrls (fit model photos for reference isolation)
- **Job**: generation task — modelId, wardrobeItemIds, garmentWardrobeId, status (pending/generating/complete/failed), shot results
- **Shot**: individual generated image — jobId, shotType (M01-M05), imageUrl, qcScore, version, approved flag
- **Modification**: prompt adjustment for re-runs — shotId, instructions text, applied flag
- **PromptAdjustment**: global prompt tweaks stored per shot type
- **system/generationQueue**: Firestore document holding the generation queue state

## Cost Awareness

- Gemini Flash (2K): ~$0.01/image — used for ALL generations (Phase 1 and Phase 2)
- Gemini Flash Lite (QC): ~$0.002/call — used for QC scoring
- A full job (5 shots) costs roughly $0.06-0.10 depending on retries
- Dressed bases (4 views): ~$0.04-0.08 per model-wardrobe combo

## URL & Access

- **Production**: https://gstar-ai-studio-674145888056.europe-west1.run.app
- **Dashboard**: /dashboard (main entry, lists all jobs)
- **Auth**: OTP email to @gstar-raw.com addresses only
- **GCS bucket**: `gstar-ai-studio.appspot.com` (default Firebase bucket)
- **Firestore**: project `gstar-ai-studio`, default database

## Codebase Location (Bruno's Mac)

```
/Users/bdheedene/Documents/Claude folder.nosync/gstar/gstar-studio/
```

Note the `.nosync` suffix — this prevents iCloud from syncing the directory. All file paths and deploy commands must use this exact path.
