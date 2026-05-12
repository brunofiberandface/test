# cloud-run-job-worker — Phase 2 of the reliability roadmap

**Status: scaffold only, NOT deployed.** Phase 1 (in-worker watchdog + external unstick) is the active reliability mechanism. Phase 2 work begins in a separate session; this directory is the starting point.

See `LEARNINGS.md` #91 for the full plan.

## What this becomes

A Cloud Run **Job** (separate from the main `gstar-ai-studio` web service) that runs the worker loop with always-on CPU. The main service triggers the Job when a shot enqueues; the Job processes the queue until idle, then exits. Same pattern as the existing `cloud-run-job-matte/`.

## Why move it

Today's worker runs inside the Next.js HTTP service. Symptoms at production scale:
- CPU throttling during await (LEARNING #78) — timers don't fire, subprocesses freeze.
- HTTP-request lifetime != worker lifetime — Cloud Run can recycle the container mid-shot.
- Custom retry / timeout / dead-letter is the only mechanism; Cloud Run Jobs have these natively.

The matte job (LEARNING #80) proved the pattern works for our infra. Same template applies.

## Implementation outline (~3-4 days)

### Step 1 — extract worker logic into a shareable module
Today `src/app/api/jobs/process-queue/route.ts` mixes the worker loop with the Next.js HTTP handler. Split into:
- `src/lib/worker/loop.ts` — exports `runWorkerLoop(opts)` that contains the eligibility scan, key-pool checkout, processShot launch, etc.
- `src/app/api/jobs/process-queue/route.ts` — thin Next.js handler that calls `runWorkerLoop` (existing in-proc path stays operational).

### Step 2 — Cloud Run Job entrypoint
This directory gets:
- `package.json` — minimal Node deps: `@google-cloud/firestore`, `node-fetch` (or built-in fetch). NO Next.js.
- `Dockerfile` — Node 22-slim base, COPY the extracted `src/lib/worker/` + `src/lib/firestore.ts` + types.
- `job_main.ts` — imports `runWorkerLoop`, runs it until idle, exits 0.

The Job calls the main service's `/api/generate` over HTTP (same pattern the in-proc worker uses today via the localhost loopback). `/api/generate` stays in the main Next.js service.

### Step 3 — trigger from the main service
- New env var `WORKER_MODE = inproc | job` (default `inproc`).
- In `jobs/route.ts` POST + `jobs/[id]/run-all` POST + `shots/[id]/reset` POST: after `enqueueJob()`, branch on `WORKER_MODE`:
  - `inproc`: existing fire-and-forget call to `/api/jobs/process-queue` (unchanged).
  - `job`: HTTPS-call Run Admin v2 API to run the `worker-job` (mirroring `subject-matte.ts`).
- The Job has its own concurrency limit (Cloud Run Job `maxRetries=1, parallelism=1` initially).

### Step 4 — observability
- Each Job execution gets a unique run ID logged at start + end.
- Heartbeat updates the same `system/generationQueue.workerHeartbeat` field the in-proc worker uses (compatible with the unstick endpoint scan).

### Step 5 — coexistence + rollback
- Both workers can run side-by-side (both check the same `runningShots`-equivalent in Firestore; in-proc reads keep working).
- Flip `WORKER_MODE=job` in env vars to activate.
- Flip back to `inproc` for instant rollback.

## Deploy command (when ready)

```bash
cd cloud-run-job-worker/
gcloud run jobs deploy gstar-worker-job \
  --source . \
  --region europe-west1 \
  --project gstar-ai-studio \
  --cpu=2 --memory=2Gi \
  --max-retries=1 --task-timeout=3600 \
  --parallelism=1
```

## Open design questions

1. Idle exit policy. The matte job runs once per matte call. The worker is a queue processor — should it run until the queue is empty? Or take N shots and exit? Probably "until idle for 2 min then exit" mirrors the current in-proc loop's MAX_IDLE_CYCLES.

2. Concurrency. The in-proc worker handles multiple shots in parallel via the key-pool. The Cloud Run Job can run only 1 instance at a time (or N if `parallelism > 1`). Decide: 1 long-running Job that does parallel internally, vs. 1 Job per shot. The former mirrors current behavior more cleanly.

3. Cost. At 100 jobs/day × 6 shots × ~3 min CPU-on per shot = ~30 CPU-hours/day. At Cloud Run Job pricing (~$0.05/vCPU-hour) → ~$1.50/day = ~$45/mo. Negligible.
