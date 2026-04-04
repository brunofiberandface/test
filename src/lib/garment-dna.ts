/**
 * Garment DNA — dynamic construction analysis via Gemini vision.
 *
 * Instead of a hardcoded registry, we send the fit model + flat images to Gemini
 * and ask it to describe every construction detail it sees: zippers, panel seams,
 * knee articulation, pocket shapes, hardware, special features, etc.
 *
 * Uses Vertex AI endpoint with OAuth (same auth as image generation) — works on Cloud Run.
 *
 * This runs ONCE per job (cached on the job document in Firestore) so subsequent
 * shot generations reuse the same analysis without extra API calls.
 *
 * Cost: ~$0.003 per analysis (Gemini Flash Lite, 2-4 images).
 * Latency: 1-3 seconds.
 */

import sharp from 'sharp';

const ANALYSIS_MODEL = 'gemini-2.5-flash-lite';
const GCP_PROJECT = process.env.GCP_PROJECT || 'gen-lang-client-0396152930';

/** A single distinguishing feature with importance score */
export interface GarmentFeature {
  /** Short name, e.g., "exposed outer leg zipper" */
  name: string;
  /** Where on the garment: "outer leg seam, knee to ankle" */
  location: string;
  /** How important is this for reproducing the garment accurately (1-10, 10 = defines the garment) */
  importance: number;
  /** Detailed description for the generation prompt */
  description: string;
  /** Which shot types need to show this feature: M01-M05 */
  visibleInShots: string[];
}

export interface GarmentDNA {
  /** Combined construction analysis text (for logging/debugging) */
  dna: string;
  /** FRONT-only DNA — injected into M01 (cropped front) and M03 (full body front) prompts */
  frontDna: string;
  /** BACK-only DNA — injected into M02 (cropped back) and M04 (full body back) prompts */
  backDna: string;
  /** Per-shot overrides extracted from the analysis (e.g., M05 framing changes) */
  shotOverrides?: Record<string, string>;
  /** Dynamic feature list — open-ended, Gemini decides what matters */
  features: GarmentFeature[];
  /** Waist height and length proportions — text-based classification */
  proportions?: {
    waistRise: string;
    inseamLength: string;
    hemToFloor: string;
  };
}

/**
 * Get OAuth access token for Vertex AI — same approach as vertex.ts.
 * Uses Cloud Run metadata server (production) or service account key (local dev).
 */
async function getAccessToken(): Promise<string> {
  // Try Cloud Run metadata server first
  try {
    const resp = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) }
    );
    if (resp.ok) {
      const data = await resp.json();
      return data.access_token;
    }
  } catch {
    // Not on Cloud Run — fall through to service account
  }

  // Fall back to service account key (local development)
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    throw new Error('No OAuth token available (not on Cloud Run and no GOOGLE_APPLICATION_CREDENTIALS)');
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

  if (!tokenResp.ok) throw new Error(`Token exchange failed: ${tokenResp.status}`);
  const tokenData = await tokenResp.json();
  return tokenData.access_token;
}

/**
 * Analyze garment construction by sending fit model + flat images to Gemini.
 * Returns a structured GarmentDNA with both the text analysis and feature flags.
 *
 * @param fitModelBuffers Array of fit model image buffers (ideally front, side, back)
 * @param flatFrontBuffer Flat front image buffer (optional)
 * @param flatBackBuffer Flat back image buffer (optional)
 * @param garmentDescription Text description from the wardrobe item (optional, supplements vision)
 */
