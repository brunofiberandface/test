/**
 * BytePlus Seedream 4.5 client.
 *
 * Thin wrapper around BytePlus Ark images/generations endpoint.
 * Synchronous API: POST returns the result URL directly (~40–60s per call).
 *
 * Auth: BYTEPLUS_API_KEY env var.
 * Model: seedream-4-5-251128.
 * Region endpoint: ark.ap-southeast.bytepluses.com.
 *
 * We fetch the returned URL immediately and return the image as a Buffer so
 * the caller can feed it into the same uploadGeneratedImage / label composite
 * pipeline that Gemini uses. The Seedream URL is never persisted anywhere.
 */

const BYTEPLUS_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3/images/generations';

/**
 * Default Seedream model. Falls back to 4.5 if SEEDREAM_MODEL env var is unset.
 *
 * Set the env var in Cloud Run to flip the global default without a code
 * deploy. Recognised values:
 *   - seedream-4-5-251128  (Seedream 4.5, current production default)
 *   - seedream-5-0-260128  (Seedream 5.0 Lite — released Feb 2026; cheaper at
 *                           $0.035/image, slightly slower ~100s vs ~50s,
 *                           handles tucked-in tops natively so the tee-edit
 *                           pass can be skipped — see seedream-tee-edit.ts)
 *
 * Per-call override: pass `model` on SeedreamGenerateParams. Useful for A/B
 * testing or rerun-with-different-model from the UI.
 */
const DEFAULT_MODEL = process.env.SEEDREAM_MODEL || 'seedream-4-5-251128';
export const SEEDREAM_MODEL_4_5 = 'seedream-4-5-251128';
export const SEEDREAM_MODEL_5_0 = 'seedream-5-0-260128';

/** Helper: returns true when the given (or default) model is the 5.0 Lite
 *  family. Callers use this to skip the tee-edit pipeline + the
 *  rewriteTopForSeedream override, since 5.0 handles tucked-in tops natively. */
export function isSeedream5(model?: string): boolean {
  return (model || DEFAULT_MODEL).startsWith('seedream-5-');
}

/** Returns the model that will be used given an optional override. */
export function resolveSeedreamModel(override?: string): string {
  return override || DEFAULT_MODEL;
}

// Generation can take 40-70s in production. Give it 3 minutes total.
const REQUEST_TIMEOUT_MS = 180_000;
// Fetching the resulting image is usually <5s.
const DOWNLOAD_TIMEOUT_MS = 30_000;

const MAX_RETRIES = 3;
const RETRY_DELAYS = [15_000, 30_000, 60_000];

export interface SeedreamReferenceImage {
  /** Public URL reachable by BytePlus servers. */
  url: string;
  /** Label used only for logging — Seedream ignores it. */
  label: string;
}

export interface SeedreamGenerateParams {
  prompt: string;
  referenceImages: SeedreamReferenceImage[];
  aspectRatio: '9:16' | '3:4' | '1:1';
  /**
   * Optional explicit size override, e.g. '2592x3456' for high-res M03/M04.
   * If omitted, the default from aspectToSize() is used.
   * Must respect BytePlus constraints: min 3,686,400 pixels, max 4096 on each axis.
   */
  size?: string;
  apiKey?: string;
  /**
   * Optional per-call model override. Defaults to the SEEDREAM_MODEL env var,
   * which itself defaults to 'seedream-4-5-251128'. Use SEEDREAM_MODEL_5_0
   * (= 'seedream-5-0-260128') to call Seedream 5.0 Lite.
   */
  model?: string;
}

export interface SeedreamGenerateResult {
  imageData: Buffer;
  mimeType: string;
  /** The model that actually produced this image (resolved from override or env var). */
  model: string;
}

/**
 * Map our supported aspect ratios to BytePlus size strings.
 *
 * 2026-05-13: bumped from 2K to 4K native output across all aspects.
 * Seedream 4.5 supports up to 4096×4096 (verified empirically + documented
 * at the official BytePlus / WaveSpeedAI / AIML docs). Cost is FLAT per call
 * regardless of resolution ($0.04/image), so 4K is a 4× pixel gain for free.
 * Generation time goes up modestly: ~25s for non-square 4K vs ~14s for 2K,
 * and ~48s for square 4K vs ~24s for square 2K.
 *
 * Why this matters: M01/M02 pants source resolution goes from ~1300×1300
 * (cropped from M03 then lanczos-upscaled, washed out) to native 4K. AI
 * super-resolution was unable to recover detail that wasn't there in the
 * source — generating at 4K native is the only real fix.
 *
 * BytePlus minimum is 3,686,400 pixels (verified empirically). All sizes
 * below are at the 4K cap.
 */
