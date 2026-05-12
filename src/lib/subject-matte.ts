/**
 * Subject matte + backdrop variants — Cloud Run Job orchestration + Gemini
 * grounding shadow.
 *
 * Architecture decision history (LEARNINGS #77, #78, #79, #81):
 *   - V1 (rembg in main service via subprocess) — silent CPU-throttle hang in
 *     production, rolled back. Source preserved at subject-matte.rembg-bak.ts.
 *   - V2 (Gemini-mask in main service) — works but variable hair quality.
 *   - V3: rembg in a separate Cloud Run JOB with always-on CPU + procedural
 *     shadow inside the job. Procedural shadow (cast + heel pad) ultimately
 *     looked stamped/floating on a wide range of poses (LEARNINGS #80–#81).
 *   - V4 (this file): rembg in Cloud Run Job for the matte ONLY (always
 *     `disable_shadow=true`), then the main service runs a Gemini-3-pro-image-
 *     preview "grounding shadow" pass on each backdrop variant in parallel.
 *     Validated on M06 male sneakers + Slide1 female stiletto heels — matte
 *     preserves footwear, Gemini adds subtle contact + faint cast without
 *     altering the subject. ~$0.48/shot extra (~$1.44/job for M03+M04+M06).
 *
 * Cloud Run Job: `subject-matte-job` in europe-west1.
 * Source: cloud-run-job-matte/ (Dockerfile + job_main.py + subject_matte.py).
 *
 * Grounding-shadow prompts (grey v3 + white v5) are HARDCODED below to match
 * the existing `seedream-tee-edit.ts` pattern. Move to prompt-vault if/when
 * UI-side iteration is needed.
 */

import { Storage } from '@google-cloud/storage';
import { GoogleAuth } from 'google-auth-library';
import { generateImage } from '@/lib/vertex';

const PROJECT = process.env.GCP_PROJECT_ID || 'gstar-ai-studio';
const REGION = 'europe-west1';
const JOB_NAME = 'subject-matte-job';
const BUCKET = 'gstar-ai-studio-assets';
const TEMP_PREFIX = 'matte-tmp';

// Per-execution timeout. Job's task-timeout is 300s; we wait a bit longer to
// account for execution-start scheduling + image download.
const EXECUTION_TIMEOUT_MS = 360_000;
const POLL_INTERVAL_MS = 2_500;

const RUN_API_BASE = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}`;

let _auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!_auth) {
    _auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }
  return _auth;
}

let _storage: Storage | null = null;
function getStorage(): Storage {
  if (!_storage) _storage = new Storage({ projectId: PROJECT });
  return _storage;
}

export interface BackdropVariantsResult {
  whiteBuffer: Buffer;
  greyBuffer: Buffer;
  uploadMs?: number;
  jobMs?: number;
  downloadMs?: number;
  geminiMs?: number;
  geminiSkipped?: boolean;  // true when options.disableShadow=true (M05)
}

export interface ProduceOptions {
  /** True for shots with no feet visible (M05). Skips procedural shadow in
   *  the Cloud Run Job AND the Gemini grounding pass. */
  disableShadow?: boolean;
}

// ── Grounding-shadow prompts ────────────────────────────────────────────────
// Locked by Bruno on 2026-05-06 after testing M06 male sneakers + Slide1
// female stiletto heels. See LEARNINGS #81 for context.

const GROUNDING_PROMPT_GREY = `Edit this e-commerce studio photo to ground the model on the floor. The model is currently floating because there is no shadow.

ADD the following:
1. A subtle ground contact shadow directly beneath the soles and heels of the model's shoes — small, dense, soft-edged, anchored at the foot/floor interface.
2. A very faint, soft directional ground shadow extending slightly to the model's left — barely perceptible, fading out quickly into the backdrop within roughly the width of one foot. NOT a long body-silhouette projection. Just a soft hint of cast direction.

The combined effect should be subtle: the model is firmly grounded but the shadow does not dominate the composition. Think soft natural studio lighting, not dramatic directional light.

PRESERVE EVERYTHING ELSE EXACTLY:
- Same model identity, face, hair, body proportions, pose
- Same clothing, fabric texture, garment color
- Same backdrop color and tone
- Same framing, composition, aspect ratio, resolution
- Same overall studio lighting

