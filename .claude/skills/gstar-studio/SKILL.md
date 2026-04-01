---
name: gstar-studio
description: |
  G-Star AI Studio development skill — a Next.js + Gemini AI application that generates e-commerce model photography for G-Star RAW denim. Use this skill whenever working on the gstar-studio codebase: fixing prompts, adjusting generation pipelines, deploying to Cloud Run, editing dressed base logic, modifying QC scoring, updating shot types, working with wardrobe/model/job entities, or debugging image generation issues. Also trigger when the user mentions "gstar", "G-Star", "studio", "model shots", "dressed bases", "generation pipeline", "Gemini image generation", "garment template", or anything related to AI-generated fashion photography. This skill contains the full architectural context, file map, prompt conventions, deploy commands, and known pitfalls accumulated over months of development.
---

# G-Star AI Studio — Development Context

## WORKFLOW RULE — ANALYZE FIRST, CODE LATER (MANDATORY)

**This is the #1 rule for this project. Violating it is a critical failure.**

When Bruno reports a bug, shows a screenshot, or asks about an issue:

1. **ANALYZE first** — explain what you see, what the root cause likely is, what areas of code are involved
2. **PROPOSE a fix** — describe the approach in plain language (not code). Explain trade-offs if any.
3. **WAIT for Bruno's go-ahead** — he says "do it" or "yes" or "go" → only then write code
4. **WAIT for deploy instruction** — he says "deploy" → only then deploy

**NEVER:**
- Jump straight into writing code when Bruno reports a problem
- Start a deploy without Bruno explicitly saying "deploy"
- Patch something without first explaining what you're patching and why
- Assume that showing a screenshot = "please fix this immediately"
- Bundle multiple unrelated fixes into one deploy without discussing each

Bruno is the decision-maker. Claude provides analysis and proposals. Bruno approves. Then Claude executes.