function aspectToSize(aspect: '9:16' | '3:4' | '1:1'): string {
  switch (aspect) {
    case '9:16': return '2304x4096'; // 9.44M pixels (was 1472x2624 = 3.86M)
    case '3:4':  return '3072x4096'; // 12.58M pixels (was 1728x2304 = 3.98M)
    case '1:1':  return '4096x4096'; // 16.78M pixels (was 2048x2048 = 4.19M)
  }
}

export async function generateSeedreamImage(params: SeedreamGenerateParams): Promise<SeedreamGenerateResult> {
  const { prompt, referenceImages, aspectRatio, size: sizeOverride, apiKey: paramKey, model: modelOverride } = params;

  const apiKey = paramKey || process.env.BYTEPLUS_API_KEY;
  if (!apiKey) {
    throw new Error('BYTEPLUS_API_KEY not set (neither param nor env var)');
  }

  if (referenceImages.length === 0) {
    throw new Error('Seedream requires at least one reference image URL');
  }
  if (referenceImages.length > 10) {
    // BytePlus limit is 10; truncating would lose context. Fail loud.
    throw new Error(`Seedream supports max 10 reference images, got ${referenceImages.length}`);
  }

  const resolvedModel = resolveSeedreamModel(modelOverride);

  // Path B (2026-05-10 experiment): prepend a "Reference image inventory" block
  // to the prompt so the per-ref label scoping ACTUALLY reaches Seedream.
  // Previously labels were logging-only (BytePlus accepts only `image: [urls]`).
  // Discovery: labels-don't-reach-Seedream was the architecture from day one
  // (April 22 commit). Phase B / M05 layering / expression / shoe-size scoping
  // deploys (May 8–10) were no-ops because of this. Testing whether labels
  // injected into the prompt body restore their intended effect.
  const inventory = referenceImages
    .map((r, i) => `Image ${i + 1}: ${r.label}`)
    .join('\n');
  const promptWithInventory = `REFERENCE IMAGE INVENTORY (these are the images sent with this request, in slot order — use the descriptions to know what each image is for):\n${inventory}\n\n---\n\n${prompt}`;

  const body = {
    model: resolvedModel,
    prompt: promptWithInventory,
    image: referenceImages.map(r => r.url),
    size: sizeOverride || aspectToSize(aspectRatio),
    response_format: 'url' as const,
    watermark: false,
  };

  console.log(`[Seedream] Generating: model=${resolvedModel}, refs=${referenceImages.length}, size=${body.size}, key=...${apiKey.slice(-4)}`);

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(BYTEPLUS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify(body),
      });

      if (response.status === 429) {
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS[attempt];
          console.warn(`[Seedream] Rate limited (429), retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Seedream rate limited (429) after ${MAX_RETRIES} retries`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        // 4xx besides 429 are usually bad requests — don't retry, fail loudly.
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`Seedream ${response.status}: ${errorText.substring(0, 400)}`);
        }
        // 5xx — retry
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS[attempt];
          console.warn(`[Seedream] Server error ${response.status}, retrying in ${delay / 1000}s`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Seedream ${response.status}: ${errorText.substring(0, 400)}`);
      }

      const result = await response.json() as {
        data?: Array<{ url?: string; size?: string }>;
        usage?: { generated_images?: number; output_tokens?: number; total_tokens?: number };
        error?: { message?: string; code?: string };
      };

      if (result.error) {
        throw new Error(`Seedream API error: ${result.error.code || ''} ${result.error.message || JSON.stringify(result.error)}`);
      }

      const resultUrl = result.data?.[0]?.url;
      if (!resultUrl) {
        throw new Error(`Seedream returned no image URL: ${JSON.stringify(result).substring(0, 400)}`);
      }

      console.log(`[Seedream] Result URL received, fetching image...`);

      // Fetch the generated image into a Buffer.
      const imgResponse = await fetch(resultUrl, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!imgResponse.ok) {
        throw new Error(`Seedream image fetch failed: ${imgResponse.status}`);
      }

      const arrayBuffer = await imgResponse.arrayBuffer();
      const imageData = Buffer.from(arrayBuffer);
      const mimeType = imgResponse.headers.get('content-type') || 'image/png';

      console.log(`[Seedream] Image downloaded: ${imageData.length} bytes, ${mimeType}, model=${resolvedModel}`);

      return { imageData, mimeType, model: resolvedModel };

    } catch (error) {
      lastError = error;
      const msg = (error as Error).message || '';
      const errName = (error as Error).name || '';
      const isTimeout = errName === 'TimeoutError' || msg.includes('abort') || msg.includes('timed out');
      const isNetworkError =
        msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') ||
        msg.includes('ENOTFOUND') || msg.includes('fetch failed');

      if ((isTimeout || isNetworkError) && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt];
        console.warn(`[Seedream] ${isTimeout ? 'Timeout' : 'Network error'} (${msg}), retrying in ${delay / 1000}s`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Seedream generation failed after all retries');
}
