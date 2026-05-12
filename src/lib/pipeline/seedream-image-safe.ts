/**
 * Seedream image safety guard.
 *
 * BytePlus has two hard rules for reference images:
 *   1. Size <= 10 MiB
 *   2. Format must be JPEG or PNG (AVIF / WebP / HEIC / TIFF / etc. → 400)
 *
 * Our GCS bucket has wardrobe assets that violate both rules:
 *   - Some user-uploaded fit-model photos exceed 10 MiB
 *   - Some files are AVIF (sometimes saved with a misleading .jpg extension)
 *
 * This helper returns a "Seedream-safe" URL for any GCS asset URL:
 *   - If the asset is JPEG/PNG and <= SAFE_LIMIT_BYTES → return original URL.
 *   - Otherwise → download, re-encode as JPEG with Sharp at <= 2000px long edge,
 *     upload to a sibling path `<name>_seedream.jpg`, and return that URL.
 *
 * The re-encoded sibling is cached on GCS — subsequent runs reuse it without
 * re-processing. Gemini generation is untouched; only Seedream passes URLs.
 */
import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';

const BUCKET_NAME = 'gstar-ai-studio-assets';
// Keep margin below the 10 MiB hard cap.
const SAFE_LIMIT_BYTES = 9 * 1024 * 1024;
// Target for the re-encoded sibling — well below the cap even if the cache is stale.
const TARGET_MAX_BYTES = 8 * 1024 * 1024;
const MAX_LONG_EDGE = 2000;
const JPEG_QUALITY_INITIAL = 85;
const JPEG_QUALITY_FLOOR = 60;

let _storage: Storage | null = null;
function getStorage(): Storage {
  if (!_storage) {
    _storage = new Storage({ projectId: process.env.GCP_PROJECT_ID });
  }
  return _storage;
}

function gcsPathFromUrl(url: string): string | null {
  const prefix = `https://storage.googleapis.com/${BUCKET_NAME}/`;
  const clean = url.split('?')[0];
  if (!clean.startsWith(prefix)) return null;
  return clean.slice(prefix.length);
}

function seedreamSiblingPath(gcsPath: string): string {
  // foo/bar/image.jpg → foo/bar/image_seedream.jpg
  const lastSlash = gcsPath.lastIndexOf('/');
  const dir = lastSlash >= 0 ? gcsPath.slice(0, lastSlash + 1) : '';
  const name = lastSlash >= 0 ? gcsPath.slice(lastSlash + 1) : gcsPath;
  const dot = name.lastIndexOf('.');
  const base = dot >= 0 ? name.slice(0, dot) : name;
  return `${dir}${base}_seedream.jpg`;
}

async function objectExistsAndSize(gcsPath: string): Promise<number | null> {
  try {
    const bucket = getStorage().bucket(BUCKET_NAME);
    const [metadata] = await bucket.file(gcsPath).getMetadata();
    return Number(metadata.size || 0);
  } catch {
    return null;
  }
}

/**
 * Detect whether a GCS asset is in a Seedream-supported format.
 * BytePlus accepts JPEG and PNG only — AVIF/WebP/HEIC/TIFF/etc. all 400 with
 * UnsupportedImageFormat. We can't trust GCS Content-Type metadata (sometimes
 * stale or wrong, e.g. an AVIF file stored as image/jpeg) so we read magic
 * bytes from the first 16 bytes of the file via a partial download.
 */
async function isSeedreamFormat(gcsPath: string): Promise<boolean> {
  try {
    const bucket = getStorage().bucket(BUCKET_NAME);
    const [head] = await bucket.file(gcsPath).download({ start: 0, end: 31 });
    if (head.length < 8) return false;
    // JPEG: FF D8 FF
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true;
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return true;
    // Anything else (AVIF "ftypavif", WebP "RIFF...WEBP", HEIC "ftypheic",
    // TIFF "II*\0" or "MM\0*", etc.) — treat as unsupported.
    return false;
  } catch (err) {
    console.warn(`[SeedreamSafe] Magic-byte check failed for ${gcsPath}:`, err);
    // On error, conservatively assume non-supported so we trigger conversion
    // rather than letting a bad file reach BytePlus.
    return false;
  }
}

async function downsizeToJpeg(input: Buffer): Promise<Buffer> {
  // Progressive quality step-down until under TARGET_MAX_BYTES.
  let quality = JPEG_QUALITY_INITIAL;
  let longEdge = MAX_LONG_EDGE;

  for (let attempt = 0; attempt < 5; attempt++) {
    const out = await sharp(input)
      .rotate() // honor EXIF
      .resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    if (out.length <= TARGET_MAX_BYTES) {
      return out;
    }

    // Still too big — step down. Drop quality first, then dimensions.
    if (quality > JPEG_QUALITY_FLOOR) {
      quality = Math.max(JPEG_QUALITY_FLOOR, quality - 10);
    } else {
      longEdge = Math.max(1200, Math.round(longEdge * 0.85));
    }
  }

  // Final attempt with minimum settings
  return await sharp(input)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY_FLOOR, mozjpeg: true })
    .toBuffer();
}

/**
 * Return a URL safe to pass to Seedream (BytePlus).
 * Non-GCS URLs are returned unchanged (Seedream will try them as-is; caller's problem).
 */
export async function ensureSeedreamSafeUrl(url: string): Promise<string> {
  const gcsPath = gcsPathFromUrl(url);
  if (!gcsPath) {
    // Not a GCS bucket URL we control — pass through.
    return url.split('?')[0];
  }

  const size = await objectExistsAndSize(gcsPath);
  if (size === null) {
    // Can't stat; let BytePlus try.
    console.warn(`[SeedreamSafe] Could not stat ${gcsPath} — passing through`);
    return url.split('?')[0];
  }

  // Two reasons to convert: oversize OR non-JPEG/PNG format.
  const oversize = size > SAFE_LIMIT_BYTES;
  let needsFormatConversion = false;
  if (!oversize) {
    // Only check format when size is fine — saves a partial download per call
    // for the common case (JPEG/PNG under the limit).
    const ok = await isSeedreamFormat(gcsPath);
    needsFormatConversion = !ok;
  }
  if (!oversize && !needsFormatConversion) {
    return url.split('?')[0];
  }

  // Need conversion. Check for cached sibling first.
  const siblingPath = seedreamSiblingPath(gcsPath);
  const siblingSize = await objectExistsAndSize(siblingPath);
  const siblingUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${siblingPath}`;

  if (siblingSize !== null && siblingSize <= SAFE_LIMIT_BYTES) {
    console.log(`[SeedreamSafe] Using cached sibling: ${siblingPath} (${(siblingSize / 1024 / 1024).toFixed(1)} MiB)`);
    return siblingUrl;
  }

  // Need to create/recreate the sibling.
  const reason = oversize ? `oversize ${(size / 1024 / 1024).toFixed(1)} MiB` : 'non-JPEG/PNG format';
  console.log(`[SeedreamSafe] Converting ${gcsPath} (${reason}) → ${siblingPath}`);
  const bucket = getStorage().bucket(BUCKET_NAME);
  const [originalBuf] = await bucket.file(gcsPath).download();
  const resizedBuf = await downsizeToJpeg(originalBuf);
  await bucket.file(siblingPath).save(resizedBuf, {
    metadata: { contentType: 'image/jpeg' },
  });
  console.log(`[SeedreamSafe] Wrote ${siblingPath} (${(resizedBuf.length / 1024 / 1024).toFixed(1)} MiB)`);
  return siblingUrl;
}
