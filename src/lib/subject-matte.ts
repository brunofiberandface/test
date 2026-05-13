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

/** Retry config for transient Gemini errors (503/429). 2026-05-13 fix —
 *  Kate Boyfriend Jeans 62 shipped shadow-less because all 5 grounding-shadow
 *  calls 503'd on first attempt. Procedural shadow in the matte job is also
 *  re-enabled (see produceBackdropVariants) so failing Gemini still leaves a
 *  soft shadow under the feet; this retry layer further reduces the chance
 *  the Gemini-enhanced shadow is missing. */
const GROUNDING_MAX_ATTEMPTS = 3;
const GROUNDING_RETRY_DELAYS_MS = [5_000, 15_000];

function isTransientGeminiError(msg: string): boolean {
  return /\b(503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|deadline|timeout)\b/i.test(msg);
}

/**
 * Run a Gemini grounding-shadow pass on a backdrop variant.
 *
 * Retries up to 3 times on transient 503/429 errors with exponential backoff.
 * Falls back to the input buffer (returns it unchanged) only after all retries
 * are exhausted — never throws. The shot still completes; with procedural
 * shadow re-enabled in the matte job, the fallback still has a soft shadow.
 */
export async function addGroundingShadowGemini(
  buffer: Buffer,
  mode: 'grey' | 'white',
): Promise<{ buffer: Buffer; ok: boolean; ms: number }> {
  const t0 = Date.now();
  const prompt = mode === 'grey' ? GROUNDING_PROMPT_GREY : GROUNDING_PROMPT_WHITE;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= GROUNDING_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await generateImage({
        prompt,
        referenceImages: [{
          buffer,
          mimeType: 'image/png',
          label: 'SOURCE — preserve subject and backdrop exactly; add only the grounding shadow under the feet.',
        }],
        aspectRatio: GROUNDING_ASPECT,
        imageSize: GROUNDING_SIZE,
        model: 'gemini-3-pro-image-preview',
      });
      const ms = Date.now() - t0;
      if (attempt > 1) {
        console.log(`[GroundingShadow:${mode}] ok in ${ms}ms after ${attempt} attempts (${result.imageData.length} bytes)`);
      } else {
        console.log(`[GroundingShadow:${mode}] ok in ${ms}ms (${result.imageData.length} bytes)`);
      }
      return await postProcessGroundingResult(result.imageData, mode, t0, ms);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient = isTransientGeminiError(msg);
      if (!transient || attempt === GROUNDING_MAX_ATTEMPTS) {
        const ms = Date.now() - t0;
        console.error(`[GroundingShadow:${mode}] FAILED in ${ms}ms after ${attempt} attempt(s) — falling back to no-shadow input:`,
          msg);
        return { buffer, ok: false, ms };
      }
      const delay = GROUNDING_RETRY_DELAYS_MS[attempt - 1] ?? 15_000;
      console.warn(`[GroundingShadow:${mode}] attempt ${attempt} transient error (${msg.slice(0, 80)}…), retrying in ${delay / 1000}s`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  // Unreachable but keeps TS happy
  return { buffer, ok: false, ms: Date.now() - t0 };
}

/**
 * Post-process a successful Gemini grounding output. Handles the
 * snap-to-white step for `mode='white'`. Extracted so the retry loop above
 * can call it cleanly on success without duplicating the snap logic.
 */
async function postProcessGroundingResult(
  imageData: Buffer,
  mode: 'grey' | 'white',
  t0: number,
  ms: number,
): Promise<{ buffer: Buffer; ok: boolean; ms: number }> {
  // ── 2026-05-13 fix: snap near-white pixels to pure #FFFFFF (white only) ──
  // Gemini-3-pro-image-preview occasionally repaints the entire backdrop to
  // its "studio white" interpretation (~#E5E1E1) instead of preserving the
  // pure #FFFFFF that came out of the Cloud Run Job's Python composite.
  // Caught 2026-05-13 on Judee Low Waist Loose Jeans 53 (backdrop=#E5E1E1,
  // 30 units off white). Comparable shots (Raw denim kick jacket, Midge,
  // LOUX) rendered at #FDFDFD/#FEFEFE — so it's intermittent Gemini drift,
  // not systemic.
  //
  // Fix: post-Gemini, walk all pixels and snap any pixel with all three
  // channels > THRESHOLD (240) to exact (255,255,255). Preserves the
  // contact + cast shadow Gemini added (those darker pixels stay below
  // threshold), and forces deterministic pure-white backdrop everywhere
  // else. Cheap: ~50-100ms via sharp.
  if (mode === 'white') {
    try {
      const snapped = await snapNearWhiteToPure(imageData);
      const totalMs = Date.now() - t0;
      console.log(`[GroundingShadow:white] snap-to-white done (+${totalMs - ms}ms, total ${totalMs}ms)`);
      return { buffer: snapped, ok: true, ms: totalMs };
    } catch (snapErr) {
      // Snap is non-blocking — fall back to Gemini's output if sharp fails.
      console.error(`[GroundingShadow:white] snap-to-white FAILED (non-blocking, keeping Gemini output):`,
        snapErr instanceof Error ? snapErr.message : snapErr);
    }
  }

  return { buffer: imageData, ok: true, ms };
}

/**
 * Adaptive snap-to-white: detects the actual backdrop color from the image
 * corners, then snaps every pixel within TOL of that detected color to exact
 * (255, 255, 255). Preserves the subject and shadow regions (which have
 * sufficiently different colors).
 *
 * Why adaptive: a simple "pixels brighter than 240 → snap" misses the
 * 2026-05-13 Judee case where Gemini drifted the entire backdrop to
 * #E5E1E1 (229, 225, 225) — all three channels below 240, so nothing
 * snapped. By sampling the corners first, we identify the actual drift
 * target (whatever Gemini rendered as "the studio white") and snap that
 * specific color range to pure white. Subject/shadow regions stay
 * untouched because their colors fall outside the detected backdrop
 * tolerance.
 *
 * Safety guards:
 *  - If the detected backdrop is already ≥250 across all channels → return
 *    unchanged (no drift to correct).
 *  - If the detected backdrop is <200 across all channels → return unchanged
 *    (subject is in the corner; can't safely identify backdrop).
 *
 * TOL = 15: empirically wide enough to catch JPEG-like compression noise
 * and Gemini's slight per-region variation while narrow enough not to grab
 * light clothing or pale skin.
 */
async function snapNearWhiteToPure(buffer: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;

  const image = sharp(buffer);
  const meta = await image.metadata();
  const { width: w, height: h } = meta;
  if (!w || !h) throw new Error('snapNearWhiteToPure: missing image dimensions');

  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;

  // Detect backdrop color from a 100×100 top-left sample. M03/M04/M06 are
  // 3:4 portrait full-body with the subject vertically centered — the top
  // corners are reliably backdrop.
  const sampleSize = 100;
  let sumR = 0, sumG = 0, sumB = 0, n = 0;
  for (let y = 0; y < sampleSize && y < h; y++) {
    for (let x = 0; x < sampleSize && x < w; x++) {
      const i = (y * w + x) * channels;
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
      n++;
    }
  }
  const bgR = sumR / n;
  const bgG = sumG / n;
  const bgB = sumB / n;

  // Sample doesn't look like backdrop — bail rather than mangle the image.
  if (bgR < 200 || bgG < 200 || bgB < 200) {
    console.log(`[SnapWhite] backdrop sample too dark (${bgR.toFixed(0)},${bgG.toFixed(0)},${bgB.toFixed(0)}) — leaving image unchanged`);
    return buffer;
  }

  // Adaptive TOL: scale with detected drift from pure white.
  //   • Near-white outputs (bg ≥250): use small TOL (5) so we snap JPEG noise
  //     but PRESERVE the genuine grounding shadow Gemini added.
  //   • Drifted outputs (bg in 200..249): use larger TOL proportional to
  //     drift — the shadow on a drifted output is itself drifted, and we
  //     accept losing the soft cast to get a clean pure-white backdrop.
  const minChan = Math.min(bgR, bgG, bgB);
  const drift = 255 - minChan;
  const TOL = Math.max(5, Math.min(20, Math.round(drift)));
  console.log(`[SnapWhite] backdrop=(${bgR.toFixed(0)},${bgG.toFixed(0)},${bgB.toFixed(0)}) drift=${drift.toFixed(0)} TOL=${TOL}`);

  // Snap all pixels within ±TOL of detected backdrop to pure white.
  let snapped = 0;
  for (let i = 0; i < data.length; i += channels) {
    if (
      Math.abs(data[i]     - bgR) <= TOL &&
      Math.abs(data[i + 1] - bgG) <= TOL &&
      Math.abs(data[i + 2] - bgB) <= TOL
    ) {
      data[i]     = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      // alpha (i+3) left alone
      snapped++;
    }
  }
  console.log(`[SnapWhite] snapped ${snapped} pixels (${(snapped / (w * h) * 100).toFixed(1)}%)`);
  return sharp(data, { raw: { width: w, height: h, channels } }).png().toBuffer();
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
              // 2026-05-13: procedural shadow RE-ENABLED as the floor. V4 had
              // disabled it because the Gemini grounding-shadow pass produced
              // higher-quality shadows. But when Gemini 503s (Kate Boyfriend
              // Jeans 62 incident — 5 of 7 grounding calls failed), the shot
              // shipped shadow-less. Procedural baseline guarantees every shot
              // has at least a soft contact + heel shadow under the feet; the
              // Gemini grounding pass still runs on top to refine quality
              // when it's available.
              // (Set DISABLE_SHADOW=1 only for identity reference image
              // mattes — see model-whitebg.ts.)
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
