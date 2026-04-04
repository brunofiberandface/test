/**
 * Zone Grid Generator — Server-side crop grids from fit model 360° images.
 *
 * TWO SYSTEMS:
 * 1. Legacy zone grids (generateZoneGrids) — old 3-4 angle grids, kept for jackets/special zones
 * 2. Panoramic strips (generatePanoramicStrips) — NEW: full 360° strips with flat image integration
 *
 * Panoramic strips combine ALL 8 fit model angles + flat front + flat back into
 * one high-resolution horizontal strip per zone. Three strips for pants: waist, knee, ankle.
 * Each strip gives Gemini complete 360° construction detail for that zone.
 *
 * Uses sharp for image processing (available in Node.js).
 */
import sharp from 'sharp';
import { ZONE_DEFS, PANORAMIC_ZONES } from './prompts';

// ── Types ──

interface ZoneGrid {
  buffer: Buffer;
  mimeType: string;
  label: string;
  zoneName: string;
}

export interface PanoramicStrip {
  buffer: Buffer;
  mimeType: string;
  label: string;
  zoneName: string;      // 'waist' | 'knee' | 'ankle'
  panelCount: number;    // how many panels in this strip
}

// ── Panoramic Strip Generator (NEW) ──

/**
 * Generate panoramic 360° zone strips from fit model images + flat images.
 *
 * For each zone (waist, knee, ankle):
 * 1. Crops ALL available fit model angles to that zone region
 * 2. Crops flat front and flat back to the corresponding zone region
 * 3. Orders panels by shot type (front-focused or back-focused)
 * 4. Concatenates into one high-res horizontal strip
 *
 * NO resolution compromises — crops at native resolution, panels normalized to
 * a consistent height (TARGET_PANEL_HEIGHT) to keep detail while fitting in one strip.
 *
 * @param fitModelImages All fit model images in rotation order (index 0=front, 4=back)
 * @param flatFrontBuffer Flat front garment image (or null)
 * @param flatBackBuffer Flat back garment image (or null)
 * @param shotType Shot being generated — determines panel order
 * @param garmentCategory 'pants' | 'jackets' | 'default'
 */
export async function generatePanoramicStrips(
  fitModelImages: Array<{ buffer: Buffer; index: number }>,
  flatFrontBuffer: Buffer | null,
  flatBackBuffer: Buffer | null,
  shotType: string,
  garmentCategory: string
): Promise<PanoramicStrip[]> {
  // Currently panoramic strips only defined for pants
  const zones = garmentCategory === 'pants'
    ? PANORAMIC_ZONES.pants
    : null;

  if (!zones) {
    console.log(`[PanoramicStrips] No panoramic zones for ${garmentCategory}, falling back to legacy`);
    return [];
  }

  const isBackShot = shotType === 'M02' || shotType === 'M04' || shotType === 'M05';
  const strips: PanoramicStrip[] = [];

  for (const [zoneKey, zoneDef] of Object.entries(zones)) {
    try {
      const strip = await createPanoramicStrip(
        fitModelImages,
        flatFrontBuffer,
        flatBackBuffer,
        zoneDef,
        zoneKey,
        isBackShot
      );
      if (strip) strips.push(strip);
    } catch (err) {
      console.error(`[PanoramicStrips] Failed to create ${zoneKey} strip:`, err);
    }
  }

  console.log(`[PanoramicStrips] Generated ${strips.length} panoramic strips for ${garmentCategory} (${shotType}, ${isBackShot ? 'back' : 'front'}-focused)`);
  return strips;
}

/**
 * Create a single panoramic strip for one zone.
 *
 * Panel layout (back shot example):
 * [flat_back | angle4(back) | angle3 | angle5 | angle2 | angle6 | angle1 | angle7 | angle0(front) | flat_front]
 *
 * Panel layout (front shot example):
 * [flat_front | angle0(front) | angle7 | angle1 | angle6 | angle2 | angle5 | angle3 | angle4(back) | flat_back]
 *
 * Most relevant views are in the CENTER of the strip for maximum Gemini attention.
 */
