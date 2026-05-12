#!/usr/bin/env bash
# Deploy gstar-ai-studio to Cloud Run with mandatory git commit + push.
# Adopted 2026-05-12 after a 3-week stretch of uncommitted deploys made the
# git history useless for recovery (LEARNING note: "Backup discipline").
#
# Behaviour:
#   1. If working tree is dirty, prompt for a commit message, stage all, commit, push.
#   2. Capture HEAD SHA after commit.
#   3. Run `gcloud run deploy ...` with the canonical mandatory flags.
#   4. On success, parse the new revision name from gcloud output and tag the
#      commit `rev/<revision-name>` + push the tag. Future `git checkout rev/...`
#      gives you the source state of any specific Cloud Run revision.
#
# Usage:
#   ./deploy.sh                      # interactive — prompts for commit msg if dirty
#   ./deploy.sh -m "fix: foo"        # non-interactive commit message
#   ./deploy.sh --skip-tag           # deploy + commit but don't tag (rare)
#
# Hard rules baked in:
#   --cpu=2 --memory=2Gi             # required for parallel worker (LEARNING)
#   --timeout=900                    # 15 min request timeout (matte/two-pass shots)
#   --region=europe-west1
#   --project=gstar-ai-studio
#   --allow-unauthenticated          # NextAuth handles auth at the app layer
#
# Refuses to deploy if `git push` fails — better to surface the network/auth
# issue than ship a deploy whose source state isn't backed up.

set -euo pipefail

SERVICE=gstar-ai-studio
REGION=europe-west1
PROJECT=gstar-ai-studio
GCLOUD=/Users/bdheedene/google-cloud-sdk/bin/gcloud

cd "$(dirname "$0")"

# ── Parse args ──────────────────────────────────────────────────────────────
commit_msg=""
skip_tag=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)  commit_msg="$2"; shift 2 ;;
    --skip-tag)    skip_tag=1; shift ;;
    -h|--help)
      sed -n '1,30p' "$0"; exit 0 ;;
    *)
      echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# ── Pre-flight: commit any uncommitted work ─────────────────────────────────
if ! git diff-index --quiet HEAD -- 2>/dev/null || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo "📝 Working tree is dirty — committing before deploy."
  echo ""
  echo "Staged changes (after .gitignore filtering):"
  git add -A
  git diff --cached --stat | tail -20
  echo ""

  # Quick safety scan — refuse to commit if obvious secrets are staged
  if git diff --cached --name-only | grep -qiE "(^|/)\.env($|\.)|sa_key\.json|client_secret.*\.json|service-account.*\.json|\.pem$|\.key$|__pycache__"; then
    echo "❌ ABORTING — staged files include possible secrets:" >&2
    git diff --cached --name-only | grep -iE "(^|/)\.env($|\.)|sa_key\.json|client_secret.*\.json|service-account.*\.json|\.pem$|\.key$|__pycache__" >&2
    echo "Update .gitignore + unstage these before deploying." >&2
    exit 1
  fi

  if [[ -z "$commit_msg" ]]; then
    echo "Enter commit message (one line, or blank for editor):"
    read -r commit_msg
  fi

  if [[ -z "$commit_msg" ]]; then
    git commit
  else
    git commit -m "$commit_msg"
  fi

  echo "📤 Pushing to origin..."
  git push origin HEAD
else
  echo "✓ Working tree clean — proceeding with current commit."
fi

# ── Capture SHA + run deploy ────────────────────────────────────────────────
sha=$(git rev-parse --short HEAD)
echo ""
echo "🚀 Deploying $SERVICE from $sha to Cloud Run..."
echo ""

# Run deploy and tee output so we can parse the revision name afterward.
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

# ── Tag commit + push tag ───────────────────────────────────────────────────
if [[ "$skip_tag" -eq 1 ]]; then
  echo "ℹ️  --skip-tag set; not tagging."
  exit 0
fi

tag="rev/$revision"
if git rev-parse "$tag" >/dev/null 2>&1; then
  echo "ℹ️  Tag $tag already exists (?!) — leaving it alone."
else
  git tag "$tag" "$sha" -m "Cloud Run revision $revision deployed from $sha"
  git push origin "$tag"
  echo "🏷️  Tagged $sha as $tag and pushed."
fi

echo ""
echo "Done. To check out the source state of this revision later:"
echo "  git checkout $tag"