This rule exists because rushing to code without thinking has caused bad deploys multiple times. Think first, propose, then execute on approval.

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
- **Database**: Firestore (collections: users, models, jobs, shots, wardrobe, modifications, promptAdjustments, otpCodes, system)
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
│   │   │   ├── generate/route.ts              ← MAIN: job shot generation (two-phase pipeline)
│   │   │   ├── models/
│   │   │   │   ├── generate-dressed/route.ts   ← Dressed base generation (single view)
│   │   │   │   ├── generate-dressed-all/route.ts ← SSE: all 4 dressed base views server-side
│   │   │   │   ├── generate-card/route.ts      ← Model card (identity reference) generation
│   │   │   │   ├── batch-redress/route.ts      ← Batch re-generate dressed bases
│   │   │   │   └── [id]/route.ts               ← Model CRUD
│   │   │   ├── jobs/
│   │   │   │   ├── [id]/run-all/route.ts       ← Enqueues job + kicks worker
│   │   │   │   ├── [id]/route.ts               ← Job CRUD (⚠️ catches /jobs/<anything> — see pitfall #8)
│   │   │   │   ├── [id]/clone/route.ts         ← Clone job
│   │   │   │   ├── process-queue/route.ts      ← SERVER-SIDE WORKER: long-lived queue processor
│   │   │   │   └── reset-queue/route.ts        ← Emergency queue reset (⚠️ NOT DEPLOYED — see pitfall #8)
│   │   │   ├── queue/route.ts              ← Queue state API (GET + DELETE for legacy slot release)
│   │   │   ├── qc/route.ts                ← QC scoring endpoint
│   │   │   ├── shots/[id]/approve/route.ts ← Shot approval
│   │   │   ├── wardrobe/route.ts           ← Wardrobe CRUD
│   │   │   ├── auth/                       ← OTP auth flow
│   │   │   └── seed/route.ts               ← DB seeding
│   │   ├── models/[id]/page.tsx            ← Model detail page (dressed bases UI)
│   │   ├── jobs/[id]/results/page.tsx      ← Job results page (shot review)
│   │   ├── jobs/new/page.tsx               ← New job wizard
│   │   ├── wardrobe/page.tsx               ← Wardrobe management
│   │   └── dashboard/page.tsx              ← Main dashboard (polls /api/queue every 10s)
│   ├── lib/
│   │   ├── config.ts          ← Shot descriptions (M01-M05), app config, aspect ratios
│   │   ├── prompts.ts         ← ANTI_AI_RULES, ANTI_HALLUCINATION, posing rules, styling rules
│   │   ├── vertex.ts          ← Gemini API client (REST, not Vertex AI SDK)
│   │   ├── firestore.ts       ← All Firestore operations, collection refs, queue helpers (enqueueJob, claimWorker, releaseSlot, etc.)
│   │   ├── gcs.ts             ← GCS upload/download helpers
│   │   ├── garment-dna.ts     ← Extracts garment DNA (color, wash, fabric) from images via Gemini
│   │   ├── label-composite.ts ← TypeScript wrapper for Python label composite (Gemini corner detection + subprocess)
│   │   ├── zone-grids.ts      ← Construction detail zone crops for reference fidelity
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

## Generation Queue System (2-Slot Worker Architecture)

The queue is the backbone of job processing. Understanding it is critical for debugging stuck jobs.

### Firestore Document: `system/generationQueue`

```
{
  slots: [SlotState | null, SlotState | null],  // 2 parallel job slots
  queue: QueueEntry[],                           // waiting jobs (FIFO)
  workerActive: boolean,                         // whether a worker process is running
  workerHeartbeat: ISO timestamp,                // last heartbeat from active worker
  // Legacy fields (still read by dashboard but being phased out):
  activeJobId, activeJobName, activeStartedAt, activeHeartbeat
}
```

**SlotState**: `{ jobId, jobName, startedAt, currentShot, retryPass }`
**QueueEntry**: `{ jobId, jobName, queuedAt }`

### How It Works

1. **`run-all`** calls `enqueueJob()` → job enters a free slot or queue
2. **`run-all`** fire-and-forgets `POST /api/jobs/process-queue` to kick the worker
3. **Worker** (`process-queue/route.ts`) is a long-lived request that:
   - Runs orphan recovery (finds `status='generating'` jobs not in any slot)
   - Fills empty slots from queue
   - Processes each slot sequentially (one shot at a time per slot)
   - Calls `/api/generate` internally via localhost loopback
   - Updates heartbeat after each loop iteration
   - Exits after 5 min of idle (30 × 10s cycles)
4. **Cloud Scheduler** pings `process-queue` every 3 min as safety net

### Key Constants (process-queue/route.ts)

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_RETRY_PASSES` | 2 | Max retry passes for failed shots |
| `SHOT_TIMEOUT_MS` | 540,000 (9 min) | Per-shot generation timeout |
| `SHOT_COOLDOWN_MS` | 10,000 (10s) | Cooldown between shots to avoid 429s |
| `STALE_THRESHOLD_MS` | 720,000 (12 min) | Reset shots stuck in 'generating' longer than this |
| `IDLE_CHECK_MS` | 10,000 (10s) | Poll interval when no work |
| `MAX_IDLE_CYCLES` | 30 | Exit after 5 min idle (30 × 10s) |

### Shot Order

`['M03', 'M01', 'M02', 'M04', 'M05']` — M03 generates first (establishes garment anchor).

### Status Transitions

| Trigger | Job Status | Shot Status |
|---------|-----------|-------------|
| Job created | `uploading` | `queued` |
| enqueueJob() | `uploading` → assigned to slot/queue | `queued` |
| Worker claims shot | `generating` | `generating` |
| /api/generate succeeds | (unchanged) | `done` |
| /api/generate fails | (unchanged) | `failed` |
| All shots done | `review` | `done` |
| Stale guard (>12 min) | (unchanged) | `queued` (reset) |

### Stale Worker Detection & Recovery

The worker uses a Firestore-based claim with heartbeat:
- `claimWorker()` checks: if `workerActive=false` OR `workerHeartbeat > 5 min old` → claim
- If `workerActive=true` AND heartbeat recent → rejects with `"already_running"`

**⚠️ CRITICAL BUG (2026-03-30)**: The `process-queue` endpoint rejects with `"already_running"` when `workerActive=true`, even if the heartbeat is hours stale. The 5-min heartbeat check only applies to `claimWorker()` in firestore.ts, but `process-queue` itself may short-circuit before calling claimWorker. When the Cloud Run worker container dies (OOM, timeout, network), `workerActive` stays `true` in Firestore permanently, blocking ALL future workers. The only fix is manually setting `workerActive=false` in the Firestore console or deploying the `reset-queue` endpoint (which is currently NOT accessible — see pitfall #8).

### Emergency Recovery Procedures

**When the queue is stuck (jobs not progressing):**

1. **Check queue state**: `GET /api/queue` — look at `workerActive`, `workerHeartbeat`, `slots`
2. **If workerActive=true but heartbeat is stale (>5 min old)**: Worker is dead. Fix:
   - Go to GCP Console → Firestore → `system/generationQueue` document
   - Edit `workerActive` from `true` to `false`
   - Then POST to `/api/jobs/process-queue` to kick a new worker (will timeout from browser but runs server-side)
3. **If slots are occupied but no progress**: Shots may be stuck in `'generating'` state. The 12-min stale guard will eventually reset them to `'queued'`. Or manually reset shot status in Firestore.
4. **Nuclear option** (once deployed): `POST /api/jobs/reset-queue` — clears all queue state, resets all `generating` jobs/shots to `queued`, releases worker lock. Does NOT touch `done` or `approved` shots.
5. **DELETE /api/queue**: Legacy endpoint — only releases the old `activeJobId` field, does NOT clear V2 slots or workerActive. Limited utility.

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
**Bulk endpoint**: `POST /api/jobs/[id]/run-all` (enqueues + kicks worker)

5 shot types per job:

| Shot | Description | Aspect | Phases | Model(s) | Notes |
|------|-------------|--------|--------|----------|-------|
| M03 | Full body front | 9:16 | 2 | Pro (4K) → Flash (2K) | Generated FIRST as garment anchor |
| M01 | Cropped front (waist to ankle) | 3:4 | 2 | Pro (4K) → Flash (2K) | No model card ref (would defeat crop) |
| M02 | Cropped back | 3:4 | 2 | Pro (4K) → Flash (2K) | Uses back dressed base, LABEL COMPOSITE applied |
| M04 | Full body back | 9:16 | 2 | Pro (4K) → Flash (2K) | Uses back dressed base, LABEL COMPOSITE applied |
| M05 | Detail/Dynamic shot | 3:4 | 2 | Pro (4K) → Flash (2K) | Back pocket close-up, extra identity lock in prompt |

**Two-phase pipeline** (ALL shots use this):
- **Phase 1** (Gemini Pro, 4K): Generates garment template from flat + mannequin references. Pure garment on anonymous body.
- **Phase 2** (Gemini Flash, 2K): Combines garment template with model identity from dressed base. Adds photographic realism.

**M05 specifics**: Despite being a detail shot, M05 uses the full two-phase pipeline. Gets extra identity lock in the model card label to prevent Gemini from drifting: "Even though this shot uses a relaxed, editorial pose, the FACE and IDENTITY must be IDENTICAL to this reference." Prompt specifies: tight close-up of one back pocket, camera at hip height ~40cm, frame from waistband to mid-thigh only.

### Progress Steps (reported to Firestore for UI polling)

| Step | % | Description |
|------|---|-------------|
| Loading references | 5 | Collecting model card, flat, mannequin, zone grids |
| Building prompt | 20 | Assembling prompt text + image references |
| Generating garment template (Phase 1) | 30 | Gemini Pro 4K call |
| Garment template ready | 50 | Phase 1 complete |
| Generating final image (Phase 2) | 55 | Gemini Flash 2K call |
| Post-processing | 75 | Sharp resize, label composite, etc. |
| Uploading image | 90 | GCS upload |
| (done) | 100 | Shot status → 'done' |

If a shot regresses from a later step back to "Loading references", it means the shot failed/timed out and the stale guard reset it to 'queued', causing a full retry from scratch.

### Server-Side Generation (SSE Streaming)

Both `generate-dressed-all` and `jobs/[id]/run-all` use the same pattern:
- POST request starts a ReadableStream with SSE events
- Internal API calls use **localhost loopback**: `http://localhost:${PORT}`
- Frontend reads the stream for live progress, but the tab can be closed and Cloud Run continues
- Auth cookies from the original request are forwarded to internal loopback calls

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

## Deploy Commands

**From Bruno's Mac** (gcloud not in PATH):
```bash
cd /Users/bdheedene/Documents/Claude\ folder/gstar/gstar-studio
/Users/bdheedene/google-cloud-sdk/bin/gcloud run deploy gstar-ai-studio \
  --source . \
  --region europe-west1 \
  --project gstar-ai-studio
```

**IMPORTANT**: Deploy takes 5-8 minutes. If using Desktop Commander MCP (60s timeout), run with nohup:
```bash
cd /Users/bdheedene/Documents/Claude\ folder/gstar/gstar-studio && \
nohup /Users/bdheedene/google-cloud-sdk/bin/gcloud run deploy gstar-ai-studio \
  --source . --region europe-west1 --project gstar-ai-studio \
  > /tmp/gcloud-deploy.log 2>&1 &
```
Then poll with `tail -20 /tmp/gcloud-deploy.log` until you see the service URL.

**Cloud Run URL**: https://gstar-ai-studio-674145888056.europe-west1.run.app

## Known Issues & Pitfalls

1. **`.gcloudignore` and `.dockerignore` MUST include `scripts/` and `*.py`** — The label composite pipeline needs `scripts/label_composite.py` in the Docker image. If excluded, label compositing silently falls back to the old Sharp approach (which produces worse results).

2. **Dockerfile must install Python + OpenCV** — The multi-stage build installs `python3`, `python3-pip`, `opencv-python-headless`, and `numpy` in the final image. Without these, `isPythonAvailable()` returns false and the fallback Sharp path runs.

3. **Gemini corner detection can return bad corners** — `detectLabelCorners()` sometimes returns corners outside image bounds or in wrong order (not TL→TR→BR→BL). The Python script validates and clamps corners. If corners are degenerate (zero area), it falls back to center-placement.

4. **GrabCut can fail on low-contrast images** — If the leather label is very similar in color to surrounding fabric (e.g., raw indigo denim), GrabCut may not separate cleanly. The leather HSV mask constraint helps but isn't perfect.

5. **Foot resize can clip legs** — The bottom-12% resize logic assumes feet are in the bottom portion. On some poses where feet are higher, it can clip legs. The edge detection guard (>10% non-background pixels) usually prevents this.

6. **SSE streams and Cloud Run timeouts** — Generation can take 2-5 minutes per shot. Cloud Run's default timeout is 300s. For bulk generation (5 shots), ensure the Cloud Run service timeout is set high enough (currently 600s).

7. **Auth cookies on loopback** — Internal SSE calls to `localhost:${PORT}` must forward the original request's cookies. Without this, the internal endpoints return 401.

8. **`reset-queue` route NOT accessible in production (2026-03-30)** — The file `src/app/api/jobs/reset-queue/route.ts` exists in the codebase but the Next.js `[id]` dynamic route at `src/app/api/jobs/[id]/route.ts` intercepts `/api/jobs/reset-queue` and treats `reset-queue` as a job ID, returning `{"error":"Job not found"}`. In Next.js App Router, static routes should take priority over dynamic routes, but this isn't working correctly. **Fix needed**: Either rename to a path that won't collide (e.g., `/api/admin/reset-queue`) or add explicit handling in the `[id]` route to pass through known static segments.

9. **Stale `workerActive` lock blocks entire queue** — When the Cloud Run worker container dies (OOM, timeout, container recycle), `workerActive` stays `true` in Firestore. The `process-queue` endpoint returns `{"ok":true,"status":"already_running"}` and refuses to start a new worker, even if the heartbeat is hours old. **Incident on 2026-03-30**: Queue was stuck for 2+ hours because of this. Fix was manually editing `workerActive=false` in Firestore console, then POSTing to `/api/jobs/process-queue`. **Permanent fix needed**: Make `process-queue` check heartbeat staleness BEFORE rejecting, or have the Cloud Scheduler automatically clear stale locks.

10. **Legacy `activeJobId` field not cleared by V2 queue** — The `system/generationQueue` document has both V2 fields (`slots`, `queue`) and legacy fields (`activeJobId`, `activeJobName`). The dashboard reads `activeJobId` for the "Generating now" header. When a job completes and releases its slot, the V2 slot is cleared but `activeJobId` is NOT updated, causing the dashboard to show a completed job as "Generating now" indefinitely. The `DELETE /api/queue` endpoint only operates on this legacy field.

11. **Auto-QC suspended since v28** — QC scoring after generation is commented out to reduce failure modes. Manual QC via "Run QC Now" button on results page still works. Re-enable once the generation pipeline is stable.

## Shot Regeneration

Individual shots can be re-run from the job results page (`/jobs/[id]/results`):
- Each shot card has a "Re-run This Shot" button
- Optional "MODIFICATION INSTRUCTIONS" textarea for prompt tweaks
- Calls `POST /api/generate` with `{ shotId, jobId, modification, originalPrompt: '', version: shot.version + 1 }`
- The shot version increments, previous versions are kept in GCS

## Entities & Data Model (Firestore)

- **User**: email, name, role (admin/user), domain-restricted to @gstar-raw.com
- **Model**: AI person — name, description, model card image URL, dressed bases (4 views × N wardrobe combos)
- **WardrobeItem**: garment — name, category (top/bottom/shoes/accessory), flat image URLs, mannequin angle URLs (360° views)
- **Job**: generation task — modelId, wardrobeItemIds, status (uploading/queued/generating/review/complete/failed), shot results
- **Shot**: individual generated image — jobId, shotType (M01-M05), imageUrl, qcScore, version, approved flag, progressStep, progressPct, claimedBySlot
- **Modification**: prompt adjustment for re-runs — shotId, instructions text, applied flag
- **PromptAdjustment**: global prompt tweaks stored per shot type
- **system/generationQueue**: Queue state document — slots, queue, workerActive, workerHeartbeat (see Queue System section)

## Cost Awareness

- Gemini Pro (4K, Phase 1): ~$0.04/image — used only for M03 first pass
- Gemini Flash (2K): ~$0.01/image — used for all other generations
- Gemini Flash Lite (QC): ~$0.002/call — used for QC scoring
- A full job (5 shots) costs roughly $0.10-0.15 depending on retries
- Dressed bases (4 views): ~$0.04-0.08 per model-wardrobe combo

## URL & Access

- **Production**: https://gstar-ai-studio-674145888056.europe-west1.run.app
- **Dashboard**: /dashboard (main entry, lists all jobs)
- **Queue API**: /api/queue (GET for state, DELETE for legacy slot release)
- **Worker kick**: POST /api/jobs/process-queue (long-lived, will timeout from browser)
- **Auth**: OTP email to @gstar-raw.com addresses only
- **GCS bucket**: `gstar-ai-studio.appspot.com` (default Firebase bucket)
- **Firestore**: project `gstar-ai-studio`, default database
- **Firestore Console** (for emergency queue fixes): https://console.cloud.google.com/firestore/databases/-default-/data/panel/system/generationQueue?project=gstar-ai-studio

## Codebase Location (Bruno's Mac)

```
/Users/bdheedene/Documents/Claude folder/gstar/gstar-studio/
```
