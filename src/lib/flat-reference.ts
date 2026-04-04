/**
 * Flat Reference System — mathematical color & silhouette extraction from flat product images.
 *
 * The flat image is the ABSOLUTE GROUND TRUTH for:
 * 1. Color/wash — LAB-space color that generated images must match
 * 2. Shape/silhouette — measured widths at key points define the fit classification
 *
 * Used in generate/route.ts:
 * - Pre-generation: inject measured values into prompt as hard constraints
 * - Post-generation: LAB-based color correction to pull drift back to flat reference
 */

import sharp from 'sharp';

// ─── COLOR SPACE UTILITIES ──────────────────────────────────────────────────

/** CIE LAB color values */
export interface LabColor {
  l: number; // 0-100 (lightness)
  a: number; // -128 to 127 (green–red)
  b: number; // -128 to 127 (blue–yellow)
}

/** RGB→LAB conversion using D65 illuminant (sRGB standard) */
export function rgbToLab(r: number, g: number, b: number): LabColor {
  // 1. sRGB → linear RGB (gamma correction)
  let rl = r / 255;
  let gl = g / 255;
  let bl = b / 255;
  rl = rl > 0.04045 ? Math.pow((rl + 0.055) / 1.055, 2.4) : rl / 12.92;
  gl = gl > 0.04045 ? Math.pow((gl + 0.055) / 1.055, 2.4) : gl / 12.92;
  bl = bl > 0.04045 ? Math.pow((bl + 0.055) / 1.055, 2.4) : bl / 12.92;

  // 2. Linear RGB → XYZ (D65 reference white)
  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750) / 1.00000;
  const z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;

  // 3. XYZ → LAB
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + (16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** LAB→RGB conversion (clamped to 0-255) */
export function labToRgb(l: number, a: number, b: number): { r: number; g: number; b: number } {
  // 1. LAB → XYZ
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const finv = (t: number) => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
  };

  const x = 0.95047 * finv(fx);
  const y = 1.00000 * finv(fy);
  const z = 1.08883 * finv(fz);

  // 2. XYZ → linear RGB
  let rl = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  let gl = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
  let bl = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  // 3. Linear RGB → sRGB (inverse gamma)
  const gamma = (c: number) => c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;
  return {
    r: Math.max(0, Math.min(255, Math.round(gamma(rl) * 255))),
    g: Math.max(0, Math.min(255, Math.round(gamma(gl) * 255))),
    b: Math.max(0, Math.min(255, Math.round(gamma(bl) * 255))),
  };
}

/**
 * CIE76 Delta E — perceptual color distance in LAB space.
 * <2.3 = imperceptible, 2-10 = noticeable, >10 = obvious.
 */
export function deltaE(lab1: LabColor, lab2: LabColor): number {
  return Math.sqrt(
    (lab1.l - lab2.l) ** 2 +
    (lab1.a - lab2.a) ** 2 +
    (lab1.b - lab2.b) ** 2,
  );
}

// ─── FLAT COLOR EXTRACTION ──────────────────────────────────────────────────

export interface FlatColor {
  rgb: { r: number; g: number; b: number };
  hex: string;
  lab: LabColor;
  brightness: number;
  /** Hue category for prompt injection */
  hueDescription: string;
}

/**
 * Extract dominant garment color from flat product image.
 *
 * Strategy: the flat image has a white/light studio background.
 * We isolate the garment pixels (non-white) and compute the average color
 * in both RGB and LAB space. LAB is used for perceptual accuracy.
 */
