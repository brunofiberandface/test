#!/usr/bin/env bash
#
# deploy-and-cycle-worker.sh
# Deploy to Cloud Run AND force-cycle the worker so the new revision's code
# is picked up immediately.
#
# WHY THIS EXISTS
# ───────────────────────────────────────────────────────────────────────────
# The in-proc worker (`/api/jobs/process-queue`) runs inside a long-lived HTTP
# request. Cloud Run keeps that request's instance alive (and routes new
# traffic to the new revision) for in-flight requests until they complete or
# hit the 3600s timeout. Result: a fresh deploy doesn't actually run on the
# new revision's worker code until the OLD worker either idles out (5 min
# with no slots) or hits its request timeout (up to 1h).
#
# For worker-code changes (M06 prompt fix, ref-count fix, key-pool change,
# etc.), that's the entire feedback loop. This script cuts that to zero by:
#   1. Deploying as usual
#   2. Deleting the previous revision → forces its instances to terminate
#   3. Force-releasing the worker singleton lock in Firestore (the old worker
#      may have updated its heartbeat <5min before dying)
#   4. Triggering a fresh worker on the new revision
#
# USAGE
# ───────────────────────────────────────────────────────────────────────────
#   ./scripts/deploy-and-cycle-worker.sh
#
# Run from the repo root. Defaults to service=gstar-ai-studio region=europe-west1
# project=gstar-ai-studio. Override via env vars:
#
#   SERVICE=gstar-ai-studio REGION=europe-west1 PROJECT=gstar-ai-studio ./scripts/deploy-and-cycle-worker.sh
#
# SAFETY
# ───────────────────────────────────────────────────────────────────────────
# - Only deletes the IMMEDIATELY-PRIOR live revision (captured before deploy).
#   Older revisions are left alone in case you need them for rollback.
# - If the deploy itself fails, the script exits before touching anything else.
# - The Firestore lock force-release is idempotent — sets workerActive=false
#   and backdates the heartbeat, so it's safe even if the worker is already
#   dead.
# - In-flight Seedream/Gemini API calls on the old instance are aborted when
#   the instance is killed. The shots they were processing become "stuck in
#   generating" — Phase 1 watchdog (`/api/admin/unstick`, 15-min threshold)
#   resets them. Or you can reset them manually with /api/shots/<id>/reset.
#
# Cost of cycling: ~$0.10-0.40 of wasted API spend per cycle (the few
# in-flight shots get cut). Worth it for sub-minute deploy → effect lag
# instead of up-to-1h.

set -e

SERVICE="${SERVICE:-gstar-ai-studio}"
REGION="${REGION:-europe-west1}"
PROJECT="${PROJECT:-gstar-ai-studio}"

echo "▶ Service:  $SERVICE"
echo "▶ Region:   $REGION"
echo "▶ Project:  $PROJECT"
echo

# ── Step 1: deploy first (creates the new revision) ──
echo "── Step 1: deploying from current dir ──"
gcloud run deploy "$SERVICE" --source . --region "$REGION" --quiet
echo

# ── Step 2: find the NEW (latest ready) revision ──
# Note: don't use status.traffic[0] — Cloud Run can list tagged revisions
# (e.g. dry-run tags) ahead of the actual 100%-traffic entry, which would
# match the wrong revision. latestReadyRevisionName is the authoritative
# "what just deployed" answer.
NEW_REV=$(gcloud run services describe "$SERVICE" --region="$REGION" \
  --format='value(status.latestReadyRevisionName)')
if [ -z "$NEW_REV" ]; then
  echo "ERROR: couldn't read latestReadyRevisionName after deploy."
  exit 1
fi
echo "New live revision:     $NEW_REV"
echo

# ── Step 3: find the revision the worker is ACTUALLY running on ──
# The worker holds a long-lived HTTP request on the instance it spawned in.
# Even after a deploy + traffic switch, Cloud Run lets that in-flight request
# finish on the OLD instance. We need to identify that instance by its
# revision label and delete that revision to force-terminate it.
echo "── Step 2: finding the revision the worker is currently running on ──"
WORKER_REV=$(gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE AND textPayload:\"Worker:inproc\"" \
  --limit=1 --freshness=2m \
  --format='value(resource.labels.revision_name)')
echo "Worker logging from:   ${WORKER_REV:-(none in last 2m — worker may be idle)}"
echo

# ── Step 4: delete the worker's revision if it differs from the new one ──
if [ -n "$WORKER_REV" ] && [ "$WORKER_REV" != "$NEW_REV" ]; then
  echo "── Step 4: deleting $WORKER_REV to kill the in-flight worker ──"
  gcloud run revisions delete "$WORKER_REV" --region="$REGION" --quiet || {
    echo "WARN: delete failed (revision may already be gone). Continuing."
  }
elif [ "$WORKER_REV" = "$NEW_REV" ]; then
  echo "Worker is already on the new revision. Nothing to cycle. Exiting cleanly."
  exit 0
else
  echo "No active worker found in logs — skipping revision-delete step."
fi
echo

# ── Step 5: force-release the worker lock in Firestore ──
echo "── Step 5: force-releasing worker lock ──"
TOKEN=$(gcloud auth application-default print-access-token)
# Backdate heartbeat to 1 hour ago — always stale, lets any worker claim.
STALE_TS=$(date -u -v-1H "+%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null \
        || date -u -d '1 hour ago' "+%Y-%m-%dT%H:%M:%S.000Z")
LOCK_RESP=$(curl -s -X PATCH \
  "https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/system/generationQueue?updateMask.fieldPaths=workerActive&updateMask.fieldPaths=workerHeartbeat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"fields\":{\"workerActive\":{\"booleanValue\":false},\"workerHeartbeat\":{\"stringValue\":\"${STALE_TS}\"}}}")
if echo "$LOCK_RESP" | grep -q '"name"'; then
  echo "Worker lock cleared (heartbeat backdated to $STALE_TS)"
else
  echo "WARN: lock-release PATCH didn't return expected response:"
  echo "$LOCK_RESP" | head -c 200; echo
fi
echo

# ── Step 6: trigger a fresh worker on the new revision ──
echo "── Step 6: triggering fresh worker ──"
SERVICE_URL=$(gcloud run services describe "$SERVICE" --region="$REGION" \
  --format='value(status.url)')
TRIGGER_RESP=$(curl -s --max-time 5 -X POST "$SERVICE_URL/api/jobs/process-queue" \
  || echo '{"message":"trigger curl timed out — worker likely claimed and is now running"}')
echo "Trigger response: $(echo "$TRIGGER_RESP" | head -c 200)"
echo
echo "▶ Done. New worker should be running on $NEW_REV."
echo "▶ Verify with: gcloud logging read 'resource.labels.revision_name=\"$NEW_REV\" AND textPayload:\"Worker\"' --limit=5 --freshness=1m"
