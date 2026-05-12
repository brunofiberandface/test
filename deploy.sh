#!/usr/bin/env bash
# Deploy gstar-ai-studio to Cloud Run with mandatory git commit + push.
# Adopted 2026-05-12 after a 3-week stretch of uncommitted deploys made the
# git history useless for recovery (see LEARNINGS: "Backup discipline").
#
# Handles BOTH repos at every deploy:
#   1. gstar-docs  (workspace .md notes, sibling dir at ../) — commit + push
#   2. gstar-studio (this dir, app source) — commit + push, deploy, tag
#
# Bruno's policy (2026-05-12): "every deploy should be backed up, dont think
# more then that is needed". So backup is only at the deploy moment, not on a
# timer. Both repos pushed in one shot.
#
# Behaviour:
#   1. Commit + push the docs repo if dirty (no prompt, auto-message — the
#      docs are append-only LEARNINGS / BUGS / DEPLOYMENT_LOG; commit message
#      is "docs: snapshot before deploy <SHA>").
#   2. Commit + push the app repo if dirty (prompt for message OR -m flag).
#   3. gcloud run deploy with the canonical mandatory flags.
#   4. On success, tag the app commit `rev/<revision-name>` + push the tag.
#   5. (Optional) tag the docs commit too, same tag name (audit trail across
#      repos).
#
# Usage:
#   ./deploy.sh                      # interactive — prompts for app commit msg if dirty
#   ./deploy.sh -m "fix: foo"        # non-interactive app commit message
#   ./deploy.sh --skip-tag           # deploy + commit but don't tag (rare)
#
# Hard rules baked in:
#   --cpu=2 --memory=2Gi             # required for parallel worker (LEARNING)
#   --timeout=900                    # 15 min request timeout
#   --region=europe-west1
#   --project=gstar-ai-studio
#   --allow-unauthenticated          # NextAuth handles auth at the app layer
#
# Refuses to deploy if any `git push` fails — better to surface the network/auth
# issue than ship a deploy whose source state isn't backed up.

set -euo pipefail

SERVICE=gstar-ai-studio
REGION=europe-west1
PROJECT=gstar-ai-studio
GCLOUD=/Users/bdheedene/google-cloud-sdk/bin/gcloud

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCS_DIR="$(cd "$APP_DIR/.." && pwd)"  # workspace dir, parent of gstar-studio

cd "$APP_DIR"

# ── Parse args ──────────────────────────────────────────────────────────────
commit_msg=""
skip_tag=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)  commit_msg="$2"; shift 2 ;;
    --skip-tag)    skip_tag=1; shift ;;
    -h|--help)
      sed -n '1,40p' "$0"; exit 0 ;;
    *)
      echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# Reusable: safety scan for secret-looking paths in staged files.
# Refuses to commit if any obvious secret pattern is staged.
check_no_secrets_staged() {
  local label="$1"
  if git diff --cached --name-only | grep -qiE "(^|/)\.env($|\.)|sa_key\.json|client_secret.*\.json|service-account.*\.json|\.pem$|\.key$|__pycache__"; then
    echo "❌ ABORTING ($label) — staged files include possible secrets:" >&2
    git diff --cached --name-only | grep -iE "(^|/)\.env($|\.)|sa_key\.json|client_secret.*\.json|service-account.*\.json|\.pem$|\.key$|__pycache__" >&2
    echo "Update .gitignore + unstage these before deploying." >&2
    exit 1
  fi
}

# ── 1. Docs repo: commit + push if dirty (auto-message) ─────────────────────
echo "📚 Checking docs repo at $DOCS_DIR…"
pushd "$DOCS_DIR" > /dev/null
if git rev-parse --git-dir > /dev/null 2>&1; then
  if ! git diff-index --quiet HEAD -- 2>/dev/null || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    git add -A
    check_no_secrets_staged "docs"
    docs_msg="docs: snapshot before app deploy"
    git commit -m "$docs_msg" > /dev/null
    docs_sha=$(git rev-parse --short HEAD)
    echo "   📝 Committed $docs_sha — pushing…"
    git push origin HEAD > /dev/null
    echo "   ✓ Docs pushed."
  else
    docs_sha=$(git rev-parse --short HEAD)
    echo "   ✓ Docs clean ($docs_sha)."
  fi
