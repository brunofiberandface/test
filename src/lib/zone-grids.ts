/**
 * Zone Grid Generator — Server-side crop grids from mannequin 360° images.
 * Replicates v5 pipeline's make_area_grids.py functionality.
 *
 * Creates multi-angle cropped grids showing construction detail zones:
 * - Pants: hip, knee, ankle, back
 * - Jackets: collar, chest, sleeve, back
 *
 * Uses sharp for image processing (available in Node.js).
 */
import sharp from 'sharp';
import { ZONE_DEFS } from './prompts';

interface ZoneGrid {
  buffer: Buffer;
  mimeType: string;
  label: string;
  zoneName: string;
}

/**
 * Generate zone crop grids from mannequin images.
 * Takes an array of mannequin image buffers (in rotation order)
 * and crops them into zone-specific grids.
 *
 * @param mannequinImages Array of {buffer, index} — index maps to rotation angle
 * @param garmentCategory 'pants' | 'jackets' | 'default'
 * @returns Array of zone grid images with labels
 */
export async function generateZoneGrids(
  mannequinImages: Array<{ buffer: Buffer; index: number }>,
  garmentCategory: string
): Promise<ZoneGrid[]> {
  const zones = ZONE_DEFS[garmentCategory as keyof typeof ZONE_DEFS] || ZONE_DEFS.default;
  const grids: ZoneGrid[] = [];

  for (const [zoneKey, zoneDef] of Object.entries(zones)) {
    try {
      const grid = await createZoneGrid(mannequinImages, zoneDef, zoneKey);
      if (grid) {
        grids.push(grid);
      }
    } catch (err) {
      console.error(`[ZoneGrids] Failed to create ${zoneKey} grid:`, err);
    }
  }

  console.log(`[ZoneGrids] Generated ${grids.length} zone grids for ${garmentCategory}`);
  return grids;
}

/**
 * Create a single zone grid by cropping the specified zone from multiple angles
 * and concatenating them horizontally.
 */
async function createZoneGrid(
  mannequinImages: Array<{ buffer: Buffer; index: number }>,
  zoneDef: { y1: number; y2: number; x1: number; x2: number; angles: readonly number[]; name: string },
  zoneKey: string
): Promise<ZoneGrid | null> {
  // Find which mannequin images match the required angles
  // Map angle indices to available images
  const crops: Buffer[] = [];

  for (const angleIdx of zoneDef.angles) {
    // Find the mannequin image closest to this angle index
    const img = findClosestImage(mannequinImages, angleIdx);
    if (!img) continue;

    try {
      const crop = await cropZone(img.buffer, zoneDef);
      if (crop) crops.push(crop);
    } catch (err) {
      console.error(`[ZoneGrids] Failed to crop angle ${angleIdx} for ${zoneKey}:`, err);
    }
  }

  if (crops.length === 0) return null;

  // Concatenate crops horizontally into a grid
  const gridBuffer = await concatenateHorizontal(crops);

  return {
    buffer: gridBuffer,
    mimeType: 'image/jpeg',
    label: `CONSTRUCTION DETAIL GRID: ${zoneDef.name} from ${crops.length} angles. Copy seam patterns, hardware, and trim EXACTLY as shown. These are high-resolution zone crops — study every detail.`,
    zoneName: zoneKey,
  };
}

/**
 * Find the mannequin image with the closest index to the target angle.
 * If there are N mannequin images, they're assumed to be evenly distributed.
 */
function findClosestImage(
  images: Array<{ buffer: Buffer; index: number }>,
  targetAngle: number
): { buffer: Buffer; index: number } | null {
  if (images.length === 0) return null;

  // If we have few images, map the v5 angle indices (0-13 for 14 images)
  // to the available count. For 9 images at 40° intervals:
  // v5 index 0 → img 0 (front)
  // v5 index 1 → img 1 (front-right)
  // v5 index 5-7 → back area
  // v5 index 9 → img 6 or 7 (left side)

  // Simple approach: find the image whose index is closest
  let closest = images[0];
  let minDist = Math.abs(images[0].index - targetAngle);

  for (const img of images) {
    const dist = Math.abs(img.index - targetAngle);
    if (dist < minDist) {
      minDist = dist;
      closest = img;
    }
  }

  return closest;
}

/**
 * Crop a zone from a mannequin image using fractional coordinates.
 *
 * CRITICAL: Mannequin images are 8256×5504 LANDSCAPE orientation.
 * They must be rotated 90° CW to vertical (5504×8256) before cropping.
 * After rotation, Y-axis fractions map to garment zones.
 *
 * Returns crop at 1.8× upscale (max 1600px) — matches Claude workspace quality.
 * Previous version used 500px which caused ~2/10 quality on deployed site.
 */