Only change: add the subtle contact + faint directional shadow described above.`;

const GROUNDING_PROMPT_WHITE = `Edit this e-commerce studio photo to ground the model on the floor. The model is currently floating because there is no shadow.

ADD the following:
1. A subtle ground contact shadow directly beneath the soles and heels of the model's shoes — small, dense, soft-edged, anchored at the foot/floor interface.
2. A barely-there hint of directional shadow extending just slightly past the model's left foot — no more than half a foot-length, very low opacity, fading immediately into the backdrop. This should read as a soft asymmetry of the contact darkening, NOT as a real cast shadow. Just a tiny lean leftward.

The combined effect should be very soft and minimal: contact under the shoes plus a barely perceptible leftward asymmetry. Think soft diffuse natural lighting, not directional.

PRESERVE EVERYTHING ELSE EXACTLY:
- Same model identity, face, hair, body proportions, pose
- Same clothing, fabric texture, garment color
- Same backdrop color and tone
- Same framing, composition, aspect ratio, resolution
- Same overall studio lighting

Only change: add the subtle contact + barely-there leftward lean described above.`;

const GROUNDING_ASPECT = '3:4';
const GROUNDING_SIZE = '4K';

/**
 * Run a Gemini grounding-shadow pass on a no-shadow backdrop variant.
 *
 * Falls back to the input buffer (returns it unchanged) on any Gemini error —
 * never throws. The shot still completes; the variant just looks "floating"
 * but is otherwise valid.
 */
export async function addGroundingShadowGemini(
  buffer: Buffer,
  mode: 'grey' | 'white',
): Promise<{ buffer: Buffer; ok: boolean; ms: number }> {
  const t0 = Date.now();
  const prompt = mode === 'grey' ? GROUNDING_PROMPT_GREY : GROUNDING_PROMPT_WHITE;
  try {
    const result = await generateImage({
      prompt,
      referenceImages: [{
        buffer,
        mimeType: 'image/png',
        label: 'SOURCE — no-shadow matted composite. Subject and backdrop must be preserved exactly.',
      }],
      aspectRatio: GROUNDING_ASPECT,
      imageSize: GROUNDING_SIZE,
      model: 'gemini-3-pro-image-preview',
    });
    const ms = Date.now() - t0;
    console.log(`[GroundingShadow:${mode}] ok in ${ms}ms (${result.imageData.length} bytes)`);
    return { buffer: result.imageData, ok: true, ms };
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(`[GroundingShadow:${mode}] FAILED in ${ms}ms — falling back to no-shadow input:`,
      err instanceof Error ? err.message : err);
    return { buffer, ok: false, ms };
  }
}

interface JobOperation {
  name: string;
  done?: boolean;
  error?: { code?: number; message?: string };
  response?: unknown;
}

/**
 * Top-level entry: produce white-bg + brand-grey-bg masters by orchestrating
 * the subject-matte-job Cloud Run Job.
 *
 * Returns null on any failure (auth, GCS, job execution). Caller falls back
 * to the raw Seedream master, same back-compat contract as V1/V2.
 */
export async function produceBackdropVariants(
  sourceBuffer: Buffer,
  options: ProduceOptions = {},
): Promise<BackdropVariantsResult | null> {
  const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const srcKey = `${TEMP_PREFIX}/${tempId}/src.png`;
  const whiteKey = `${TEMP_PREFIX}/${tempId}/white.png`;
  const greyKey = `${TEMP_PREFIX}/${tempId}/grey.png`;

  try {
    // 1. Upload source to GCS
    const uploadStart = Date.now();
    const storage = getStorage();
    const bucket = storage.bucket(BUCKET);
    await bucket.file(srcKey).save(sourceBuffer, {
      metadata: { contentType: 'image/png' },
    });
    const uploadMs = Date.now() - uploadStart;
    console.log(`[SubjectMatte] uploaded source to gs://${BUCKET}/${srcKey} (${uploadMs}ms, ${sourceBuffer.length} bytes)`);

    // 2. Trigger Cloud Run Job execution with env overrides
    const jobStart = Date.now();
    const auth = getAuth();
    const client = await auth.getClient();
    const tokenResp = await client.getAccessToken();
    const token = tokenResp.token;
    if (!token) throw new Error('failed to get access token');

    const runResp = await fetch(`${RUN_API_BASE}/jobs/${JOB_NAME}:run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        overrides: {
          containerOverrides: [{
            env: [
              { name: 'SRC_GCS_URL',       value: `gs://${BUCKET}/${srcKey}` },
              { name: 'DST_WHITE_GCS_URL', value: `gs://${BUCKET}/${whiteKey}` },
              { name: 'DST_GREY_GCS_URL',  value: `gs://${BUCKET}/${greyKey}` },
              // ALWAYS disable the Job's procedural shadow — Gemini owns the
              // grounding-shadow pass now (V4). The Job only does the matte.
              { name: 'DISABLE_SHADOW',    value: '1' },
            ],
          }],
        },
      }),
    });
    if (!runResp.ok) {
      const txt = await runResp.text();
      throw new Error(`job run API ${runResp.status}: ${txt.slice(0, 300)}`);
    }
    const operation = (await runResp.json()) as JobOperation;
    const opName = operation.name;
    console.log(`[SubjectMatte] job execution started: ${opName}`);

    // 3. Poll operation until done (or timeout)
    const opUrl = `https://run.googleapis.com/v2/${opName}`;
    const deadline = Date.now() + EXECUTION_TIMEOUT_MS;
    let done = false;
    let lastStatus: JobOperation | null = null;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      const pollResp = await fetch(opUrl, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!pollResp.ok) {
        const txt = await pollResp.text();
        throw new Error(`operation poll API ${pollResp.status}: ${txt.slice(0, 200)}`);
      }
      lastStatus = (await pollResp.json()) as JobOperation;
      if (lastStatus.done) { done = true; break; }
    }
    if (!done) {
      throw new Error(`job execution timed out after ${EXECUTION_TIMEOUT_MS / 1000}s`);
    }
    if (lastStatus?.error) {
      throw new Error(`job execution failed: ${lastStatus.error.message || 'unknown'} (code=${lastStatus.error.code})`);
    }
    const jobMs = Date.now() - jobStart;
    console.log(`[SubjectMatte] job execution complete in ${jobMs}ms`);

    // 4. Download white + grey results from GCS
    const downloadStart = Date.now();
    const [whiteBufferRaw, greyBufferRaw] = await Promise.all([
      bucket.file(whiteKey).download().then(([b]) => b),
      bucket.file(greyKey).download().then(([b]) => b),
    ]);
    const downloadMs = Date.now() - downloadStart;
    console.log(`[SubjectMatte] downloaded outputs in ${downloadMs}ms (white=${whiteBufferRaw.length}B grey=${greyBufferRaw.length}B)`);

    // 5. Gemini grounding shadow — parallel pass on each backdrop variant.
    // Skipped for shots without feet visible (M05) — those stay no-shadow.
    if (options.disableShadow) {
      console.log(`[SubjectMatte] disableShadow=true → skipping Gemini grounding pass`);
      return {
        whiteBuffer: whiteBufferRaw,
        greyBuffer: greyBufferRaw,
        uploadMs, jobMs, downloadMs,
        geminiSkipped: true,
      };
    }

    const geminiStart = Date.now();
    const [whiteShadowed, greyShadowed] = await Promise.all([
      addGroundingShadowGemini(whiteBufferRaw, 'white'),
      addGroundingShadowGemini(greyBufferRaw, 'grey'),
    ]);
    const geminiMs = Date.now() - geminiStart;
    console.log(`[SubjectMatte] Gemini grounding done in ${geminiMs}ms (white_ok=${whiteShadowed.ok} grey_ok=${greyShadowed.ok})`);

    return {
      whiteBuffer: whiteShadowed.buffer,
      greyBuffer:  greyShadowed.buffer,
      uploadMs, jobMs, downloadMs, geminiMs,
    };
  } catch (err) {
    console.error('[SubjectMatte] produceBackdropVariants failed (non-blocking, keeping raw master):',
      err instanceof Error ? err.message : err);
    return null;
  } finally {
    // Best-effort cleanup of temp GCS objects (don't block the caller)
    void cleanupTempFiles([srcKey, whiteKey, greyKey]).catch(() => { /* ignore */ });
  }
}

async function cleanupTempFiles(keys: string[]): Promise<void> {
  const bucket = getStorage().bucket(BUCKET);
  await Promise.all(keys.map(k =>
    bucket.file(k).delete().catch(() => { /* ignore — file may not exist */ })
  ));
}
