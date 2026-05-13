/**
 * Identity head-crop utility.
 *
 * Crops a model card to head-and-shoulders (top 30% vertically × center 60%
 * horizontally) so the identity signal — face, hair, skin tone — is supplied
 * at exactly the resolution the image model fuses identity from.
 *
 * Used as `IMAGE 2B` (Gemini) / a secondary identity ref (Seedream) anchor
 * alongside the full model card. Caught two recurring drift modes:
 *   - M06 (Gemini-3-pro-image-preview): skin tone drifting from the model
 *     when only the full-body card is supplied — face is a small portion of
 *     the card and skin signal gets diluted at full-body resolution.
 *     (Top-focus M06 added it 2026-05-12; bottom-focus M06 added 2026-05-13.)
 *   - M03 (Seedream): identity drift on a small fraction of jobs when the
 *     3 fit-model angle refs (each with their own face) overwhelm the
 *     single MODEL CARD (FRONT) ref. (Added 2026-05-13.)
 *
 * Implementation: lazy-import sharp (already a hard dep). No GCS roundtrip
 * — crop runs in-process from the model-card buffer. Output PNG.
 */

/**
 * Crop a model card buffer to head + shoulders. Top 30% vertically, center
 * 60% horizontally. Output is a PNG buffer.
 *
 * Falls back to the input dimensions if sharp can't read metadata.
 */
export async function buildIdentityHeadCrop(modelCardBuffer: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(modelCardBuffer).metadata();
  const w = meta.width || 1792;
  const h = meta.height || 2400;
  const cropW = Math.floor(w * 0.6);
  const cropH = Math.floor(h * 0.30);
  const left = Math.floor((w - cropW) / 2);
  return sharp(modelCardBuffer)
    .extract({ left, top: 0, width: cropW, height: cropH })
    .png()
    .toBuffer();
}

/**
 * Fetch a model-card URL and return the head-crop directly. Useful for
 * callers (like Seedream paths) that only have a URL, not a buffer.
 *
 * Strips query strings from the URL before fetching (Seedream-safe-url
 * convention).
 */
export async function fetchAndCropHead(modelCardUrl: string): Promise<Buffer> {
  const cleanUrl = modelCardUrl.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  const arr = await r.arrayBuffer();
  return buildIdentityHeadCrop(Buffer.from(arr));
}