async function cropZone(
  imageBuffer: Buffer,
  zoneDef: { y1: number; y2: number; x1: number; x2: number }
): Promise<Buffer> {
  // Step 1: Rotate 90° CW if image is landscape (mannequin images are 8256×5504)
  const metadata = await sharp(imageBuffer).metadata();
  const origWidth = metadata.width || 1000;
  const origHeight = metadata.height || 1000;

  let processBuffer = imageBuffer;
  let width = origWidth;
  let height = origHeight;

  if (origWidth > origHeight) {
    // Landscape → rotate 90° CW to make vertical
    processBuffer = await sharp(imageBuffer).rotate(90).toBuffer();
    width = origHeight;   // ~5504
    height = origWidth;   // ~8256
  }

  const left = Math.round(width * zoneDef.x1);
  const top = Math.round(height * zoneDef.y1);
  const cropWidth = Math.round(width * (zoneDef.x2 - zoneDef.x1));
  const cropHeight = Math.round(height * (zoneDef.y2 - zoneDef.y1));

  // Ensure valid crop dimensions
  const safeLeft = Math.max(0, Math.min(left, width - 1));
  const safeTop = Math.max(0, Math.min(top, height - 1));
  const safeWidth = Math.min(cropWidth, width - safeLeft);
  const safeHeight = Math.min(cropHeight, height - safeTop);

  if (safeWidth <= 0 || safeHeight <= 0) {
    throw new Error(`Invalid crop dimensions for zone`);
  }

  // Step 2: Extract zone crop
  const crop = await sharp(processBuffer)
    .extract({ left: safeLeft, top: safeTop, width: safeWidth, height: safeHeight })
    .toBuffer();

  // Step 3: Upscale 1.8× (capped at 1600px) — v5/Claude workspace approach
  const cropMeta = await sharp(crop).metadata();
  const cw = cropMeta.width || safeWidth;
  const ch = cropMeta.height || safeHeight;
  const UPSCALE = 1.8;
  const MAX_DIM = 1600;

  let newW = Math.round(cw * UPSCALE);
  let newH = Math.round(ch * UPSCALE);
  if (newW > MAX_DIM || newH > MAX_DIM) {
    const scale = MAX_DIM / Math.max(newW, newH);
    newW = Math.round(newW * scale);
    newH = Math.round(newH * scale);
  }

  return sharp(crop)
    .resize(newW, newH, { fit: 'fill' })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * Concatenate multiple image buffers horizontally with a small gap.
 */
async function concatenateHorizontal(images: Buffer[]): Promise<Buffer> {
  if (images.length === 1) return images[0];

  const GAP = 4;

  // Get metadata for all images
  const metas = await Promise.all(
    images.map(async (buf) => {
      const meta = await sharp(buf).metadata();
      return { width: meta.width || 500, height: meta.height || 500, buffer: buf };
    })
  );

  // Find max height
  const maxHeight = Math.max(...metas.map(m => m.height));

  // Resize all to same height
  const resized = await Promise.all(
    metas.map(async (m) => {
      if (m.height !== maxHeight) {
        const newWidth = Math.round(m.width * (maxHeight / m.height));
        const buf = await sharp(m.buffer).resize(newWidth, maxHeight).jpeg({ quality: 92 }).toBuffer();
        return { buffer: buf, width: newWidth, height: maxHeight };
      }
      return { buffer: m.buffer, width: m.width, height: m.height };
    })
  );

  const totalWidth = resized.reduce((sum, r) => sum + r.width, 0) + GAP * (resized.length - 1);

  // Create composite
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];
  let x = 0;
  for (const r of resized) {
    composites.push({ input: r.buffer, left: x, top: 0 });
    x += r.width + GAP;
  }

  return sharp({
    create: {
      width: totalWidth,
      height: maxHeight,
      channels: 3,
      background: { r: 13, g: 17, b: 23 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * Resize a mannequin image to the target size for feeding to the model.
 * V5 used: model card 2K, flat 1400px, mannequin 900px.
 *
 * CRITICAL: Mannequin images are 8256×5504 LANDSCAPE.
 * They must be rotated 90° CW to vertical before resizing.
 * This ensures Gemini sees the garment in correct orientation.
 */
export async function resizeForFeed(
  imageBuffer: Buffer,
  maxSide: number
): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 1000;
  const height = metadata.height || 1000;

  let processBuffer = imageBuffer;

  // Rotate landscape mannequin images to vertical
  if (width > height * 1.3) {
    processBuffer = await sharp(imageBuffer).rotate(90).toBuffer();
  }

  return sharp(processBuffer)
    .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
}