async function createPanoramicStrip(
  fitModelImages: Array<{ buffer: Buffer; index: number }>,
  flatFrontBuffer: Buffer | null,
  flatBackBuffer: Buffer | null,
  zoneDef: {
    name: string;
    fitModel: { y1: number; y2: number; x1: number; x2: number };
    flatFront?: { y1: number; y2: number; x1: number; x2: number };
    flatBack?: { y1: number; y2: number; x1: number; x2: number };
    flat?: { y1: number; y2: number; x1: number; x2: number };  // legacy fallback
    frontOrder: readonly number[];
    backOrder: readonly number[];
  },
  zoneKey: string,
  isBackShot: boolean
): Promise<PanoramicStrip | null> {
  const panels: Array<{ buffer: Buffer; label: string }> = [];
  const fullAngleOrder = isBackShot ? zoneDef.backOrder : zoneDef.frontOrder;

  // v38: Both front and back use only 3 most relevant angles (first 3 in their order).
  // + primary flat = 4 panels total. Fewer panels = higher resolution per panel.
  // This mirrors the v38 fit model isolation: no cross-contamination, max detail.
  const MAX_ANGLES = 3;
  const angleOrder = fullAngleOrder.slice(0, MAX_ANGLES);

  // Determine which flat goes first (most relevant to shot type)
  const primaryFlat = isBackShot ? flatBackBuffer : flatFrontBuffer;
  const primaryFlatLabel = isBackShot ? 'FLAT BACK' : 'FLAT FRONT';

  // v40: Use view-specific flat crop regions (flatFront/flatBack) when available,
  // fall back to shared `flat` region for backward compatibility.
  const flatCropRegion = isBackShot
    ? (zoneDef.flatBack || zoneDef.flat!)
    : (zoneDef.flatFront || zoneDef.flat!);

  // 1. Primary flat crop (first panel — most relevant flat for this shot type)
  if (primaryFlat && flatCropRegion) {
    try {
      const crop = await cropFlatZone(primaryFlat, flatCropRegion);
      if (crop) panels.push({ buffer: crop, label: primaryFlatLabel });
    } catch (err) {
      console.warn(`[PanoramicStrips] Failed to crop primary flat for ${zoneKey}:`, err);
    }
  }

  // 2. Fit model angle crops in shot-type order
  const ANGLE_LABELS: Record<number, string> = {
    0: '0° front',
    1: '45° front-right',
    2: '90° right',
    3: '135° back-right',
    4: '180° back',
    5: '225° back-left',
    6: '270° left',
    7: '315° front-left',
  };

  for (const angleIdx of angleOrder) {
    const img = findClosestImage(fitModelImages, angleIdx);
    if (!img) continue;

    try {
      const crop = await cropFitModelZone(img.buffer, zoneDef.fitModel);
      if (crop) {
        const label = ANGLE_LABELS[angleIdx] || `angle ${angleIdx}`;
        panels.push({ buffer: crop, label });
      }
    } catch (err) {
      console.warn(`[PanoramicStrips] Failed to crop angle ${angleIdx} for ${zoneKey}:`, err);
    }
  }

  // v38: No secondary flat — both front and back get 4 panels max (3 angles + 1 primary flat).
  // Keeps resolution high and prevents cross-contamination from the opposite-view flat.

  if (panels.length < 2) return null;

  // 4. Concatenate all panels into one horizontal strip — HIGH RESOLUTION
  // v38: Both front and back have 4 panels — 1200px height for maximum detail.
  const panelHeight = 1200;
  const stripBuffer = await concatenateHighRes(panels.map(p => p.buffer), panelHeight);

  // Build descriptive label
  const angleList = panels.map(p => p.label).join(' → ');
  const viewDirection = isBackShot ? 'back-centered' : 'front-centered';

  return {
    buffer: stripBuffer,
    mimeType: 'image/jpeg',
    // v39b: Purely observational — reproduce ONLY what is visible, never assume features exist.
    label: `360° ZONE GRID: ${zoneDef.name} (${viewDirection}). ` +
      `${panels.length} panels arranged in 2×2 grid: [${angleList}]. ` +
      `Flat images show TRUE garment WIDTH without body distortion. ` +
      `Fit model images show how fabric drapes on a real body from every angle. ` +
      `Reproduce ONLY the construction details visible in these panels — seams, stitching, hardware. ` +
      `If an area appears as clean, smooth denim with no visible seam lines, it MUST stay clean. ` +
      `Do NOT assume or add construction features that are not clearly visible.`,
    zoneName: zoneKey,
    panelCount: panels.length,
  };
}

/**
 * Crop a zone from a fit model image (may need rotation if landscape).
 * NO downscaling — crops at native resolution for maximum detail preservation.
 */
async function cropFitModelZone(
  imageBuffer: Buffer,
  region: { y1: number; y2: number; x1: number; x2: number }
): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const origWidth = metadata.width || 1000;
  const origHeight = metadata.height || 1000;

  let processBuffer = imageBuffer;
  let width = origWidth;
  let height = origHeight;

  // Rotate landscape images to vertical (fit model images may be landscape like mannequin)
  if (origWidth > origHeight * 1.3) {
    processBuffer = await sharp(imageBuffer).rotate(90).toBuffer();
    width = origHeight;
    height = origWidth;
  }

  return extractRegion(processBuffer, width, height, region);
}

