/**
 * Model reference white-bg processor.
 *
 * Takes a model's current reference image (front or back), runs it through
 * the subject-matte Cloud Run Job to produce a pure-white-background variant,
 * uploads to GCS, and returns the new URL.
 *
 * Why this exists (2026-05-13):
 *   Some model reference images shipped with studio rig visible in corners
 *   (softboxes, tripods) or with a non-white backdrop. These artifacts
 *   bleed into rendered shots — Gemini/Seedream pick up the studio rig as
 *   visual cues and reproduce darker corners or unwanted shadows in
 *   generated outputs. Pure-white backdrops give the cleanest identity
 *   reference.
 *
 *   The matte job (cloud-run-job-matte) already does subject extraction
 *   via rembg + composite onto color canvas. We reuse it here with the
 *   white canvas color, DISABLE_SHADOW=1 (no contact shadow for identity
 *   refs), and a stable output GCS path per model.
 *
 * Cost: $0 — rembg + sharp, no Gemini/Seedream calls.
 * Time: ~30-60s per model (matte job rembg pass + GCS roundtrip).
 *
 * Caller pattern:
 *   - POST /api/models (new model creation) — fires async after createModel
 *   - Backfill script — sweeps existing models with non-white backdrops
 */
import { GoogleAuth } from 'google-auth-library';

const BUCKET = process.env.GCS_BUCKET || 'gstar-ai-studio-assets';
const PROJECT = process.env.GCP_PROJECT_ID || 'gstar-ai-studio';
const REGION = process.env.GCP_REGION || 'europe-west1';
const MATTE_JOB = process.env.MATTE_JOB_NAME || 'subject-matte-job';
const RUN_API_BASE = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}`;
const POLL_INTERVAL_MS = 5000;
const EXECUTION_TIMEOUT_MS = 5 * 60_000;

let _auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!_auth) _auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  return _auth;
}

interface JobOperation {
  name: string;
  done?: boolean;
  error?: { message?: string; code?: number };
  response?: unknown;
}

/**
 * Process a single GCS-hosted image through the matte job, producing a
 * pure-white-background version at a deterministic destination path.
 *
 * @param srcGcsUri  e.g. `gs://gstar-ai-studio-assets/model-cards/F11.png`
 * @param dstGcsUri  e.g. `gs://gstar-ai-studio-assets/model-cards/_whitebg/F11_white.png`
 *
 * Returns when the job completes. Throws on failure or timeout.
 */
export async function matteImageToWhiteBg(srcGcsUri: string, dstGcsUri: string): Promise<void> {
  // The matte job also produces a grey variant — write it to a sibling tmp
  // path we won't keep. Required by the job's contract.
  const greyTmp = dstGcsUri.replace(/_white\.png$/, '_grey.png').replace(/\.png$/, '_tmpgrey.png');

  const auth = getAuth();
  const client = await auth.getClient();
  const tokenResp = await client.getAccessToken();
  const token = tokenResp.token;
  if (!token) throw new Error('matteImageToWhiteBg: failed to get access token');

  // Kick off the job execution
  const runResp = await fetch(`${RUN_API_BASE}/jobs/${MATTE_JOB}:run`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      overrides: {
        containerOverrides: [{
          env: [
            { name: 'SRC_GCS_URL',       value: srcGcsUri },
            { name: 'DST_WHITE_GCS_URL', value: dstGcsUri },
            { name: 'DST_GREY_GCS_URL',  value: greyTmp },
            // DISABLE_SHADOW=1 because identity references shouldn't have a
            // contact shadow under the feet (the model is centered on a
            // seamless cove, no floor plane).
            { name: 'DISABLE_SHADOW',    value: '1' },
          ],
        }],
      },
    }),
  });
  if (!runResp.ok) {
    const txt = await runResp.text().catch(() => '');
    throw new Error(`matteImageToWhiteBg: job run failed ${runResp.status}: ${txt.slice(0, 200)}`);
  }
  const op = (await runResp.json()) as JobOperation;
  console.log(`[ModelWhiteBg] matte job started for ${srcGcsUri} → ${op.name.split('/').pop()}`);

  // Poll until done
  const opUrl = `https://run.googleapis.com/v2/${op.name}`;
  const deadline = Date.now() + EXECUTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const pollResp = await fetch(opUrl, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!pollResp.ok) {
      throw new Error(`matteImageToWhiteBg: poll failed ${pollResp.status}`);
    }
    const status = (await pollResp.json()) as JobOperation;
    if (status.done) {
      if (status.error) {
        throw new Error(`matteImageToWhiteBg: job failed: ${status.error.message || 'unknown'}`);
      }
      console.log(`[ModelWhiteBg] matte job complete: ${dstGcsUri}`);
      return;
    }
  }
  throw new Error(`matteImageToWhiteBg: timed out after ${EXECUTION_TIMEOUT_MS / 1000}s`);
}

/** Convenience: GCS URI → HTTPS URL (no cache-buster). */
function gcsToHttps(gcsUri: string): string {
  const m = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) throw new Error(`Invalid GCS URI: ${gcsUri}`);
  return `https://storage.googleapis.com/${m[1]}/${m[2]}`;
}

/** Convenience: HTTPS URL → GCS URI. Assumes storage.googleapis.com host. */
function httpsToGcs(httpsUrl: string): string {
  const url = new URL(httpsUrl);
  const path = url.pathname.replace(/^\//, '');
  const m = path.match(/^([^/]+)\/(.+)$/);
  if (!m) throw new Error(`Cannot parse GCS path from URL: ${httpsUrl}`);
  return `gs://${m[1]}/${m[2]}`;
}

/**
 * High-level helper: take a model record's current reference URL, matte it
 * to pure-white-bg, return the new HTTPS URL (with cache-buster).
 *
 * Caller is responsible for updating the model record in Firestore.
 */
export async function makeWhiteBgRef(currentRefUrl: string, modelId: string, kind: 'front' | 'back' = 'front'): Promise<string> {
  // Strip any cache-buster from input
  const cleanUrl = currentRefUrl.split('?')[0];
  const srcGcs = httpsToGcs(cleanUrl);
  const suffix = kind === 'back' ? '_back_white.png' : '_white.png';
  const dstGcs = `gs://${BUCKET}/model-cards/_whitebg/${modelId}${suffix}`;
  await matteImageToWhiteBg(srcGcs, dstGcs);
  // Return HTTPS URL with cache-buster so future readers don't pick up
  // stale GCS-edge cached versions.
  return gcsToHttps(dstGcs) + `?v=${Date.now()}`;
}