export async function extractFlatColor(flatBuffer: Buffer): Promise<FlatColor> {
  const meta = await sharp(flatBuffer).metadata();
  const imgW = meta.width || 1000;
  const imgH = meta.height || 1500;

  // Sample the CENTER of the image (garment body, not edges or background)
  // Flat images: garment is centered, background is white/grey
  const sampleX = Math.round(imgW * 0.25);
  const sampleW = Math.round(imgW * 0.50);
  const sampleY = Math.round(imgH * 0.20);
  const sampleH = Math.round(imgH * 0.55);

  // Extract center region at low res for fast color sampling
  const sample = await sharp(flatBuffer)
    .extract({ left: sampleX, top: sampleY, width: sampleW, height: sampleH })
    .resize(40, 40, { fit: 'fill' })
    .raw()
    .toBuffer();

  const channels = meta.channels || 3;
  const pixelCount = 40 * 40;

  // Two-pass: first identify non-background pixels, then average only those
  // Background detection: pixels with brightness > 210 and saturation < 30
  const garmentPixels: Array<{ r: number; g: number; b: number }> = [];

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * channels;
    const r = sample[offset];
    const g = sample[offset + 1];
    const b = sample[offset + 2];

    // Skip white/very light background pixels
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
    const saturation = maxC === 0 ? 0 : ((maxC - minC) / maxC) * 255;

    // Background: bright AND low saturation
    if (brightness > 200 && saturation < 35) continue;

    garmentPixels.push({ r, g, b });
  }

  // Fallback: if almost no garment pixels found (weird flat), use all pixels
  const pixels = garmentPixels.length > 50 ? garmentPixels : (() => {
    const all: Array<{ r: number; g: number; b: number }> = [];
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * channels;
      all.push({ r: sample[offset], g: sample[offset + 1], b: sample[offset + 2] });
    }
    return all;
  })();

  // Compute average RGB
  let totalR = 0, totalG = 0, totalB = 0;
  for (const px of pixels) {
    totalR += px.r;
    totalG += px.g;
    totalB += px.b;
  }
  const avgR = Math.round(totalR / pixels.length);
  const avgG = Math.round(totalG / pixels.length);
  const avgB = Math.round(totalB / pixels.length);

  // Convert to LAB
  const lab = rgbToLab(avgR, avgG, avgB);
  const brightness = avgR * 0.299 + avgG * 0.587 + avgB * 0.114;
  const hex = `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')}`;

  // Derive hue description for prompt
  const hueDescription = describeHue(lab, avgR, avgG, avgB);

  console.log(`[FlatRef] Color extracted: ${hex} (LAB: L=${lab.l.toFixed(1)} a=${lab.a.toFixed(1)} b=${lab.b.toFixed(1)}) — ${garmentPixels.length}/${pixelCount} garment pixels — "${hueDescription}"`);

  return { rgb: { r: avgR, g: avgG, b: avgB }, hex, lab, brightness, hueDescription };
}

/** Describe the hue in plain English for prompt injection */
function describeHue(lab: LabColor, r: number, g: number, b: number): string {
  const { l, a, b: bVal } = lab;

  // Dark denim detection
  if (l < 30) return 'very dark/raw indigo denim — nearly black';
  if (l < 40 && bVal < -5) return 'dark indigo denim — deep navy';
  if (l < 40) return 'dark denim';

  // Medium denim tones
  if (l < 55 && bVal < -8) return 'medium indigo denim — classic blue';
  if (l < 55 && a > 0 && bVal > 0) return 'warm medium wash — sandy/tan undertone';
  if (l < 55 && a < -3) return 'greencast medium wash — green undertone';
  if (l < 55) return 'medium wash denim';

  // Light denim
  if (l < 70 && bVal < -5) return 'light blue wash denim';
  if (l < 70 && a > 2) return 'warm light wash — pink/salmon undertone';
  if (l < 70) return 'light wash denim';

  // Very light / bleached
  if (l >= 70 && bVal > 5) return 'bleached/sun-faded denim — yellow undertone';
  if (l >= 70) return 'very light / bleached denim';

  return 'denim';
}

// ─── FLAT SILHOUETTE EXTRACTION ─────────────────────────────────────────────

export interface FlatSilhouette {
  /** Width in pixels at each measurement point */
  widths: {
    waist: number;
    hip: number;
    midFemur: number;
    knee: number;
    midTibia: number;
    hem: number;
    /** @deprecated use midFemur */
    thigh: number;
  };
  /** Width ratios normalized to waist width (waist = 1.0) */
  ratios: {
    hip: number;
    midFemur: number;
    knee: number;
    midTibia: number;
    hem: number;
  };
  /** hem_width / knee_width — primary taper indicator */
  taperRatio: number;
  /** hem_width / waist_width — overall shape ratio */
  hemToWaistRatio: number;
  /** Fit classification derived from taper ratio */
  classification: 'barrel' | 'wide-straight' | 'straight' | 'tapered' | 'slim' | 'skinny';
  /** How clear the garment edges were (0-1) */
  confidence: number;
  /** Human-readable description for prompt injection */
  description: string;
}

