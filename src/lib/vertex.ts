/**
 * Vertex AI Gemini image generation client.
 * Uses Vertex AI global endpoint (aiplatform.googleapis.com) with OAuth — 3-4x faster than the free Developer API.
 *
 * Supports multiple reference images:
 * - Garment flat image (primary visual reference)
 * - 360° garment angles (secondary references)
 * - Model card (identity reference)
 */

interface ReferenceImage {
  buffer: Buffer;
  mimeType: string;
  label: string;
}

interface GenerateImageParams {
  prompt: string;
  referenceImages?: ReferenceImage[];  // Multiple reference images with labels
  referenceImage?: Buffer;              // Legacy: single model card image
  aspectRatio?: string;
  imageSize?: string;
  model?: string;                       // Optional model override (default: gemini-3.1-flash-image-preview)
  seed?: number;                        // Fixed seed for cross-view consistency (1-2147483647)
}

interface GenerateImageResult {
  imageData: Buffer;
  mimeType: string;
}

// Retry config for 429 rate limits — generous backoff to survive Gemini throttling
const MAX_RETRIES = 3;
const RETRY_DELAYS = [45000, 60000, 90000];
const NETWORK_RETRY_DELAYS = [10000, 20000, 30000];

// GCP project for Vertex AI — the project linked to the service account
const GCP_PROJECT = process.env.GCP_PROJECT || 'gen-lang-client-0396152930';

// Token cache — reuse OAuth tokens (metadata server returns expires_in)
let cachedToken: { token: string; expiresAt: number } | null = null;
// Mutex: prevent concurrent token refreshes (metadata server can throttle/stale)
let refreshPromise: Promise<string> | null = null;

async function getCachedAccessToken(): Promise<string> {
  const now = Date.now();
  // Refresh 5 minutes before expiry
  if (cachedToken && cachedToken.expiresAt > now + 300_000) {
    return cachedToken.token;
  }
  // Mutex — if another request is already refreshing, wait for it
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = (async () => {
    try {
      const { token, expiresIn } = await getAccessToken();
      // Use actual expires_in from metadata server (default 3600s if missing)
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

export async function generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  const {
    prompt,
    referenceImages,
    referenceImage,
    aspectRatio = '3:4',
    imageSize = '2K',
    model = 'gemini-3.1-flash-image-preview',
    seed,
  } = params;

  // Build request parts — images first, then prompt text
  const parts: Array<Record<string, unknown>> = [];

  // Multiple reference images with labels
  if (referenceImages?.length) {
    for (const ref of referenceImages) {
      parts.push({
        inlineData: {
          mimeType: ref.mimeType,
          data: ref.buffer.toString('base64'),
        },
      });
      parts.push({
        text: ref.label + '\n\n',
      });
    }
  }
  // Legacy fallback: single reference image
  else if (referenceImage) {
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: referenceImage.toString('base64'),
      },
    });
    parts.push({
      text: 'This is the model identity reference photo. The person in the generated image MUST be this exact same person — same face, same features, same body type.\n\n',
    });
  }

  // Add the main prompt
  parts.push({ text: prompt });

  // Vertex AI global endpoint — 3-4x faster than generativelanguage.googleapis.com
  const url = `https://aiplatform.googleapis.com/v1/projects/${GCP_PROJECT}/locations/global/publishers/google/models/${model}:generateContent`;

  // Get OAuth token (cached, auto-refreshes)
  const accessToken = await getCachedAccessToken();

  // Retry loop for rate limits
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Vertex AI is much faster (~30-50s vs 120-180s on free API).
      // With color anchors we now send up to 20 reference images — can take 200-250s.
      const timeoutMs = 300_000;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseModalities: ['IMAGE'],
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
        // Token might have expired — refresh and retry once
        console.warn(`[Vertex] Auth error ${response.status}, refreshing token...`);
        cachedToken = null;
        const newToken = await getCachedAccessToken();
        if (attempt < MAX_RETRIES) {
          // Retry with fresh token on next loop iteration
          continue;
        }
        const error = await response.text();
        throw new Error(`Vertex AI auth error ${response.status}: ${error.substring(0, 200)}`);
      }

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Vertex AI error ${response.status}: ${error}`);
      }

      const result = await response.json();

      // Extract image from response
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
      // With heavy payloads (20 ref images), timeouts can happen — allow 1 retry.
      const isNetworkError =
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('fetch failed');
      if (isTimeout) {
        if (attempt < 1) {
          console.warn(`[Vertex] Timeout after 300s — retrying once (attempt ${attempt + 1}/${MAX_RETRIES}): ${msg.substring(0, 120)}`);
          await new Promise(r => setTimeout(r, 5_000));
          continue;
        }
        console.error(`[Vertex] Timeout after 300s — giving up (attempt ${attempt + 1}/${MAX_RETRIES}): ${msg.substring(0, 120)}`);
        throw error;
      }
      if (attempt < MAX_RETRIES && (isRateLimit || isNetworkError)) {
        const delay = isRateLimit ? RETRY_DELAYS[attempt] : NETWORK_RETRY_DELAYS[attempt];
        const reason = isRateLimit ? 'Rate limit' : 'Network error';
        console.warn(`[Vertex] ${reason}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES}): ${msg.substring(0, 120)}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }

  throw new Error('Generation failed after all retries');
}