export async function analyzeGarmentConstruction(
  fitModelBuffers: Buffer[],
  flatFrontBuffer: Buffer | null,
  flatBackBuffer: Buffer | null,
  garmentDescription?: string,
): Promise<GarmentDNA> {
  // Select up to 4 images for analysis: front, side, back fit model + flat back
  const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  const imageLabels: string[] = [];

  // Pick representative fit model angles: front (0), side (~2), back (~4)
  const totalAngles = fitModelBuffers.length;
  const selectedIndices: number[] = [];
  if (totalAngles >= 1) selectedIndices.push(0); // front
  if (totalAngles >= 3) selectedIndices.push(Math.floor(totalAngles * 0.25)); // side
  if (totalAngles >= 5) selectedIndices.push(Math.floor(totalAngles / 2)); // back
  if (totalAngles >= 7) selectedIndices.push(Math.floor(totalAngles * 0.75)); // other side

  for (const idx of selectedIndices) {
    if (fitModelBuffers[idx]) {
      try {
        const resized = await sharp(fitModelBuffers[idx])
          .resize(1200, 1200, { fit: 'inside' })
          .jpeg({ quality: 80 })
          .toBuffer();
        imageParts.push({
          inlineData: { mimeType: 'image/jpeg', data: resized.toString('base64') },
        });
        const viewName = idx === 0 ? 'FRONT' : idx === Math.floor(totalAngles / 2) ? 'BACK' : `ANGLE ${idx}`;
        imageLabels.push(`Image ${imageParts.length}: Fit model ${viewName} view`);
      } catch (err) {
        console.warn(`[GarmentDNA] Failed to process fit model angle ${idx}:`, err);
      }
    }
  }

  // Add flat back if available (shows construction details cleanly)
  if (flatBackBuffer) {
    try {
      const resized = await sharp(flatBackBuffer)
        .resize(1200, 1200, { fit: 'inside' })
        .jpeg({ quality: 80 })
        .toBuffer();
      imageParts.push({
        inlineData: { mimeType: 'image/jpeg', data: resized.toString('base64') },
      });
      imageLabels.push(`Image ${imageParts.length}: FLAT BACK (product-on-white)`);
    } catch (err) {
      console.warn('[GarmentDNA] Failed to process flat back:', err);
    }
  }

  // Add flat front if available
  if (flatFrontBuffer) {
    try {
      const resized = await sharp(flatFrontBuffer)
        .resize(1200, 1200, { fit: 'inside' })
        .jpeg({ quality: 80 })
        .toBuffer();
      imageParts.push({
        inlineData: { mimeType: 'image/jpeg', data: resized.toString('base64') },
      });
      imageLabels.push(`Image ${imageParts.length}: FLAT FRONT (product-on-white)`);
    } catch (err) {
      console.warn('[GarmentDNA] Failed to process flat front:', err);
    }
  }

  if (imageParts.length === 0) {
    throw new Error('No images available for analysis');
  }

  const prompt = `You are an expert denim garment analyst. Study these reference images of a pair of jeans/trousers and IDENTIFY every construction feature you can see.

${imageLabels.join('\n')}
${garmentDescription ? `\nProduct description (for context only — trust what you SEE in the images over this text):\n${garmentDescription}` : ''}

PURPOSE: Your output will be used as an AWARENESS CHECKLIST for an AI image generator that already has the reference images. The generator will use your list to know WHAT features to look for in the images, then reproduce them from the images directly. You are NOT describing how features look — you are listing WHAT EXISTS so nothing gets missed.

Respond in EXACT JSON (no markdown, no backticks).

{
  "silhouette_fit": "Classify the OVERALL leg silhouette based on what you SEE in the fit model images. Choose ONE: skinny / slim / straight / relaxed / wide-leg / bootcut / tapered.",
  "proportions": {
    "waist_rise": "low-rise / mid-rise / high-rise",
    "inseam_length": "full length / 7/8 length / cropped",
    "hem_to_floor": "stacking on shoe / resting on shoe / at ankle / above ankle"
  },
  "front_features": [
    {
      "name": "short name, e.g. 'exposed outer leg zipper' or '3D knee articulation'",
      "location": "where on the garment, e.g. 'outer leg seam, hip to ankle'",
      "importance": 8,
      "visibleInShots": ["M01", "M03"]
    }
  ],
  "back_features": [
    {
      "name": "short name",
      "location": "where on the garment",
      "importance": 8,
      "visibleInShots": ["M02", "M04"]
    }
  ],
  "m05_focus": "What is THE most distinctive/interesting construction detail for a detail close-up shot? Name it and say WHERE it is.",
  "m05_framing_override": "If the most interesting detail is NOT in the back pocket area (waistband-to-mid-thigh), provide alternative framing. Return null if back pocket framing is correct."
}

IMPORTANT — FEATURES:
- List EVERY distinguishing feature. A basic 5-pocket jean: 3-5 features. Complex 3D/zip garment: 8-15.
- Give SHORT names only — no descriptions of how they look. The image generator will find them in the reference images.
- Importance: 1-3 subtle, 4-6 noticeable, 7-9 defining, 10 = signature element
- Features visible from BOTH front and back should appear in BOTH arrays.
- visibleInShots: M01 (cropped front), M02 (cropped back), M03 (full body front), M04 (full body back), M05 (detail close-up). No M06+.
- FRONT shots = M01, M03. BACK shots = M02, M04.
- Be thorough: check for panel seams, knee darts/articulation, zippers, pocket shapes, hardware, stitching details, hem treatments, yoke seams.`;

  // Use Vertex AI endpoint with OAuth (same as image generation — works on Cloud Run)
  const accessToken = await getAccessToken();
  const url = `https://aiplatform.googleapis.com/v1/projects/${GCP_PROJECT}/locations/global/publishers/google/models/${ANALYSIS_MODEL}:generateContent`;

  try {
    const parts: any[] = [
      ...imageParts,
      { text: prompt },
    ];

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'no body');
      throw new Error(`Vertex AI ${response.status}: ${errorBody.slice(0, 500)}`);
    }

    const result = await response.json();
    const textPart = result.candidates?.[0]?.content?.parts?.find((p: any) => p.text);
    if (!textPart?.text) {
      throw new Error(`No text in Gemini response: ${JSON.stringify(result).slice(0, 300)}`);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(textPart.text);
    } catch (parseErr) {
      // Try to extract JSON from markdown fences
      const jsonMatch = textPart.text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error(`Failed to parse JSON: ${textPart.text.slice(0, 300)}`);
      }
    }

    // ── Build awareness-checklist DNA ──
    // DNA v2: feature NAMES only, no descriptions. The reference images are the
    // primary source of truth — DNA just tells Gemini WHAT to look for so nothing
    // gets missed. Gemini reproduces features from the images, not from text.

    const m05Focus = parsed.m05_focus || '';
    const proportions = parsed.proportions || {};
    const silhouetteFit = parsed.silhouette_fit || '';

    // Parse features from both front and back arrays
    const VALID_SHOTS = new Set(['M01', 'M02', 'M03', 'M04', 'M05']);
    const parseFeatures = (arr: any[]): GarmentFeature[] =>
      (Array.isArray(arr) ? arr : [])
        .filter((f: any) => f && typeof f.name === 'string')
        .map((f: any) => ({
          name: String(f.name),
          location: String(f.location || ''),
          importance: typeof f.importance === 'number' ? Math.min(10, Math.max(1, f.importance)) : 5,
          description: '', // v2: no descriptions — awareness only
          visibleInShots: (Array.isArray(f.visibleInShots) ? f.visibleInShots.map(String) : []).filter((s: string) => VALID_SHOTS.has(s)),
        }))
        .sort((a: GarmentFeature, b: GarmentFeature) => b.importance - a.importance);

    const frontFeatures = parseFeatures(parsed.front_features);
    const backFeatures = parseFeatures(parsed.back_features);
    // Combined deduplicated list for logging
    const allFeatureNames = new Set<string>();
    const features: GarmentFeature[] = [];
    for (const f of [...frontFeatures, ...backFeatures]) {
      if (!allFeatureNames.has(f.name.toLowerCase())) {
        allFeatureNames.add(f.name.toLowerCase());
        features.push(f);
      }
    }

    // Build the awareness checklist for each direction
    const buildChecklist = (feats: GarmentFeature[]) =>
      feats.map(f => `- ${f.name} (${f.location})`).join('\n');

    const silhouetteAnchor = silhouetteFit
      ? `SILHOUETTE: ${silhouetteFit.toUpperCase()} FIT — maintain this silhouette. Do NOT distort leg shape.\n`
      : '';

    const proportionsLine = `PROPORTIONS: ${proportions.waist_rise || '?'} rise, ${proportions.inseam_length || '?'}, hem ${proportions.hem_to_floor || '?'}`;

    // FRONT DNA — short awareness block
    const frontDna = `GARMENT DNA (awareness checklist — reference images are your PRIMARY truth):
${silhouetteAnchor}${proportionsLine}
FEATURES TO FIND IN REFERENCE IMAGES (front view):
${buildChecklist(frontFeatures) || '- Standard 5-pocket construction'}
IMPORTANT: Each feature above EXISTS in the reference images. Find it, then reproduce EXACTLY as you see it. Do NOT invent appearance from text — LOOK at the images.`;

    // BACK DNA — short awareness block
    const backDna = `GARMENT DNA (awareness checklist — reference images are your PRIMARY truth):
${silhouetteAnchor}${proportionsLine}
FEATURES TO FIND IN REFERENCE IMAGES (back view):
${buildChecklist(backFeatures) || '- Standard 5-pocket construction'}
IMPORTANT: Each feature above EXISTS in the reference images. Find it, then reproduce EXACTLY as you see it. Do NOT invent appearance from text — LOOK at the images.`;

    // Combined DNA for logging
    const dna = `GARMENT DNA CHECKLIST:\nSilhouette: ${silhouetteFit}\n${proportionsLine}\nFront: ${frontFeatures.map(f => f.name).join(', ')}\nBack: ${backFeatures.map(f => f.name).join(', ')}`;

    // Shot overrides — M05 only (framing guidance for detail shot)
    // No more per-shot CRITICAL FEATURE overrides — those caused Gemini to
    // over-emphasize text-described features instead of following images.
    const shotOverrides: Record<string, string> = {};
    if (parsed.m05_framing_override && parsed.m05_framing_override !== 'null' && parsed.m05_framing_override !== null) {
      shotOverrides['M05'] = `M05 FRAMING OVERRIDE: ${parsed.m05_framing_override}\nM05 DETAIL FOCUS: ${m05Focus}`;
    } else if (m05Focus) {
      shotOverrides['M05'] = `M05 DETAIL FOCUS: ${m05Focus}`;
    }

    const garmentDNA: GarmentDNA = {
      dna,
      frontDna,
      backDna,
      shotOverrides: Object.keys(shotOverrides).length > 0 ? shotOverrides : undefined,
      features,
      proportions: {
        waistRise: proportions.waist_rise || '',
        inseamLength: proportions.inseam_length || '',
        hemToFloor: proportions.hem_to_floor || '',
      },
    };

    console.log(`[GarmentDNA v2] Analysis complete — ${imageParts.length} images, ${features.length} unique features`);
    console.log(`[GarmentDNA v2] Silhouette: ${silhouetteFit || 'unknown'} | ${proportionsLine}`);
    console.log(`[GarmentDNA v2] Front features: ${frontFeatures.map(f => f.name).join(', ')}`);
    console.log(`[GarmentDNA v2] Back features: ${backFeatures.map(f => f.name).join(', ')}`);
    console.log(`[GarmentDNA v2] Front DNA length: ${frontDna.length} chars (was ~2700)`);
    if (shotOverrides['M05']) {
      console.log(`[GarmentDNA v2] M05 override: ${shotOverrides['M05'].slice(0, 100)}...`);
    }

    return garmentDNA;
  } catch (err: any) {
    console.error('[GarmentDNA] Analysis failed:', err);
    throw err;
  }
}

/**
 * Legacy lookup — kept for backward compatibility but now just returns null.
 * All garment analysis goes through analyzeGarmentConstruction().
 */
export function getGarmentDNA(_designNumber: string): GarmentDNA | null {
  return null;
}