/**
 * Crop a zone from a flat garment image.
 * Flat images are already vertical — no rotation needed.
 * NO downscaling — native resolution preserved.
 */
async function cropFlatZone(
  imageBuffer: Buffer,
  region: { y1: number; y2: number; x1: number; x2: number }
): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 1000;
  const height = metadata.height || 1000;

  return extractRegion(imageBuffer, width, height, region);
}

/**
 * Extract a region from an image using fractional coordinates.
 * Returns the crop at NATIVE resolution — no downscaling.
 */
async function extractRegion(
  buffer: Buffer,
  width: number,
  height: number,
  region: { y1: number; y2: number; x1: number; x2: number }
): Promise<Buffer> {
  const left = Math.round(width * region.x1);
  const top = Math.round(height * region.y1);
  const cropWidth = Math.round(width * (region.x2 - region.x1));
  const cropHeight = Math.round(height * (region.y2 - region.y1));

  const safeLeft = Math.max(0, Math.min(left, width - 1));
  const safeTop = Math.max(0, Math.min(top, height - 1));
  const safeWidth = Math.min(cropWidth, width - safeLeft);
  const safeHeight = Math.min(cropHeight, height - safeTop);

  if (safeWidth <= 0 || safeHeight <= 0) {
    throw new Error(`Invalid crop: ${safeWidth}x${safeHeight} from ${width}x${height}`);
  }

  return sharp(buffer)
    .extract({ left: safeLeft, top: safeTop, width: safeWidth, height: safeHeight })
    .jpeg({ quality: 95 })  // High quality — no compromises
    .toBuffer();
}

/**
 * Composite panels into a 2×2 square grid (replaces old 1×4 horizontal strip).
 *
 * v39: Gemini API caps input images at 3072×3072px. The old 1×4 strip (1200×4800px)
 * was being force-scaled to 768×3072px — LOSING half the detail resolution.
 * A 2×2 grid (~2400×2400px) stays under the 3072 limit, so Gemini processes
 * each panel at FULL 1200px native resolution. This is the #1 fix for
 * construction detail fidelity (seams, stitching, hardware).
 *
 * Layout (4 panels):
 *   [panel 0] [panel 1]
 *   [panel 2] [panel 3]
 *
 * If fewer than 4 panels, fills left-to-right, top-to-bottom.
 * If odd number, last slot is empty (background color).
 */
async function concatenateHighRes(images: Buffer[], maxPanelHeight = 600): Promise<Buffer> {
  if (images.length === 1) return images[0];

  const GAP = 3; // Thin gap between panels

  // Get metadata for all panels
  const metas = await Promise.all(
    images.map(async (buf) => {
      const meta = await sharp(buf).metadata();
      return { width: meta.width || 500, height: meta.height || 500, buffer: buf };
    })
  );

  // Normalize to consistent height — use the MEDIAN height to avoid outlier distortion
  const heights = metas.map(m => m.height).sort((a, b) => a - b);
  const targetHeight = heights[Math.floor(heights.length / 2)]; // median

  // v39: Panel height stays at 1200px — now preserved because grid fits under 3072×3072
  const normalizedHeight = Math.min(targetHeight, maxPanelHeight);

  const resized = await Promise.all(
    metas.map(async (m) => {
      const scale = normalizedHeight / m.height;
      const newWidth = Math.round(m.width * scale);
      const buf = await sharp(m.buffer)
        .resize(newWidth, normalizedHeight, { fit: 'fill' })
        .jpeg({ quality: 95 })
        .toBuffer();
      return { buffer: buf, width: newWidth, height: normalizedHeight };
    })
  );

  // v39: 2×2 grid layout instead of 1×4 horizontal strip.
  // Grid dimensions: 2 columns, ceil(panels/2) rows.
  // Each cell is sized to the widest panel in its column.
  const cols = 2;
  const rows = Math.ceil(resized.length / cols);

  // Find max width per column
  const colWidths = [0, 0];
  for (let i = 0; i < resized.length; i++) {
    const col = i % cols;
    colWidths[col] = Math.max(colWidths[col], resized[i].width);
  }

  const totalWidth = colWidths[0] + GAP + colWidths[1];
  const totalHeight = normalizedHeight * rows + GAP * (rows - 1);

  // Safety check: if grid somehow exceeds 3072, scale down (shouldn't happen with 1200px panels)
  const GEMINI_MAX = 3072;
  let scaleFactor = 1;
  if (totalWidth > GEMINI_MAX || totalHeight > GEMINI_MAX) {
    scaleFactor = Math.min(GEMINI_MAX / totalWidth, GEMINI_MAX / totalHeight);
    console.log(`[PanoramicStrips] v39: Grid ${totalWidth}×${totalHeight} exceeds ${GEMINI_MAX}px, scaling by ${(scaleFactor * 100).toFixed(0)}%`);
  }

  const finalWidth = Math.round(totalWidth * scaleFactor);
  const finalHeight = Math.round(totalHeight * scaleFactor);

  // Position panels in the grid — v40: CENTER panels in their column to avoid black gaps
  // (e.g., ankle flat crop of single leg is narrower than fit model panels)
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];
  for (let i = 0; i < resized.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const colLeft = col === 0 ? 0 : colWidths[0] + GAP;
    const padX = Math.floor((colWidths[col] - resized[i].width) / 2); // center in column
    const left = colLeft + padX;
    const top = row * (normalizedHeight + GAP);

    let panelBuf = resized[i].buffer;
    if (scaleFactor < 1) {
      const newW = Math.round(resized[i].width * scaleFactor);
      const newH = Math.round(normalizedHeight * scaleFactor);
      panelBuf = await sharp(panelBuf).resize(newW, newH, { fit: 'fill' }).jpeg({ quality: 95 }).toBuffer();
      composites.push({ input: panelBuf, left: Math.round(left * scaleFactor), top: Math.round(top * scaleFactor) });
    } else {
      composites.push({ input: panelBuf, left, top });
    }
  }

  console.log(`[PanoramicStrips] v40: 2×2 grid ${finalWidth}×${finalHeight}px (${resized.length} panels, ${normalizedHeight}px each) — fits under Gemini ${GEMINI_MAX}px limit`);

  return sharp({
    create: {
      width: finalWidth,
      height: finalHeight,
      channels: 3,
      background: { r: 200, g: 200, b: 200 }, // v40: Light gray bg — less jarring when panels are centered
    },
  })
    .composite(composites)
    .jpeg({ quality: 95 })
    .toBuffer();
}


