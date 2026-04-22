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
const MODEL = 'seedream-4-5-251128';

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
  aspectRatio: '9:16' | '3:4';
  /**
   * Optional explicit size override, e.g. '2592x3456' for high-res M03/M04.
   * If omitted, the default from aspectToSize() is used.
   * Must respect BytePlus constraints: min 3,686,400 pixels, max 4096 on each axis.
   */
  size?: string;
  apiKey?: string;
}

export interface SeedreamGenerateResult {
  imageData: Buffer;
  mimeType: string;
}

/**
 * Map our two aspect ratios to BytePlus size strings.
 * Both ~2K so fidelity matches the Gemini 2K target.
 *
 * BytePlus requires a minimum of 3,686,400 pixels (verified empirically from
 * their 400 error — "image size must be at least 3686400 pixels"). Earlier
 * 3:4 = 1440x1920 (2.77M pixels) was rejected. 1728x2304 = 3.98M pixels,
 * exact 3:4 aspect, safely above the floor.
 */
function aspectToSize(aspect: '9:16' | '3:4'): string {
  switch (aspect) {
    case '9:16': return '1472x2624'; // 3.86M pixels
    case '3:4':  return '1728x2304'; // 3.98M pixels
  }
}

export async function generateSeedreamImage(params: SeedreamGenerateParams): Promise<SeedreamGenerateResult> {
  const { prompt, referenceImages, aspectRatio, size: sizeOverride, apiKey: paramKey } = params;

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

  const body = {
    model: MODEL,
    prompt,
    image: referenceImages.map(r => r.url),
    size: sizeOverride || aspectToSize(aspectRatio),
    response_format: 'url' as const,
    watermark: false,
  };

  console.log(`[Seedream] Generating: refs=${referenceImages.length}, size=${body.size}, key=...${apiKey.slice(-4)}`);

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

      console.log(`[Seedream] Image downloaded: ${imageData.length} bytes, ${mimeType}`);

      return { imageData, mimeType };

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
