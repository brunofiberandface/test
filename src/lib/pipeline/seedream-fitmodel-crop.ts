/**
 * Seedream fit-model crop helper.
 *
 * PROBLEM: Seedream copies visual content from reference images more strongly
 * than it follows text prompts. Fit model photos show the model wearing jeans
 * with an untucked crop top — Seedream reproduces the untucked look regardless
 * of "always tucked" prompt text.
 *
 * SOLUTION: Crop fit model images to waist-down before sending to Seedream.
 * The untucked top is literally removed from the visual input. The top styling
 * is described via text only (Opus-generated {top_description}).
 *
 * CROP RATIO: Keep the bottom 58% of the image. Fit model photos are tall
 * portrait shots — the waistband sits at roughly 40-42% from the top.
 * Keeping 58% captures the full waistband + belt loops down to the feet.
 *
 * CACHING: Cropped versions are stored as `_seedream_crop.jpg` siblings on GCS.
 * Subsequent runs reuse the cached crop. Gemini pipeline is untouched.
 */
import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';

const BUCKET_NAME = 'gstar-ai-studio-assets';
/** Fraction of image height to KEEP (from the bottom). */
const KEEP_BOTTOM_RATIO = 0.58;
const JPEG_QUALITY = 85;

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

function cropSiblingPath(gcsPath: string): string {
  const lastSlash = gcsPath.lastIndexOf('/');
  const dir = lastSlash >= 0 ? gcsPath.slice(0, lastSlash + 1) : '';
  const name = lastSlash >= 0 ? gcsPath.slice(lastSlash + 1) : gcsPath;
  const dot = name.lastIndexOf('.');
  const base = dot >= 0 ? name.slice(0, dot) : name;
  return `${dir}${base}_seedream_crop.jpg`;
}

async function objectExists(gcsPath: string): Promise<boolean> {
  try {
    const bucket = getStorage().bucket(BUCKET_NAME);
    const [exists] = await bucket.file(gcsPath).exists();
    return exists;
  } catch {
    return false;
  }
}

/**
 * Return a cropped (waist-down) URL for a fit model image.
 * Only applies to GCS URLs from our bucket. Non-GCS URLs pass through unchanged.
 *
 * The crop removes the top ~42% of the image (head, shoulders, chest, untucked top)
 * and keeps the bottom 58% (waistband through feet).
 */
export async function cropFitModelForSeedream(url: string): Promise<string> {
  const gcsPath = gcsPathFromUrl(url);
  if (!gcsPath) {
    console.warn(`[SeedreamCrop] Non-GCS URL, passing through: ${url}`);
    return url.split('?')[0];
  }

  const siblingPath = cropSiblingPath(gcsPath);
  const siblingUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${siblingPath}`;

  // Check cache
  if (await objectExists(siblingPath)) {
    console.log(`[SeedreamCrop] Using cached crop: ${siblingPath}`);
    return siblingUrl;
  }

  // Download original
  console.log(`[SeedreamCrop] Cropping ${gcsPath} → ${siblingPath}`);
  const bucket = getStorage().bucket(BUCKET_NAME);
  const [originalBuf] = await bucket.file(gcsPath).download();

  // Get dimensions
  const metadata = await sharp(originalBuf).metadata();
  const width = metadata.width!;
  const height = metadata.height!;

  // Crop: keep bottom KEEP_BOTTOM_RATIO
  const cropTop = Math.round(height * (1 - KEEP_BOTTOM_RATIO));
  const cropHeight = height - cropTop;

  const croppedBuf = await sharp(originalBuf)
    .extract({ left: 0, top: cropTop, width, height: cropHeight })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  // Upload cached sibling
  await bucket.file(siblingPath).save(croppedBuf, {
    metadata: { contentType: 'image/jpeg' },
  });

  console.log(`[SeedreamCrop] Wrote ${siblingPath} (${width}x${cropHeight}, ${(croppedBuf.length / 1024).toFixed(0)} KB)`);
  return siblingUrl;
}