// ══════════════════════════════════════════════════════════════════
// LEGACY ZONE GRIDS — kept for jackets, special zones, backward compat
// ══════════════════════════════════════════════════════════════════

/**
 * Generate zone crop grids from mannequin images (LEGACY).
 * Still used for jackets and special zone crops.
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

async function createZoneGrid(
  mannequinImages: Array<{ buffer: Buffer; index: number }>,
  zoneDef: { y1: number; y2: number; x1: number; x2: number; angles: readonly number[]; name: string },
  zoneKey: string
): Promise<ZoneGrid | null> {
  const crops: Buffer[] = [];

  for (const angleIdx of zoneDef.angles) {
    const img = findClosestImage(mannequinImages, angleIdx);
    if (!img) continue;

    try {
      const crop = await cropZoneLegacy(img.buffer, zoneDef);
      if (crop) crops.push(crop);
    } catch (err) {
      console.error(`[ZoneGrids] Failed to crop angle ${angleIdx} for ${zoneKey}:`, err);
    }
  }

  if (crops.length === 0) return null;

  const gridBuffer = await concatenateHighRes(crops);

  return {
    buffer: gridBuffer,
    mimeType: 'image/jpeg',
    label: `CONSTRUCTION DETAIL GRID: ${zoneDef.name} from ${crops.length} angles. Copy seam patterns, hardware, and trim EXACTLY as shown.`,
    zoneName: zoneKey,
  };
}

function findClosestImage(
  images: Array<{ buffer: Buffer; index: number }>,
  targetAngle: number
): { buffer: Buffer; index: number } | null {
  if (images.length === 0) return null;

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

async function cropZoneLegacy(
  imageBuffer: Buffer,
  zoneDef: { y1: number; y2: number; x1: number; x2: number }
): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const origWidth = metadata.width || 1000;
  const origHeight = metadata.height || 1000;

  let processBuffer = imageBuffer;
  let width = origWidth;
  let height = origHeight;

  if (origWidth > origHeight) {
    processBuffer = await sharp(imageBuffer).rotate(90).toBuffer();
    width = origHeight;
    height = origWidth;
  }

  return extractRegion(processBuffer, width, height, zoneDef);
}


// ══════════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ══════════════════════════════════════════════════════════════════

/**
 * Resize a fit model/mannequin image to the target size for feeding to the model.
 *
 * CRITICAL: Fit model images may be landscape (8256×5504).
 * They must be rotated 90° CW to vertical before resizing.
 */
export async function resizeForFeed(
  imageBuffer: Buffer,
  maxSide: number
): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 1000;
  const height = metadata.height || 1000;

  let processBuffer = imageBuffer;

  // Rotate landscape images to vertical
  if (width > height * 1.3) {
    processBuffer = await sharp(imageBuffer).rotate(90).toBuffer();
  }

  return sharp(processBuffer)
    .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 95 })
    .toBuffer();
}