/**
 * Generate a model card image — the model is shown wearing VERY SHORT compression shorts (boxer-brief length).
 * This avoids Gemini RAI content filter issues while keeping legs bare for denim generation.
 */
export async function generateModelCard(description: string, gender: 'male' | 'female'): Promise<string | null> {
  const cleanDescription = description.replace(/^["']/, '').trim();

  // VERY short compression shorts — boxer-brief length, max 15cm inseam.
  // Must be shorter than cycling shorts to prevent legging bleed into denim generation.
  const baseLayerDesc = gender === 'male'
    ? `MANDATORY OUTFIT — EXACT SPECIFICATION:
- BOTTOM: Black compression BOXER BRIEFS — these are VERY SHORT underwear-style shorts. Maximum 15cm inseam. They end at UPPER THIGH, well above the knee. The KNEES, SHINS, and CALVES are completely BARE SKIN. Think men's boxer briefs or running shorts — NOT cycling shorts, NOT mid-thigh, NOT knee-length, NOT leggings.
- TOP: Plain white fitted crew-neck t-shirt with G-Star small logo on chest. No other branding.
- FEET: Barefoot on white studio floor.
CRITICAL: If the shorts extend past upper-thigh or reach the knee, you have FAILED. The legs below upper-thigh must be bare skin.`
    : `MANDATORY OUTFIT — EXACT SPECIFICATION:
- BOTTOM: Black compression BOXER BRIEFS — these are VERY SHORT underwear-style shorts. Maximum 15cm inseam. They end at UPPER THIGH, well above the knee. The KNEES, SHINS, and CALVES are completely BARE SKIN. Think boy-short underwear — NOT cycling shorts, NOT mid-thigh, NOT knee-length, NOT leggings.
- TOP: Plain white fitted tank top with thin shoulder straps and G-Star small logo. No other branding.
- FEET: Barefoot on white studio floor.
CRITICAL: If the shorts extend past upper-thigh or reach the knee, you have FAILED. The legs below upper-thigh must be bare skin.`;

  // Gender-aware ECOM posing
  const ecomPose = gender === 'female'
    ? 'Slight hip tilt, soft knee bend, weight on one leg — feminine and confident. One hand lightly at hip. NOT stiff military stance.'
    : 'Relaxed stance, slight weight shift. Arms relaxed at sides. NOT rigid or stiff.';

  // Random variation token ensures each regeneration produces a different result
  const variationSeed = Math.random().toString(36).substring(2, 8);

  const prompt = `Full-body fashion model reference photograph — ${variationSeed}

Subject: ${cleanDescription}

${baseLayerDesc}

PROPORTIONS — standard full-body fashion proportion. Complete body visible crown to heel. Head is one-eighth of total body height. Waistband sits at mid-body. Knees at three-quarter height. DO NOT render any text, numbers, labels, annotations, or percentage markers in the image — clean photograph only.

EXPRESSION (G-STAR ECOM STANDARD — MANDATORY): MOUTH CLOSED. Lips pressed TOGETHER. NO TEETH VISIBLE. NO SMILE. NO GRIN. Cool, self-assured composure — confident and approachable through the EYES, not through a smile. Chin slightly up. Eyes on camera. Think "I know I look good" — NOT "say cheese". If teeth are visible, the image is WRONG.

FRAME — complete full body:
  Top: small white margin above crown
  Head and face fully visible
  Full torso visible
  Full legs visible — BARE from upper thigh down
  Feet flat on white studio floor
  Bottom: white floor surface visible below feet

Camera: 85mm, 5 meters from subject. Complete body crown-to-heel in frame. NOT a portrait crop.
Studio: White seamless backdrop, white floor visible. LIGHTING: Warm directional studio light with subtle shadow contrast — NOT flat/clinical. Warmer skin tones.
Pose: ${ecomPose}
Photorealistic.`;

  try {
    const result = await generateImage({
      prompt,
      aspectRatio: '3:4',  // 3:4 prevents head cutoff — 9:16 was too narrow, forcing zoom-in
      imageSize: '2K',
    });

    return result.imageData.toString('base64');
  } catch (error) {
    console.error('Error generating model card:', error);
    return null;
  }
}

/**
 * Get access token for Vertex AI API.
 * On Cloud Run: uses metadata server (fast, no credentials needed).
 * Locally: uses service account key (GOOGLE_APPLICATION_CREDENTIALS).
 */
async function getAccessToken(): Promise<{ token: string; expiresIn: number }> {
  // Try Cloud Run metadata server first
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
    // Not on Cloud Run — fall through to service account
  }

  // Fall back to service account key (local development)
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    throw new Error('No GOOGLE_APPLICATION_CREDENTIALS set for local development');
  }

  const fs = await import('fs');
  const crypto = await import('crypto');
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

  // Create JWT
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

  // Exchange JWT for access token
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResp.json();
  return { token: tokenData.access_token, expiresIn: tokenData.expires_in || 3600 };
}
