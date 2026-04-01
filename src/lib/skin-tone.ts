/**
 * Skin tone extraction from model card images.
 * Samples skin-colored pixels from the face/neck region and returns a representative hex color.
 * This is stored on the model record and injected into every generation prompt
 * to ensure consistent skin color across all shots (especially cropped M01/M02).
 */
import sharp from 'sharp';

/**
 * Extract the dominant skin tone from a model card image.
 * Strategy: sample the face/neck region (15-35% from top, center 40% width),
 * filter for skin-like HSV ranges, and compute the median color.
 *
 * @param imageBuffer - The model card image buffer
 * @returns Hex color string (e.g., "#8B6544") and a human-readable description
 */
export async function extractSkinTone(imageBuffer: Buffer): Promise<{
  hex: string;
  rgb: { r: number; g: number; b: number };
  description: string;
}> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || 1200;
  const height = meta.height || 1800;

  // Crop face/neck region: 15-35% from top, center 40% width
  const cropTop = Math.round(height * 0.15);
  const cropHeight = Math.round(height * 0.20);
  const cropLeft = Math.round(width * 0.30);
  const cropWidth = Math.round(width * 0.40);

  const regionBuffer = await sharp(imageBuffer)
    .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = regionBuffer;
  const channels = info.channels; // 3 for RGB, 4 for RGBA

  // Collect skin-colored pixels using broad HSV-like filtering in RGB space
  const skinPixels: Array<{ r: number; g: number; b: number }> = [];

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Skip very dark pixels (background, hair, eyes)
    if (r < 40 && g < 40 && b < 40) continue;
    // Skip very bright pixels (white background, highlights)
    if (r > 245 && g > 245 && b > 245) continue;
    // Skip very saturated non-skin colors (clothing, accessories)
    // Skin tends to have R > G > B or R > B > G
    if (b > r || (g > r + 30)) continue;
    // Skip grays (background) — skin has some color saturation
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    if (maxC - minC < 15) continue;

    skinPixels.push({ r, g, b });
  }

  if (skinPixels.length < 50) {
    // Fallback: not enough skin pixels found, use center pixel sample
    console.warn(`[SkinTone] Only ${skinPixels.length} skin pixels found, using center sample`);
    const centerBuffer = await sharp(imageBuffer)
      .extract({
        left: Math.round(width * 0.45),
        top: Math.round(height * 0.22),
        width: Math.round(width * 0.10),
        height: Math.round(height * 0.06),
      })
      .resize(1, 1)
      .raw()
      .toBuffer();
    const r = centerBuffer[0];
    const g = centerBuffer[1];
    const b = centerBuffer[2];
    return {
      hex: rgbToHex(r, g, b),
      rgb: { r, g, b },
      description: classifySkinTone(r, g, b),
    };
  }

  // Sort by luminance and take median
  skinPixels.sort((a, b) => luminance(a.r, a.g, a.b) - luminance(b.r, b.g, b.b));
  const medianIdx = Math.floor(skinPixels.length / 2);
  const median = skinPixels[medianIdx];

  // Also compute mean of middle 60% to reduce outlier influence
  const p20 = Math.floor(skinPixels.length * 0.2);
  const p80 = Math.floor(skinPixels.length * 0.8);
  const middle = skinPixels.slice(p20, p80);
  const avgR = Math.round(middle.reduce((s, p) => s + p.r, 0) / middle.length);
  const avgG = Math.round(middle.reduce((s, p) => s + p.g, 0) / middle.length);
  const avgB = Math.round(middle.reduce((s, p) => s + p.b, 0) / middle.length);

  // Blend median and mean for stability
  const finalR = Math.round((median.r + avgR) / 2);
  const finalG = Math.round((median.g + avgG) / 2);
  const finalB = Math.round((median.b + avgB) / 2);

  const hex = rgbToHex(finalR, finalG, finalB);
  const description = classifySkinTone(finalR, finalG, finalB);

  console.log(`[SkinTone] Extracted: ${hex} (${description}) from ${skinPixels.length} skin pixels`);

  return { hex, rgb: { r: finalR, g: finalG, b: finalB }, description };
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Classify skin tone into a human-readable description for prompt injection.
 * Uses luminance-based categories that map to common descriptions.
 */
function classifySkinTone(r: number, g: number, b: number): string {
  const lum = luminance(r, g, b);

  if (lum > 200) return 'very fair/pale skin';
  if (lum > 170) return 'fair/light skin';
  if (lum > 145) return 'light-medium skin with warm undertone';
  if (lum > 120) return 'medium/olive skin';
  if (lum > 95) return 'medium-brown skin';
  if (lum > 70) return 'brown skin';
  if (lum > 50) return 'deep brown skin';
  return 'very deep/dark brown skin';
}
