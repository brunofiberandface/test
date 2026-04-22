/**
 * Seedream image size guard.
 *
 * BytePlus rejects reference images > 10 MiB. Our GCS bucket stores user-uploaded
 * fit model photos at full resolution — some exceed 10 MiB. We only hit this
 * problem for Seedream (it fetches URLs server-side); Gemini takes inline buffers
 * and has a much higher per-image budget.
 *
 * This helper returns a "Seedream-safe" URL for any GCS asset URL:
 *   - If the asset is <= SAFE_LIMIT_BYTES → return original URL unchanged.
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

  if (size <= SAFE_LIMIT_BYTES) {
    return url.split('?')[0];
  }

  // Oversized — check for cached sibling first.
  const siblingPath = seedreamSiblingPath(gcsPath);
  const siblingSize = await objectExistsAndSize(siblingPath);
  const siblingUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${siblingPath}`;

  if (siblingSize !== null && siblingSize <= SAFE_LIMIT_BYTES) {
    console.log(`[SeedreamSafe] Using cached sibling: ${siblingPath} (${(siblingSize / 1024 / 1024).toFixed(1)} MiB)`);
    return siblingUrl;
  }

  // Need to create/recreate the sibling.
  console.log(`[SeedreamSafe] Downsizing ${gcsPath} (${(size / 1024 / 1024).toFixed(1)} MiB) → ${siblingPath}`);
  const bucket = getStorage().bucket(BUCKET_NAME);
  const [originalBuf] = await bucket.file(gcsPath).download();
  const resizedBuf = await downsizeToJpeg(originalBuf);
  await bucket.file(siblingPath).save(resizedBuf, {
    metadata: { contentType: 'image/jpeg' },
  });
  console.log(`[SeedreamSafe] Wrote ${siblingPath} (${(resizedBuf.length / 1024 / 1024).toFixed(1)} MiB)`);
  return siblingUrl;
}
