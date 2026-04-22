/**
 * Google Cloud Storage client for garment images.
 * Stores input images (flat + 360°) in the gstar-ai-studio-assets bucket.
 */
import { Storage } from '@google-cloud/storage';

const BUCKET_NAME = 'gstar-ai-studio-assets';
const UPLOAD_TIMEOUT_MS = 120_000; // 2 min timeout for GCS uploads

let _storage: Storage | null = null;

function getStorage(): Storage {
  if (!_storage) {
    _storage = new Storage({
      projectId: process.env.GCP_PROJECT_ID,
    });
  }
  return _storage;
}

/**
 * Upload a garment image to GCS.
 * Path: input/{designNumber}/{type}/{filename}
 * Returns the GCS public URL.
 */
export async function uploadGarmentImage(
  designNumber: string,
  type: 'flat' | '360',
  filename: string,
  imageBuffer: Buffer,
  mimeType = 'image/jpeg'
): Promise<string> {
  const storage = getStorage();
  const bucket = storage.bucket(BUCKET_NAME);
  const gcsPath = `input/${designNumber}/${type}/${filename}`;
  const file = bucket.file(gcsPath);

  await file.save(imageBuffer, {
    metadata: {
      contentType: mimeType,
    },
  });

  // Return the public URL (bucket has public read)
  return `https://storage.googleapis.com/${BUCKET_NAME}/${gcsPath}`;
}

/**
 * Download a garment image from GCS as a Buffer.
 * Used by the generate endpoint to pass images to Gemini.
 */
export async function downloadGarmentImage(url: string): Promise<Buffer> {
  // URL format: https://storage.googleapis.com/BUCKET/path
  const gcsPath = url.replace(`https://storage.googleapis.com/${BUCKET_NAME}/`, '');
  const storage = getStorage();
  const bucket = storage.bucket(BUCKET_NAME);
  const file = bucket.file(gcsPath);

  const [buffer] = await file.download();
  return buffer;
}

/**
 * Upload a generated shot image to GCS.
 * Path: output/{designNumber}/{filename}
 * Returns the public URL.
 */
export async function uploadGeneratedImage(
  designNumber: string,
  filename: string,
  imageBuffer: Buffer,
  mimeType = 'image/png'
): Promise<string> {
  const storage = getStorage();
  const bucket = storage.bucket(BUCKET_NAME);
  const gcsPath = `output/${designNumber}/${filename}`;
  const file = bucket.file(gcsPath);

  // Wrap upload in a timeout to prevent indefinite hangs
  await Promise.race([
    file.save(imageBuffer, {
      metadata: {
        contentType: mimeType,
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`GCS upload timed out after ${UPLOAD_TIMEOUT_MS / 1000}s for ${gcsPath} (${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB)`)), UPLOAD_TIMEOUT_MS)
    ),
  ]);

  return `https://storage.googleapis.com/${BUCKET_NAME}/${gcsPath}`;
}

/**
 * Upload a model card image to GCS.
 * Path: model-cards/{modelId}.png
 * Returns the public URL.
 */
export async function uploadModelCardImage(
  modelId: string,
  imageBuffer: Buffer,
  mimeType = 'image/png'
): Promise<string> {
  const storage = getStorage();
  const bucket = storage.bucket(BUCKET_NAME);
  const gcsPath = `model-cards/${modelId}.png`;
  const file = bucket.file(gcsPath);

  await file.save(imageBuffer, {
    metadata: {
      contentType: mimeType,
      cacheControl: 'no-cache', // Allow immediate updates
    },
  });

  return `https://storage.googleapis.com/${BUCKET_NAME}/${gcsPath}?v=${Date.now()}`;
}

/**
 * Upload a model back reference image to GCS.
 * Path: model-cards/{modelId}_back.png
 */
export async function uploadModelBackImage(
  modelId: string,
  imageBuffer: Buffer,
  mimeType = 'image/png'
): Promise<string> {
  const storage = getStorage();
  const bucket = storage.bucket(BUCKET_NAME);
  const gcsPath = `model-cards/${modelId}_back.png`;
  const file = bucket.file(gcsPath);

  await file.save(imageBuffer, {
    metadata: {
      contentType: mimeType,
      cacheControl: 'no-cache',
    },
  });

  return `https://storage.googleapis.com/${BUCKET_NAME}/${gcsPath}?v=${Date.now()}`;
}

/**
 * Upload a wardrobe stock image to GCS.
 * Path: wardrobe/{category}/{wardrobeId}/{filename}
 * Returns the public URL.
 */
export async function uploadWardrobeImage(
  category: string,
  wardrobeId: string,
  filename: string,
  imageBuffer: Buffer,
  mimeType = 'image/jpeg'
): Promise<string> {
  const storage = getStorage();
  const bucket = storage.bucket(BUCKET_NAME);
  const gcsPath = `wardrobe/${category}/${wardrobeId}/${filename}`;
  const file = bucket.file(gcsPath);

  await file.save(imageBuffer, {
    metadata: { contentType: mimeType },
  });

  return `https://storage.googleapis.com/${BUCKET_NAME}/${gcsPath}`;
}

/**
 * Upload a dressed-base image to GCS.
 * Path: dressed-bases/{modelId}_{hash}.jpg
 * Returns the public URL.
 */
export async function uploadDressedBaseImage(
  modelId: string,
  hash: string,
  view: 'front' | 'right' | 'back' | 'left',
  imageBuffer: Buffer,
  mimeType = 'image/jpeg'
): Promise<string> {
  const storage = getStorage();
  const bucket = storage.bucket(BUCKET_NAME);
  const gcsPath = `dressed-bases/${modelId}_${hash}_${view}.jpg`;
  const file = bucket.file(gcsPath);

  await file.save(imageBuffer, {
    metadata: { contentType: mimeType },
  });

  return `https://storage.googleapis.com/${BUCKET_NAME}/${gcsPath}`;
}

/**
 * List all 360° images for a design number.
 */
export async function list360Images(designNumber: string): Promise<string[]> {
  const storage = getStorage();
  const bucket = storage.bucket(BUCKET_NAME);
  const prefix = `input/${designNumber}/360/`;

  const [files] = await bucket.getFiles({ prefix });
  return files.map(f => `https://storage.googleapis.com/${BUCKET_NAME}/${f.name}`);
}
