# SKILL update — Deploy discipline & rollback

Paste-ready addition for `.claude/skills/gstar-studio/SKILL.md`. The mount is read-only in Cowork sessions, so this file exists so Bruno can manually append the patch when convenient.

**Target location in SKILL.md**: replace the existing `## Deploy Commands` section (starts around line 291, ends just before `## Known Issues & Pitfalls`) with the block below. The deploy command stays the same — what's new is the discipline + rollback + the lock-file gotcha.

---

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

If Bruno wants to suppress the "your identity was configured automatically based on hostname" warning on future local commits, he can set global config himself:
```bash
git config --global user.name "Bruno Dheedene"
git config --global user.email "bruno.dheedene@rods-cones.com"
```
Non-urgent — the repo isn't pushed to origin for every deploy (deploys are from working tree via `--source .`, not from git).