/**
 * Measure garment silhouette from flat product image.
 *
 * Strategy: threshold the flat image to isolate the garment from the white
 * background, then measure horizontal width at 4 key heights:
 * - Waist (~12% from top)
 * - Thigh (~32% from top)
 * - Knee (~62% from top)
 * - Hem (~90% from top)
 *
 * The taper ratio (hem/thigh) classifies the fit.
 */
export async function extractFlatSilhouette(flatBuffer: Buffer): Promise<FlatSilhouette> {
  const meta = await sharp(flatBuffer).metadata();
  const imgW = meta.width || 1000;
  const imgH = meta.height || 1500;

  // Convert to grayscale, threshold to binary (garment = dark, background = white)
  // Use a medium-high threshold to catch even light wash denim
  const binaryBuf = await sharp(flatBuffer)
    .grayscale()
    .resize(200, Math.round(200 * (imgH / imgW)), { fit: 'fill' })
    .raw()
    .toBuffer();

  const binW = 200;
  const binH = Math.round(200 * (imgH / imgW));

  // Find garment bounds (top and bottom non-background rows)
  const THRESHOLD = 200; // pixels darker than this are garment
  let topRow = 0;
  let bottomRow = binH - 1;

  // Scan from top to find first garment row
  for (let y = 0; y < binH; y++) {
    let garmentPixels = 0;
    for (let x = 0; x < binW; x++) {
      if (binaryBuf[y * binW + x] < THRESHOLD) garmentPixels++;
    }
    if (garmentPixels > binW * 0.05) { // at least 5% of row is garment
      topRow = y;
      break;
    }
  }

  // Scan from bottom to find last garment row
  for (let y = binH - 1; y >= 0; y--) {
    let garmentPixels = 0;
    for (let x = 0; x < binW; x++) {
      if (binaryBuf[y * binW + x] < THRESHOLD) garmentPixels++;
    }
    if (garmentPixels > binW * 0.05) {
      bottomRow = y;
      break;
    }
  }

  const garmentHeight = bottomRow - topRow;
  if (garmentHeight < 20) {
    console.warn(`[FlatRef] Silhouette: garment too small (${garmentHeight}px) — returning defaults`);
    return defaultSilhouette();
  }

  // Measure width at 4 key points (as fraction of garment height)
  const measureRow = (fraction: number): number => {
    const y = Math.round(topRow + garmentHeight * fraction);
    if (y < 0 || y >= binH) return 0;

    let leftEdge = binW;
    let rightEdge = 0;
    for (let x = 0; x < binW; x++) {
      if (binaryBuf[y * binW + x] < THRESHOLD) {
        if (x < leftEdge) leftEdge = x;
        if (x > rightEdge) rightEdge = x;
      }
    }
    return rightEdge > leftEdge ? rightEdge - leftEdge : 0;
  };

  // Average 3 adjacent rows for each measurement (reduces noise)
  const measureAvg = (fraction: number): number => {
    const delta = 2 / garmentHeight; // ~2 pixel band
    return Math.round(
      (measureRow(fraction - delta) + measureRow(fraction) + measureRow(fraction + delta)) / 3,
    );
  };

  // 6 measurement points matching anatomical landmarks
  const waistW = measureAvg(0.10);
  const hipW = measureAvg(0.22);
  const midFemurW = measureAvg(0.40);
  const kneeW = measureAvg(0.58);
  const midTibiaW = measureAvg(0.75);
  const hemW = measureAvg(0.92);

  // Scale measurements back to original image pixels
  const scale = imgW / binW;
  const widths = {
    waist: Math.round(waistW * scale),
    hip: Math.round(hipW * scale),
    midFemur: Math.round(midFemurW * scale),
    knee: Math.round(kneeW * scale),
    midTibia: Math.round(midTibiaW * scale),
    hem: Math.round(hemW * scale),
    thigh: Math.round(midFemurW * scale), // backwards compat
  };

  // Compute ratios (normalized to waist — most intuitive reference)
  const waistRef = waistW || 1;
  const ratios = {
    hip: Math.round((hipW / waistRef) * 100) / 100,
    midFemur: Math.round((midFemurW / waistRef) * 100) / 100,
    knee: Math.round((kneeW / waistRef) * 100) / 100,
    midTibia: Math.round((midTibiaW / waistRef) * 100) / 100,
    hem: Math.round((hemW / waistRef) * 100) / 100,
  };
  const taperRatio = kneeW ? Math.round((hemW / kneeW) * 100) / 100 : 1;
  const hemToWaistRatio = Math.round((hemW / waistRef) * 100) / 100;

  // Classify fit based on hem-to-knee ratio
  let classification: FlatSilhouette['classification'];
  if (taperRatio > 1.10) classification = 'barrel';
  else if (taperRatio > 0.95) classification = 'wide-straight';
  else if (taperRatio > 0.82) classification = 'straight';
  else if (taperRatio > 0.65) classification = 'tapered';
  else if (taperRatio > 0.50) classification = 'slim';
  else classification = 'skinny';

  // Confidence based on how clear the measurements are
  const allWidths = [waistW, hipW, midFemurW, kneeW, midTibiaW, hemW];
  const validWidths = allWidths.filter(w => w > 5);
  const confidence = Math.min(1, validWidths.length / 6);

  const description = buildSilhouetteDescription(classification, taperRatio, ratios, hemToWaistRatio);

  console.log(`[FlatRef] Silhouette: ${classification} (ankle/knee=${taperRatio.toFixed(2)}, ankle/waist=${hemToWaistRatio.toFixed(2)}) — waist=${widths.waist} hip=${widths.hip} midFemur=${widths.midFemur} knee=${widths.knee} midTibia=${widths.midTibia} hem=${widths.hem} — conf=${confidence.toFixed(1)}`);

  return { widths, ratios, taperRatio, hemToWaistRatio, classification, confidence, description };
}

