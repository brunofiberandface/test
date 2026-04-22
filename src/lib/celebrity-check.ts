/**
 * Celebrity Resemblance Check — TypeScript wrapper.
 *
 * Calls the celebrity-check Cloud Function and returns the result.
 * Fire-and-forget pattern: the function writes directly to Firestore,
 * so the caller doesn't need to wait for the result.
 */

const CELEB_CHECK_URL = process.env.CELEB_CHECK_URL || '';
const CELEB_CHECK_ENABLED = process.env.CELEB_CHECK_ENABLED !== 'false';

export interface CelebrityCheckResult {
  status: 'pass' | 'review' | 'blocked' | 'error';
  topMatch: string | null;
  topScore: number;
  facesDetected?: number;
  flaggedMatches?: Array<{ name: string; score: number }>;
  durationMs?: number;
  note?: string;
}

/**
 * Trigger celebrity check for a model's reference image.
 * Fire-and-forget: logs result but doesn't block the caller.
 */
export async function triggerCelebrityCheck(
  modelId: string,
  imageUrl: string
): Promise<void> {
  if (!CELEB_CHECK_ENABLED) {
    console.log(`[CelebCheck] Disabled — skipping check for ${modelId}`);
    return;
  }

  if (!CELEB_CHECK_URL) {
    console.warn(`[CelebCheck] CELEB_CHECK_URL not set — skipping check for ${modelId}`);
    return;
  }

  console.log(`[CelebCheck] Triggering check for model ${modelId}`);

  try {
    const resp = await fetch(CELEB_CHECK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId, imageUrl }),
      signal: AbortSignal.timeout(60_000), // 60s timeout
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[CelebCheck] Function returned ${resp.status}: ${err}`);
      return;
    }

    const result: CelebrityCheckResult = await resp.json();
    console.log(`[CelebCheck] ${modelId}: ${result.status} (top: ${result.topMatch || 'none'} @ ${result.topScore})`);
  } catch (error) {
    console.error(`[CelebCheck] Error calling function for ${modelId}:`, error);
  }
}

/**
 * Synchronous version — waits for result.
 * Used by the backfill endpoint to audit all existing models.
 */
export async function runCelebrityCheck(
  modelId: string,
  imageUrl: string
): Promise<CelebrityCheckResult | null> {
  if (!CELEB_CHECK_ENABLED || !CELEB_CHECK_URL) {
    return null;
  }

  const resp = await fetch(CELEB_CHECK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId, imageUrl }),
    signal: AbortSignal.timeout(120_000), // 2 min for backfill
  });

  if (!resp.ok) {
    throw new Error(`Celebrity check failed: ${resp.status} ${await resp.text()}`);
  }

  return resp.json();
}
