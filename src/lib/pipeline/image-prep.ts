/**
 * Image preprocessing for the Pro pipeline.
 * Resize, JPEG compress, and base64 encode images for Gemini API.
 */
import sharp from 'sharp';
import { APP_CONFIG } from '@/lib/config';

/**
 * Resize image to fit within maxDim, convert to JPEG, return buffer.
 */
export async function prepareImage(
  buffer: Buffer,
  maxDim: number = APP_CONFIG.maxDimGeneration,
): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const w = meta.width || maxDim;
  const h = meta.height || maxDim;
  const longest = Math.max(w, h);

  if (longest <= maxDim) {
    // Already within bounds — just ensure JPEG
    return sharp(buffer)
      .jpeg({ quality: APP_CONFIG.jpegQuality })
      .toBuffer();
  }

  const scale = maxDim / longest;
  return sharp(buffer)
    .resize(Math.round(w * scale), Math.round(h * scale), { fit: 'inside' })
    .jpeg({ quality: APP_CONFIG.jpegQuality })
    .toBuffer();
}

/**
 * Prepare image for generation (2000px max).
 */
export async function prepareForGeneration(buffer: Buffer): Promise<Buffer> {
  return prepareImage(buffer, APP_CONFIG.maxDimGeneration);
}

/**
 * Prepare image for silhouette analysis (1200px max).
 */
export async function prepareForAnalysis(buffer: Buffer): Promise<Buffer> {
  return prepareImage(buffer, APP_CONFIG.maxDimAnalysis);
}