function defaultSilhouette(): FlatSilhouette {
  return {
    widths: { waist: 0, hip: 0, midFemur: 0, knee: 0, midTibia: 0, hem: 0, thigh: 0 },
    ratios: { hip: 1, midFemur: 1, knee: 1, midTibia: 1, hem: 1 },
    taperRatio: 1,
    hemToWaistRatio: 1,
    classification: 'straight',
    confidence: 0,
    description: 'straight fit (default — silhouette could not be measured)',
  };
}

function buildSilhouetteDescription(
  classification: string,
  taperRatio: number,
  ratios: { hip: number; midFemur: number; knee: number; midTibia: number; hem: number },
  hemToWaistRatio: number,
): string {
  const parts: string[] = [];

  // Width profile as a visual guide for Gemini
  parts.push(`MEASURED WIDTH PROFILE (waist = 100%):`);
  parts.push(`  Waist: 100% | Hip: ${Math.round(ratios.hip * 100)}% | Mid-thigh: ${Math.round(ratios.midFemur * 100)}% | Knee: ${Math.round(ratios.knee * 100)}% | Mid-calf: ${Math.round(ratios.midTibia * 100)}% | Ankle: ${Math.round(ratios.hem * 100)}%`);

  switch (classification) {
    case 'barrel':
      parts.push(`This is a BARREL/FLARE FIT — the legs get PROGRESSIVELY WIDER from hip to hem.`);
      parts.push(`The ankle opening is ${Math.round(hemToWaistRatio * 100)}% of waist width and ${Math.round(taperRatio * 100)}% of knee width — WIDER than both.`);
      parts.push(`This is an EXTREMELY wide, loose garment. The fabric must billow out dramatically below the knee. If the generated legs look like a normal straight or relaxed fit, it is WRONG — they must be visibly, dramatically wide.`);
      break;
    case 'wide-straight':
      parts.push(`WIDE STRAIGHT FIT — consistent generous width from thigh to hem.`);
      parts.push(`Ankle is ${Math.round(hemToWaistRatio * 100)}% of waist width. Minimal tapering throughout.`);
      break;
    case 'straight':
      parts.push(`STRAIGHT FIT — slight taper from thigh to hem.`);
      parts.push(`Ankle is ${Math.round(hemToWaistRatio * 100)}% of waist width. Classic proportions.`);
      break;
    case 'tapered':
      parts.push(`TAPERED FIT — clear narrowing from thigh to ankle.`);
      parts.push(`Ankle is ${Math.round(hemToWaistRatio * 100)}% of waist width. Noticeably slimmer at the ankle.`);
      break;
    case 'slim':
      parts.push(`SLIM FIT — significant taper, close-fitting through knee and ankle.`);
      parts.push(`Ankle is only ${Math.round(hemToWaistRatio * 100)}% of waist width.`);
      break;
    case 'skinny':
      parts.push(`SKINNY FIT — extreme taper, body-hugging from knee to hem.`);
      parts.push(`Ankle is only ${Math.round(hemToWaistRatio * 100)}% of waist width.`);
      break;
  }

  // Highlight the progression direction
  if (hemToWaistRatio > 1.15) {
    parts.push(`KEY: The leg opening is ${Math.round((hemToWaistRatio - 1) * 100)}% WIDER than the waist. The silhouette EXPANDS from waist to ankle — do NOT compress it.`);
  } else if (hemToWaistRatio < 0.70) {
    parts.push(`KEY: The leg opening is ${Math.round((1 - hemToWaistRatio) * 100)}% NARROWER than the waist. Significant tapering.`);
  }

  return parts.join('\n');
}

