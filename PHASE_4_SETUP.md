# Phase 4 — Cloud Tasks worker setup

Phase 4 introduces a third `WORKER_MODE`: **`tasks`**. Instead of running a
worker loop (inproc) or spinning up a Cloud Run Job, each eligible shot is
fanned out as a Cloud Tasks task. Cloud Tasks handles concurrency, retries,
rate limiting, and back-pressure. This is the scalability path for
>500 jobs/day.

## How it differs from inproc/job mode

| | `inproc` | `job` | `tasks` |
|--|----------|-------|---------|
| Dispatch unit | per-loop iteration | per-loop iteration | per-shot task |
| Concurrency control | key-pool size | key-pool size | `maxConcurrentDispatches` on the queue |
| Retry | manual reset to `pending` | manual reset to `pending` | Cloud Tasks (exponential backoff) |
| Always-on CPU? | no (CPU throttled while awaiting) | yes | yes (HTTP handler per shot) |
| Job-level slots | yes | yes | yes (kept for monitoring/UX) |
| Fan-out of dependents | inside the loop body | inside the loop body | inside `/api/internal/process-shot` |

Slots still exist — they bookkeep "which jobs are in flight" for the dashboard.
The dispatcher moves from in-loop to Cloud Tasks.

## One-time setup

Run these from your terminal — they need permissions Claude doesn't have.

### 1. Create the Cloud Tasks queue

```sh
gcloud tasks queues create gstar-shot-queue \
  --location=europe-west1 \
  --max-concurrent-dispatches=2 \
  --max-dispatches-per-second=1 \
  --max-attempts=3 \
  --min-backoff=30s \
  --max-backoff=300s \
  --max-retry-duration=1800s
```

The values mirror current behaviour:
- `max-concurrent-dispatches=2` matches the current 2-key pool (so we can't
  start more concurrent shots than we have keys for).
- `max-dispatches-per-second=1` keeps a smooth rate, far below
  BytePlus/Gemini rate limits.
- `max-attempts=3` matches our previous worker-loop reset-to-pending behaviour
  but bounded so a broken shot doesn't loop forever.

Tune these after a successful dry run by editing the queue:

```sh
gcloud tasks queues update gstar-shot-queue \
  --location=europe-west1 \
  --max-concurrent-dispatches=4
```

### 2. Service account for OIDC

We need a dedicated service account that Cloud Tasks impersonates when calling
`/api/internal/process-shot`.

```sh
# Reuse the existing default SA (simpler), OR create one:
PROJECT_NUMBER=$(gcloud projects describe gstar-ai-studio --format='value(projectNumber)')
SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
# (Or create a dedicated one with:  gcloud iam service-accounts create gstar-tasks-invoker)
echo "Will use: $SA_EMAIL"
```

Grant the Cloud Tasks service agent permission to mint OIDC tokens for that SA:

```sh
gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-cloudtasks.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

### 3. Generate the shared task secret

This is the second auth layer — even if someone learns the URL, they can't
invoke without the secret.

```sh
TASK_SECRET=$(openssl rand -hex 32)
echo "Generated TASK_SECRET: $TASK_SECRET   ← save this, you'll need it for env"
echo -n "$TASK_SECRET" | gcloud secrets create gstar-internal-task-secret --data-file=-
gcloud secrets add-iam-policy-binding gstar-internal-task-secret \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/secretmanager.secretAccessor"
```

### 4. Grant the Cloud Run service permission to enqueue tasks

The Cloud Run service (running the Next.js app) needs to call
`cloudtasks.tasks.create`:

```sh
gcloud projects add-iam-policy-binding gstar-ai-studio \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/cloudtasks.enqueuer"
```

### 5. Set env vars on the Cloud Run service

```sh
gcloud run services update gstar-ai-studio \
  --region=europe-west1 \
  --update-env-vars="\
WORKER_MODE=tasks,\
TASKS_QUEUE_NAME=gstar-shot-queue,\
TASKS_QUEUE_LOCATION=europe-west1,\
TASKS_TARGET_URL=https://gstar-ai-studio-674145888056.europe-west1.run.app/api/internal/process-shot,\
TASKS_INVOKER_SA=${SA_EMAIL}" \
  --update-secrets="INTERNAL_TASK_SECRET=gstar-internal-task-secret:latest"
```

Flip back to inproc anytime:

```sh
gcloud run services update gstar-ai-studio \
  --region=europe-west1 \
  --update-env-vars="WORKER_MODE=inproc"
```

## Smoke test

1. Open `/admin/monitoring` — the **Worker mode** card should say `tasks`
   with hint `queue: RUNNING (2 max)`.
2. Create a new job. Within ~30s Cloud Tasks should show 1-2 tasks queued in
   the GCP Console (Cloud Tasks → `gstar-shot-queue`). One shot per task.
3. The shots progress through `pending` → `generating` → `done` exactly as
   before. Logs from `/api/internal/process-shot` show `[process-shot] M03 ...`.
4. After every shot, the handler auto-enqueues newly-eligible dependents
   (`[process-shot] M03 ... → fanned out 1 dependents`).
5. When the last shot completes, the job moves to `review` and the next queued
   job's initial shots fan out (`[process-shot] Next job from queue: ...`).

## Rollback

A bad deploy or a Cloud Tasks misconfiguration is one env-var flip away from
rollback:

```sh
gcloud run services update gstar-ai-studio \
  --region=europe-west1 \
  --update-env-vars="WORKER_MODE=inproc"
```

No code revert needed. The next /api/jobs request will trigger the worker
in-proc as before.

## Cost notes

- Cloud Tasks: $0.40 per million tasks. At 100 jobs/day × 6 shots = 600
  tasks/day = ~18k tasks/month → < $0.01/month. Negligible.
- Eliminates the need for a constantly-running Cloud Run Job container (saves
  ~$30-50/mo if you were running the Job in always-on mode).
- The Cloud Run service itself sees the same /api/generate load; tasks just
  changes how shots are dispatched, not how they're generated.

## Limits / known caveats

- **maxAttempts=3** is intentional: if /api/generate returns 5xx repeatedly,
  the task gives up after 3 tries and the shot stays in whatever state it was
  last left in (typically `failed` after /api/generate's error handler runs).
  The Phase 1 external `/api/admin/unstick` cron still re-enqueues anything
  stuck in `generating > 15min`.
- **Dedupe window is 1h**: the deterministic task name
  `shot-{shotId}-v{version}-0` is rejected if it already exists within the
  1h window. If you intentionally want to re-run a shot within an hour,
  bump the version field or use the reset/rerun endpoints which generate
  a new shot doc.
- **No back-pressure for /api/generate latency**: Cloud Tasks dispatches up to
  `maxConcurrentDispatches` regardless of how slow /api/generate is. If a
  shot stalls without erroring, the slot stays held until the wallclock
  watchdog (`/api/admin/unstick`, 15-min threshold) resets it.
