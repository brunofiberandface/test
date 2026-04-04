/**
 * Vertex AI Gemini client — v2 Pro pipeline.
 *
 * Two models:
 * - gemini-3-pro-image-preview: Image generation (4K native)
 * - gemini-2.5-flash-lite: Silhouette analysis (text-only, fast)
 *
 * Uses Vertex AI global endpoint with OAuth.
 * Project: gstar-ai-studio (same project for auth + API).
 */

export interface ReferenceImage {
  buffer: Buffer;
  mimeType: string;
  label: string;
}

export interface GenerateImageParams {
  prompt: string;
  referenceImages?: ReferenceImage[];
  aspectRatio?: string;   // '9:16' for full-body, '3:4' for detail/crops
  imageSize?: string;     // '4K' for Pro native upscaler
  model?: string;
  seed?: number;
}

export interface GenerateImageResult {
  imageData: Buffer;
  mimeType: string;
}

export interface AnalyzeParams {
  prompt: string;
  images: { buffer: Buffer; mimeType: string }[];
  model?: string;
  temperature?: number;
}

// Retry config
const MAX_RETRIES = 3;
const RETRY_DELAYS = [45000, 60000, 90000];
const NETWORK_RETRY_DELAYS = [10000, 20000, 30000];

// GCP project — consistent across auth + API URL
function getGcpProject(): string {
  return process.env['GCP_PROJECT'] || 'gstar-ai-studio';
}

function getVertexUrl(model: string): string {
  const project = getGcpProject();
  return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`;
}

// Token cache
let cachedToken: { token: string; expiresAt: number } | null = null;
let refreshPromise: Promise<string> | null = null;

async function getCachedAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 300_000) {
    return cachedToken.token;
  }
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const { token, expiresIn } = await getAccessToken();
      const ttlMs = (expiresIn || 3600) * 1000;
      cachedToken = { token, expiresAt: now + ttlMs };
      console.log(`[Vertex] Token refreshed, expires in ${Math.round(ttlMs / 60000)}m`);
      return token;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/**
 * Generate an image using Gemini Pro.
 * Default: 4K resolution, 9:16 aspect ratio.
 */
export async function generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  const {
    prompt,
    referenceImages,
    aspectRatio = '9:16',
    imageSize = '4K',
    model = 'gemini-3-pro-image-preview',
    seed,
  } = params;

  const parts: Array<Record<string, unknown>> = [];

  // Images first, then prompt — per Gemini best practice
  if (referenceImages?.length) {
    for (const ref of referenceImages) {
      parts.push({
        inlineData: {
          mimeType: ref.mimeType,
          data: ref.buffer.toString('base64'),
        },
      });
      if (ref.label) {
        parts.push({ text: ref.label + '\n\n' });
      }
    }
  }

  parts.push({ text: prompt });

  const url = getVertexUrl(model);
  const accessToken = await getCachedAccessToken();

  console.log(`[Vertex] Generating: model=${model}, images=${referenceImages?.length || 0}, aspect=${aspectRatio}, size=${imageSize}`);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(300_000),
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            temperature: 1.0,
            ...(seed != null ? { seed } : {}),
            imageConfig: {
              aspectRatio,
              imageSize,
            },
          },
        }),
      });

      if (response.status === 429) {
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS[attempt];
          console.warn(`[Vertex] Rate limited (429), retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Vertex AI rate limited (429) after ${MAX_RETRIES} retries`);
      }

      if (response.status === 401 || response.status === 403) {
        console.warn(`[Vertex] Auth error ${response.status}, refreshing token...`);
        cachedToken = null;
        await getCachedAccessToken();
        if (attempt < MAX_RETRIES) continue;
        const error = await response.text();
        throw new Error(`Vertex AI auth error ${response.status}: ${error.substring(0, 200)}`);
      }

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Vertex AI error ${response.status}: ${error}`);
      }

      const result = await response.json();
      const candidate = result.candidates?.[0];
      if (!candidate?.content?.parts) {
        if (attempt < MAX_RETRIES) {
          console.warn(`[Vertex] Empty response (safety filter?), retrying (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
          continue;
        }
        throw new Error('No image generated — empty response after retries');
      }

      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          return {
            imageData: Buffer.from(part.inlineData.data, 'base64'),
            mimeType: part.inlineData.mimeType || 'image/png',
          };
        }
      }

      throw new Error('No image data in response');

    } catch (error) {
      const msg = (error as Error).message || '';
      const errName = (error as Error).name || '';
      const isRateLimit = msg.includes('429');
      const isTimeout = errName === 'TimeoutError' || msg.includes('abort') || msg.includes('timed out');
      const isNetworkError =
        msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') ||
        msg.includes('ENOTFOUND') || msg.includes('fetch failed');

      if (isTimeout && attempt < 1) {
        console.warn(`[Vertex] Timeout — retrying once`);
        await new Promise(r => setTimeout(r, 5_000));
        continue;
      }
      if (attempt < MAX_RETRIES && (isRateLimit || isNetworkError)) {
        const delay = isRateLimit ? RETRY_DELAYS[attempt] : NETWORK_RETRY_DELAYS[attempt];
        console.warn(`[Vertex] ${isRateLimit ? 'Rate limit' : 'Network error'}, retrying in ${delay / 1000}s`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }

  throw new Error('Generation failed after all retries');
}

/**
 * Run text analysis via Flash Lite (silhouette analysis, etc.)
 * Returns plain text response.
 */
export async function analyzeWithFlashLite(params: AnalyzeParams): Promise<string> {
  const {
    prompt,
    images,
    model = 'gemini-2.5-flash-lite',
    temperature = 0.3,
  } = params;

  const parts: Array<Record<string, unknown>> = [];

  for (const img of images) {
    parts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.buffer.toString('base64'),
      },
    });
  }
  parts.push({ text: prompt });

  const url = getVertexUrl(model);
  const accessToken = await getCachedAccessToken();

  console.log(`[Vertex] Analyzing: model=${model}, images=${images.length}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature,
        responseMimeType: 'text/plain',
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Flash Lite analysis error ${response.status}: ${error.substring(0, 300)}`);
  }

  const result = await response.json();
  const candidate = result.candidates?.[0];
  if (!candidate?.content?.parts) {
    throw new Error('Empty analysis response');
  }

  const textParts = candidate.content.parts.filter((p: any) => p.text);
  return textParts.map((p: any) => p.text).join('');
}

/**
 * Get OAuth access token for Vertex AI.
 * Cloud Run: metadata server. Local: service account key.
 */
async function getAccessToken(): Promise<{ token: string; expiresIn: number }> {
  // Cloud Run metadata server (fast path)
  try {
    const resp = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) }
    );
    if (resp.ok) {
      const data = await resp.json();
      return { token: data.access_token, expiresIn: data.expires_in || 3600 };
    }
  } catch {
    // Not on Cloud Run
  }

  // Service account key (local dev)
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    throw new Error('No GOOGLE_APPLICATION_CREDENTIALS set for local development');
  }

  const fs = await import('fs');
  const crypto = await import('crypto');
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${encode(header)}.${encode(payload)}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(key.private_key, 'base64url');
  const jwt = `${unsigned}.${signature}`;

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResp.json();
  return { token: tokenData.access_token, expiresIn: tokenData.expires_in || 3600 };
}
