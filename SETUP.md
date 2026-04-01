# G-Star AI Studio — GCP Setup (15 min)

## Two-Project Architecture

| Project | ID | Number | Purpose |
|---------|----|--------|---------|
| Studio | `gstar-ai-studio` | `674145888056` | Cloud Run, Firestore, GCS, OAuth |
| Pipeline | `gen-lang-client-0396152930` | `796981916231` | Gemini API keys, Vertex AI billing |

**CRITICAL:** Always deploy to `gstar-ai-studio`. The Gemini API key lives in the Pipeline project but the Cloud Run service runs in the Studio project.

## Step 1: Create GCP Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown (top bar) → **New Project**
3. Name: `gstar-ai-studio`
4. Click **Create**
5. Switch to the new project

## Step 2: Enable APIs

In the new project, go to **APIs & Services → Library** and enable:

1. **Cloud Firestore API** — database
2. **Cloud Storage API** — image storage
3. **Cloud Run Admin API** — deployment
4. **Cloud Build API** — container builds
5. **Identity and Access Management (IAM) API**

Note: Gemini API is billed through the Pipeline project (`gen-lang-client-0396152930`), not the Studio project.

## Step 3: Create Firestore Database

1. Go to **Firestore** in the console
2. Click **Create Database**
3. Select **Native mode** (not Datastore mode)
4. Location: `eur3` (Europe)
5. Click **Create**

## Step 4: Set Up OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Select **Internal** (only for @gstar-raw.com users)
   - If you need external users too, select **External** and add test users
3. App name: `G-Star AI Studio`
4. User support email: your email
5. Authorized domains: add your Cloud Run URL later
6. Click **Save and Continue** through scopes (no extra scopes needed)

## Step 5: Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `G-Star AI Studio`
5. Authorized redirect URIs: add both:
   - `http://localhost:3000/api/auth/callback/google` (local dev)
   - `https://gstar-ai-studio-674145888056.europe-west1.run.app/api/auth/callback/google` (production)
6. Click **Create**
7. Copy the **Client ID** and **Client Secret** → put in `.env.local`

## Step 6: Create Service Account

1. Go to **IAM & Admin → Service Accounts**
2. Click **+ Create Service Account**
3. Name: `gstar-studio-backend`
4. Grant roles:
   - **Cloud Datastore User** (for Firestore)
   - **Storage Admin** (for Cloud Storage)
5. Click **Done**
6. Click the service account → **Keys** tab → **Add Key → JSON**
7. Download the key file → rename to `sa_key.json`
8. For local dev: put in project root (already in .gitignore)
9. For Cloud Run: the service account is auto-attached

## Step 7: Local Development

```bash
cd gstar-studio
cp .env.example .env.local
# Fill in the values from steps above

npm install
npm run dev
```

Open http://localhost:3000

## Step 8: Deploy to Cloud Run

### ⚠️ CHECK YOUR PROJECT FIRST — EVERY TIME

This has gone wrong multiple times. The wrong default project causes deployment to the wrong Cloud Run service (different URL, different Firestore, nothing works).

```bash
# STEP 1: Verify you're targeting the right project
gcloud config get-value project
# Must show: gstar-ai-studio
# If it shows anything else:
gcloud config set project gstar-ai-studio
```

### Deploy Command

```bash
gcloud run deploy gstar-ai-studio \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 540 \
  --set-env-vars "GEMINI_API_KEY=<your-key>"
```

### Deploy Checklist

1. `gcloud config get-value project` → must say `gstar-ai-studio`
2. Run the deploy command above
3. Verify the service URL ends with `674145888056` (not `796981916231`)
4. Test: visit `https://gstar-ai-studio-674145888056.europe-west1.run.app`

**Service URL:** `https://gstar-ai-studio-674145888056.europe-west1.run.app`

### Common Mistakes

- **Deployed to wrong project**: URL will end with `796981916231` instead of `674145888056`. The app will seem to work but runs old code and hits a different Firestore. Fix: `gcloud config set project gstar-ai-studio` and redeploy.
- **`--set-env-vars` DELETES all vars not specified**: For partial updates, use `--update-env-vars` instead.

## Cost Estimate

### Per Job (~5 shots, all optimizations)

| Item | Cost |
|------|------|
| Phase 1 — Garment Template (Pro, 2K) × 2 | $0.27 |
| Phase 2 — Model Combination (Flash, 2K) × 5 | $0.51 |
| QC (Flash-Lite) × 3 | $0.02 |
| Auto-regen (~30% rate) | $0.21 |
| **Total per job** | **~$1.00** |

### Monthly (100 garments, 2 models each = 200 jobs)

| Service | Estimate |
|---------|----------|
| Gemini API (200 jobs × $1) | ~$200 |
| Cloud Run | ~$20-50 |
| Firestore | ~$5-10 |
| Cloud Storage | ~$5 |
| **Total** | **~$230-265/month** |