else
  echo "   ⚠️  $DOCS_DIR is not a git repo — skipping docs backup."
  docs_sha=""
fi
popd > /dev/null

# ── 2. App repo: commit + push if dirty (prompt for message) ───────────────
echo ""
echo "💻 Checking app repo at $APP_DIR…"
if ! git diff-index --quiet HEAD -- 2>/dev/null || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo "   📝 Working tree dirty — committing before deploy."
  echo ""
  git add -A
  echo "   Staged changes (after .gitignore filtering):"
  git diff --cached --stat | sed 's/^/   /' | tail -20
  echo ""
  check_no_secrets_staged "app"

  if [[ -z "$commit_msg" ]]; then
    echo "   Enter commit message (one line, or blank for editor):"
    read -r commit_msg
  fi

  if [[ -z "$commit_msg" ]]; then
    git commit
  else
    git commit -m "$commit_msg"
  fi

  echo "   📤 Pushing to origin…"
  git push origin HEAD
else
  echo "   ✓ Working tree clean — proceeding with current commit."
fi

# ── 3. Run gcloud deploy ────────────────────────────────────────────────────
sha=$(git rev-parse --short HEAD)
echo ""
echo "🚀 Deploying $SERVICE from $sha to Cloud Run…"
echo ""

deploy_log=$(mktemp)
trap 'rm -f "$deploy_log"' EXIT

if ! "$GCLOUD" run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --project "$PROJECT" \
  --allow-unauthenticated \
  --cpu=2 --memory=2Gi \
  --timeout=900 \
  2>&1 | tee "$deploy_log"; then
  echo "" >&2
  echo "❌ DEPLOY FAILED — code is committed + pushed but no Cloud Run revision shipped." >&2
  exit 1
fi

# Parse revision name from `Service [...] revision [<name>] has been deployed`
revision=$(grep -oE "revision \[$SERVICE-[0-9]+-[a-z0-9]+\]" "$deploy_log" | head -1 | sed -E 's/revision \[(.+)\]/\1/')
if [[ -z "$revision" ]]; then
  echo "⚠️  Deploy succeeded but couldn't parse revision name from output. Skipping tag." >&2
  exit 0
fi

echo ""
echo "✓ Deployed revision: $revision"

# ── 4. Tag the app commit + (optionally) the docs commit ────────────────────
if [[ "$skip_tag" -eq 1 ]]; then
  echo "ℹ️  --skip-tag set; not tagging."
  exit 0
fi

tag="rev/$revision"

# App repo tag
if git rev-parse "$tag" >/dev/null 2>&1; then
  echo "ℹ️  App tag $tag already exists — leaving it alone."
else
  git tag "$tag" "$sha" -m "Cloud Run revision $revision deployed from app SHA $sha"
  git push origin "$tag" > /dev/null
  echo "🏷️  App: tagged $sha as $tag and pushed."
fi

# Docs repo tag (same tag name on the docs SHA — audit-trail link)
if [[ -n "$docs_sha" ]]; then
  pushd "$DOCS_DIR" > /dev/null
  if git rev-parse "$tag" >/dev/null 2>&1; then
    echo "ℹ️  Docs tag $tag already exists — leaving it alone."
  else
    git tag "$tag" "$docs_sha" -m "Workspace docs state at Cloud Run deploy $revision (docs SHA $docs_sha)"
    git push origin "$tag" > /dev/null
    echo "🏷️  Docs: tagged $docs_sha as $tag and pushed."
  fi
  popd > /dev/null
fi

echo ""
echo "Done. To check out the full state of this revision later:"
echo "  (app)  git -C \"$APP_DIR\" checkout $tag"
if [[ -n "$docs_sha" ]]; then
  echo "  (docs) git -C \"$DOCS_DIR\" checkout $tag"
fi