// ─── POST-GENERATION COLOR CORRECTION ───────────────────────────────────────

export interface ColorCorrectionResult {
  applied: boolean;
  correctedBuffer: Buffer;
  deltaE_before: number;
  deltaE_after: number;
  labShift: { dl: number; da: number; db: number };
}

/**
 * Correct generated image color to match flat reference using LAB color space.
 *
 * Strategy:
 * 1. Sample garment area of generated image
 * 2. Compare LAB values against flat reference
 * 3. If delta_E > threshold, apply correction via Sharp tint/modulate
 * 4. Conservative correction (60% of measured shift) to avoid overcorrection
 *
 * @param generatedBuffer - The AI-generated image
 * @param flatColor - The flat reference color (ground truth)
 * @param isCropped - Whether this is a cropped shot (M01/M02) — affects sampling region
 */
export async function correctColorToFlat(
  generatedBuffer: Buffer,
  flatColor: FlatColor,
  isCropped: boolean = false,
): Promise<ColorCorrectionResult> {
  const genMeta = await sharp(generatedBuffer).metadata();
  const genW = genMeta.width || 1800;
  const genH = genMeta.height || 2400;

  // Sample garment area (center strip, mid-height)
  // Cropped shots: garment fills 10-85% height
  // Full-body shots: garment is roughly 35-75% height
  const sampleTop = isCropped ? Math.round(genH * 0.15) : Math.round(genH * 0.38);
  const sampleH = isCropped ? Math.round(genH * 0.55) : Math.round(genH * 0.30);
  const sampleX = Math.round(genW * 0.25);
  const sampleW = Math.round(genW * 0.50);

  const genSample = await sharp(generatedBuffer)
    .extract({ left: sampleX, top: sampleTop, width: sampleW, height: sampleH })
    .resize(30, 30, { fit: 'fill' })
    .raw()
    .toBuffer();

  const channels = genMeta.channels || 3;
  const pixelCount = 30 * 30;

  // Collect only garment pixels (skip skin, background)
  let totalR = 0, totalG = 0, totalB = 0;
  let garmentCount = 0;
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * channels;
    const r = genSample[offset];
    const g = genSample[offset + 1];
    const b = genSample[offset + 2];

    // Skip skin tones (high R, medium G, low B) and background (bright + low sat)
    const brightness = r * 0.299 + g * 0.587 + b * 0.114;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;

    // Skip very bright (background) or skin-like pixels
    if (brightness > 200 && sat < 0.15) continue;
    if (r > 160 && g > 100 && b > 80 && r > g && g > b && sat < 0.35) continue;

    totalR += r;
    totalG += g;
    totalB += b;
    garmentCount++;
  }

  if (garmentCount < 50) {
    // Not enough garment pixels sampled — skip correction
    return {
      applied: false,
      correctedBuffer: generatedBuffer,
      deltaE_before: 0,
      deltaE_after: 0,
      labShift: { dl: 0, da: 0, db: 0 },
    };
  }

  const avgR = Math.round(totalR / garmentCount);
  const avgG = Math.round(totalG / garmentCount);
  const avgB = Math.round(totalB / garmentCount);
  const genLab = rgbToLab(avgR, avgG, avgB);

  const dE = deltaE(flatColor.lab, genLab);
  console.log(`[FlatRef] Color comparison — flat: LAB(${flatColor.lab.l.toFixed(1)},${flatColor.lab.a.toFixed(1)},${flatColor.lab.b.toFixed(1)}) gen: LAB(${genLab.l.toFixed(1)},${genLab.a.toFixed(1)},${genLab.b.toFixed(1)}) delta_E=${dE.toFixed(1)}`);

  // Threshold: delta_E > 12 is a noticeable color difference worth correcting
  if (dE <= 12) {
    return {
      applied: false,
      correctedBuffer: generatedBuffer,
      deltaE_before: dE,
      deltaE_after: dE,
      labShift: { dl: 0, da: 0, db: 0 },
    };
  }

  // Compute LAB shift needed
  const dl = flatColor.lab.l - genLab.l; // positive = need to darken (lower L)
  const da = flatColor.lab.a - genLab.a; // positive = need more red/less green
  const db = flatColor.lab.b - genLab.b; // positive = need more yellow/less blue

  // Apply 60% of the shift (conservative — avoid overcorrection)
  const correctionStrength = 0.6;

  // Convert LAB shift to Sharp operations:
  // - Lightness (L) → brightness modulation
  // - a/b chrominance → tint adjustment
  const brightnessShift = dl * correctionStrength;
  const brightnessFactor = 1 + (brightnessShift / 100); // L is 0-100
  const safeBrightness = Math.max(0.70, Math.min(1.30, brightnessFactor));

  // For hue/chroma correction: compute the target tint
  // We use Sharp's modulate + tint approach
  // Hue shift in degrees from a/b changes
  const currentHueRad = Math.atan2(genLab.b, genLab.a);
  const targetHueRad = Math.atan2(flatColor.lab.b, flatColor.lab.a);
  let hueShiftDeg = ((targetHueRad - currentHueRad) * 180) / Math.PI;
  // Apply partial correction
  hueShiftDeg *= correctionStrength;
  // Clamp to reasonable range
  hueShiftDeg = Math.max(-30, Math.min(30, hueShiftDeg));

  // Saturation adjustment based on chroma difference
  const genChroma = Math.sqrt(genLab.a ** 2 + genLab.b ** 2);
  const flatChroma = Math.sqrt(flatColor.lab.a ** 2 + flatColor.lab.b ** 2);
  let satFactor = genChroma > 0 ? flatChroma / genChroma : 1;
  satFactor = 1 + (satFactor - 1) * correctionStrength; // partial correction
  satFactor = Math.max(0.70, Math.min(1.40, satFactor));

  console.log(`[FlatRef] Correction: brightness=${safeBrightness.toFixed(3)} hue=${hueShiftDeg.toFixed(1)}° sat=${satFactor.toFixed(3)} (delta_E=${dE.toFixed(1)})`);

  // Apply corrections via Sharp modulate
  let corrected = await sharp(generatedBuffer)
    .modulate({
      brightness: safeBrightness,
      saturation: satFactor,
      hue: Math.round(hueShiftDeg),
    })
    .jpeg({ quality: 95 })
    .toBuffer();

  // Verify correction improved things
  const verifySample = await sharp(corrected)
    .extract({ left: sampleX, top: sampleTop, width: sampleW, height: sampleH })
    .resize(30, 30, { fit: 'fill' })
    .raw()
    .toBuffer();

  let vR = 0, vG = 0, vB = 0, vCount = 0;
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * channels;
    const r = verifySample[offset];
    const g = verifySample[offset + 1];
    const b = verifySample[offset + 2];
    const brightness = r * 0.299 + g * 0.587 + b * 0.114;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
    if (brightness > 200 && sat < 0.15) continue;
    if (r > 160 && g > 100 && b > 80 && r > g && g > b && sat < 0.35) continue;
    vR += r; vG += g; vB += b; vCount++;
  }

  let dE_after = dE;
  if (vCount > 20) {
    const corrLab = rgbToLab(Math.round(vR / vCount), Math.round(vG / vCount), Math.round(vB / vCount));
    dE_after = deltaE(flatColor.lab, corrLab);
  }

  // Only apply if correction actually improved things
  if (dE_after >= dE) {
    console.log(`[FlatRef] Correction did not improve (${dE.toFixed(1)} → ${dE_after.toFixed(1)}) — keeping original`);
    return {
      applied: false,
      correctedBuffer: generatedBuffer,
      deltaE_before: dE,
      deltaE_after: dE,
      labShift: { dl, da, db },
    };
  }

  console.log(`[FlatRef] Color corrected: delta_E ${dE.toFixed(1)} → ${dE_after.toFixed(1)}`);

  return {
    applied: true,
    correctedBuffer: corrected,
    deltaE_before: dE,
    deltaE_after: dE_after,
    labShift: { dl: dl * correctionStrength, da: da * correctionStrength, db: db * correctionStrength },
  };
}
