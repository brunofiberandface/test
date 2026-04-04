/**
 * Shot QC — Two-layer quality control for generated images.
 *
 * Layer 1: Deterministic pixel checks (background, framing, exposure) — no AI cost.
 * Layer 2: Flat-vs-generated comparison via Gemini Flash Lite (~$0.002/call).
 *
 * Both layers produce structured scores. The combined result determines pass/fail.
 */

import sharp from 'sharp';

// ── Config ──
const QC_MODEL = 'gemini-2.5-flash-lite';
const BACKGROUND_GREY_TARGET = { r: 200, g: 200, b: 200 }; // approx studio grey
const BACKGROUND_TOLERANCE = 60; // max per-channel deviation from grey
const BACKGROUND_TEXTURE_THRESHOLD = 15; // max stddev in background region (detects floor patterns)
const MIN_BRIGHTNESS = 60;
const MAX_BRIGHTNESS = 245;

// ── Types ──

export interface DeterministicQCResult {
  backgroundClean: boolean;
  backgroundNote: string;
  framingOk: boolean;
  framingNote: string;
  exposureOk: boolean;
  exposureNote: string;
  pass: boolean;
}

export interface FlatComparisonQCResult {
  colorMatch: { score: number; note: string };
  seamFidelity: { score: number; note: string };
  pocketAccuracy: { score: number; note: string };
  silhouetteMatch: { score: number; note: string };
  lengthCorrect: { score: number; note: string };
  backgroundCheck: { score: number; note: string };
  weightedScore: number;
  pass: boolean;
  criticalIssues: string[];
  summary: string;
}

export interface ShotQCResult {
  layer1: DeterministicQCResult;
  layer2: FlatComparisonQCResult | null;
  overallPass: boolean;
  overallScore: number;
  timestamp: string;
}

// ════════════════════════════════════════════════════════════════════
// LAYER 1: Deterministic Pixel Checks
// ════════════════════════════════════════════════════════════════════

export async function runDeterministicQC(
  imageBuffer: Buffer,
  shotType: string,
): Promise<DeterministicQCResult> {
  const metadata = await sharp(imageBuffer).metadata();
  const { width = 0, height = 0 } = metadata;

  // ── Background check: sample edges + bottom 10% ──
  const bgResult = await checkBackground(imageBuffer, width, height);

  // ── Framing check: is the full body visible? ──
  const framingResult = checkFraming(width, height, shotType);

  // ── Exposure check: not too dark, not blown out ──
  const exposureResult = await checkExposure(imageBuffer, width, height);

  const pass = bgResult.clean && framingResult.ok && exposureResult.ok;

  return {
    backgroundClean: bgResult.clean,
    backgroundNote: bgResult.note,
    framingOk: framingResult.ok,
    framingNote: framingResult.note,
    exposureOk: exposureResult.ok,
    exposureNote: exposureResult.note,
    pass,
  };
}

async function checkBackground(
  imageBuffer: Buffer,
  width: number,
  height: number,
): Promise<{ clean: boolean; note: string }> {
  // Sample the bottom 10% of the image (where floor hallucinations appear)
  const bottomY = Math.floor(height * 0.90);
  const bottomHeight = height - bottomY;

  const bottomStrip = await sharp(imageBuffer)
    .extract({ left: 0, top: bottomY, width, height: bottomHeight })
    .raw()
    .toBuffer();

  // Also sample left and right edges (10% width strips)
  const edgeWidth = Math.floor(width * 0.08);

  const leftStrip = await sharp(imageBuffer)
    .extract({ left: 0, top: Math.floor(height * 0.3), width: edgeWidth, height: Math.floor(height * 0.4) })
    .raw()
    .toBuffer();

  const rightStrip = await sharp(imageBuffer)
    .extract({ left: width - edgeWidth, top: Math.floor(height * 0.3), width: edgeWidth, height: Math.floor(height * 0.4) })
    .raw()
    .toBuffer();

  // Check bottom strip: compute mean color and texture (stddev)
  const bottomStats = computePixelStats(bottomStrip);
  const leftStats = computePixelStats(leftStrip);
  const rightStats = computePixelStats(rightStrip);

  const issues: string[] = [];

  // Check if bottom has texture (floor pattern detection)
  if (bottomStats.stddev > BACKGROUND_TEXTURE_THRESHOLD) {
    issues.push(`Floor texture detected (stddev=${bottomStats.stddev.toFixed(1)}, threshold=${BACKGROUND_TEXTURE_THRESHOLD})`);
  }

  // Check if edges are neutral grey-ish (not colored)
  for (const [name, stats] of [['left', leftStats], ['right', rightStats]] as const) {
    const s = stats as PixelStats;
    const rDiff = Math.abs(s.meanR - BACKGROUND_GREY_TARGET.r);
    const gDiff = Math.abs(s.meanG - BACKGROUND_GREY_TARGET.g);
    const bDiff = Math.abs(s.meanB - BACKGROUND_GREY_TARGET.b);
    if (rDiff > BACKGROUND_TOLERANCE || gDiff > BACKGROUND_TOLERANCE || bDiff > BACKGROUND_TOLERANCE) {
      issues.push(`${name} edge not neutral grey (R=${s.meanR.toFixed(0)},G=${s.meanG.toFixed(0)},B=${s.meanB.toFixed(0)})`);
    }
  }

  return {
    clean: issues.length === 0,
    note: issues.length > 0 ? issues.join('; ') : 'Background clean',
  };
}

interface PixelStats {
  meanR: number;
  meanG: number;
  meanB: number;
  stddev: number;
}

function computePixelStats(rawBuffer: Buffer): PixelStats {
  const pixelCount = rawBuffer.length / 3;
  let sumR = 0, sumG = 0, sumB = 0;

  for (let i = 0; i < rawBuffer.length; i += 3) {
    sumR += rawBuffer[i];
    sumG += rawBuffer[i + 1];
    sumB += rawBuffer[i + 2];
  }

  const meanR = sumR / pixelCount;
  const meanG = sumG / pixelCount;
  const meanB = sumB / pixelCount;

  // Compute luminance stddev for texture detection
  let sumSqDiff = 0;
  for (let i = 0; i < rawBuffer.length; i += 3) {
    const lum = rawBuffer[i] * 0.299 + rawBuffer[i + 1] * 0.587 + rawBuffer[i + 2] * 0.114;
    const meanLum = meanR * 0.299 + meanG * 0.587 + meanB * 0.114;
    sumSqDiff += (lum - meanLum) ** 2;
  }

  return {
    meanR,
    meanG,
    meanB,
    stddev: Math.sqrt(sumSqDiff / pixelCount),
  };
}

function checkFraming(
  width: number,
  height: number,
  shotType: string,
): { ok: boolean; note: string } {
  // M03/M04: 9:16 aspect ratio (full body)
  // M01/M02/M05: 3:4 aspect ratio (cropped/detail)
  const isFullBody = shotType === 'M03' || shotType === 'M04';
  const expectedRatio = isFullBody ? 9 / 16 : 3 / 4;
  const actualRatio = width / height;
  const ratioDiff = Math.abs(actualRatio - expectedRatio) / expectedRatio;

  if (ratioDiff > 0.05) {
    return { ok: false, note: `Wrong aspect ratio: ${actualRatio.toFixed(3)} (expected ~${expectedRatio.toFixed(3)})` };
  }

  return { ok: true, note: 'Framing OK' };
}

async function checkExposure(
  imageBuffer: Buffer,
  width: number,
  height: number,
): Promise<{ ok: boolean; note: string }> {
  // Sample center region (the garment area)
  const centerX = Math.floor(width * 0.25);
  const centerY = Math.floor(height * 0.25);
  const centerW = Math.floor(width * 0.5);
  const centerH = Math.floor(height * 0.5);

  const centerStrip = await sharp(imageBuffer)
    .extract({ left: centerX, top: centerY, width: centerW, height: centerH })
    .raw()
    .toBuffer();

  const stats = computePixelStats(centerStrip);
  const meanLum = stats.meanR * 0.299 + stats.meanG * 0.587 + stats.meanB * 0.114;

  if (meanLum < MIN_BRIGHTNESS) {
    return { ok: false, note: `Too dark (luminance=${meanLum.toFixed(0)}, min=${MIN_BRIGHTNESS})` };
  }
  if (meanLum > MAX_BRIGHTNESS) {
    return { ok: false, note: `Blown out (luminance=${meanLum.toFixed(0)}, max=${MAX_BRIGHTNESS})` };
  }

  return { ok: true, note: `Exposure OK (luminance=${meanLum.toFixed(0)})` };
}

// ════════════════════════════════════════════════════════════════════
// LAYER 2: Flat-vs-Generated Comparison (Gemini Flash Lite)
// ════════════════════════════════════════════════════════════════════

export async function runFlatComparisonQC(
  generatedImageBuffer: Buffer,
  flatImageBuffer: Buffer,
  shotType: string,
  garmentDescription: string,
  metadata: Record<string, string>,
): Promise<FlatComparisonQCResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[ShotQC] No GEMINI_API_KEY — skipping Layer 2 QC');
    return null;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${QC_MODEL}:generateContent?key=${apiKey}`;

  const isBack = shotType === 'M02' || shotType === 'M04' || shotType === 'M05';
  const viewLabel = isBack ? 'BACK' : 'FRONT';
  const floorDist = metadata.floorDistance || '';
  const waistHeight = metadata.waistHeight || '';

  const prompt = `You are a QC auditor for G-Star RAW e-commerce photography.

IMAGE 1 is the FLAT PRODUCT IMAGE (${viewLabel} view) — this is the GROUND TRUTH for color, seams, panels, pockets, and construction.
IMAGE 2 is the AI-GENERATED MODEL SHOT (${shotType}) — this is what you're evaluating.

GARMENT: ${garmentDescription}
WAIST HEIGHT: ${waistHeight || 'not specified'}
FLOOR DISTANCE: ${floorDist || 'not specified'}

Score these 6 dimensions (1-10 each, with a short note):

1. COLOR MATCH — Is the denim wash/color in the generated image matching the flat?
   Compare exact shade, wash intensity, indigo depth. Slightly off = 6-7. Wrong color = 1-4. Match = 8-10.

2. SEAM FIDELITY — Are the seam lines, panel construction, and stitching patterns matching the flat?
   Check: diagonal seams, horizontal knee seams, yoke seams, panel joints. Missing construction = 1-4. Partially there = 5-7. All seams match = 8-10.

3. POCKET ACCURACY — Do the pocket shapes, placement, and stitching arcs match the flat?
   Front: check front pocket shape, coin pocket, fly stitching. Back: check back pocket shape, stitching arcs, label zone. Wrong = 1-4. Close = 6-7. Match = 8-10.

4. SILHOUETTE MATCH — Does the overall width, leg shape, and fit match the flat?
   Check: leg width at thigh/knee/ankle, flare/taper/straight, overall garment shape. Wrong shape = 1-4. Close = 6-7. Match = 8-10.

5. LENGTH CORRECT — Does the hem position match the expected floor distance?
   ${floorDist === '4 - well above ankle' || floorDist === '4' ? 'EXPECTED: Cropped well above ankle — ankles/socks clearly visible.' : ''}
   ${floorDist === '3' ? 'EXPECTED: Above ankle — some ankle visible.' : ''}
   ${floorDist === '0 - touching' || floorDist === '0' ? 'EXPECTED: Floor-length — hems touch/nearly touch ground.' : ''}
   Wrong length = 1-4. Slightly off = 5-7. Correct = 8-10.

6. BACKGROUND CHECK — Is the background a clean, neutral studio backdrop?
   Must be uniform light grey with NO visible floor texture, NO wood grain, NO tiles, NO patterns, NO colored backgrounds. Clean = 9-10. Minor imperfection = 6-8. Visible floor/pattern = 1-5.

RESPOND IN EXACT JSON (no markdown, no backticks):
{"color_match":{"score":0,"note":""},"seam_fidelity":{"score":0,"note":""},"pocket_accuracy":{"score":0,"note":""},"silhouette_match":{"score":0,"note":""},"length_correct":{"score":0,"note":""},"background_check":{"score":0,"note":""},"weighted_score":0,"pass":false,"critical_issues":[],"summary":""}

weighted_score = (color_match + seam_fidelity + pocket_accuracy + silhouette_match + length_correct + background_check) / 6
pass = true if weighted_score >= 7.0 AND no dimension below 4`;

  try {
    // Downscale both images for cost efficiency
    const genSmall = await sharp(generatedImageBuffer)
      .resize(1024, 1024, { fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();

    const flatSmall = await sharp(flatImageBuffer)
      .resize(1024, 1024, { fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: flatSmall.toString('base64') } },
            { inlineData: { mimeType: 'image/jpeg', data: genSmall.toString('base64') } },
            { text: prompt },
          ],
        }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) {
      console.error(`[ShotQC] Gemini API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const result = await response.json();
    const textPart = result.candidates?.[0]?.content?.parts?.find((p: any) => p.text);
    if (!textPart?.text) {
      console.error('[ShotQC] No text in Gemini response');
      return null;
    }

    let jsonText = textPart.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonText);

    // Normalize the response
    const colorMatch = { score: parsed.color_match?.score || 0, note: parsed.color_match?.note || '' };
    const seamFidelity = { score: parsed.seam_fidelity?.score || 0, note: parsed.seam_fidelity?.note || '' };
    const pocketAccuracy = { score: parsed.pocket_accuracy?.score || 0, note: parsed.pocket_accuracy?.note || '' };
    const silhouetteMatch = { score: parsed.silhouette_match?.score || 0, note: parsed.silhouette_match?.note || '' };
    const lengthCorrect = { score: parsed.length_correct?.score || 0, note: parsed.length_correct?.note || '' };
    const backgroundCheck = { score: parsed.background_check?.score || 0, note: parsed.background_check?.note || '' };

    const scores = [colorMatch.score, seamFidelity.score, pocketAccuracy.score, silhouetteMatch.score, lengthCorrect.score, backgroundCheck.score];
    const weightedScore = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
    const anyBelowThreshold = scores.some(s => s < 4);
    const pass = weightedScore >= 7.0 && !anyBelowThreshold;

    return {
      colorMatch,
      seamFidelity,
      pocketAccuracy,
      silhouetteMatch,
      lengthCorrect,
      backgroundCheck,
      weightedScore,
      pass,
      criticalIssues: parsed.critical_issues || [],
      summary: parsed.summary || '',
    };
  } catch (err) {
    console.error('[ShotQC] Layer 2 QC failed:', err);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════
// Combined QC Runner
// ════════════════════════════════════════════════════════════════════

export async function runShotQC(params: {
  generatedImageBuffer: Buffer;
  flatImageBuffer: Buffer | null;
  shotType: string;
  garmentDescription: string;
  metadata: Record<string, string>;
}): Promise<ShotQCResult> {
  const { generatedImageBuffer, flatImageBuffer, shotType, garmentDescription, metadata } = params;

  // Layer 1: deterministic checks (always runs)
  const layer1 = await runDeterministicQC(generatedImageBuffer, shotType);
  console.log(`[ShotQC] Layer 1: background=${layer1.backgroundClean}, framing=${layer1.framingOk}, exposure=${layer1.exposureOk} → ${layer1.pass ? 'PASS' : 'FAIL'}`);

  // Layer 2: flat comparison (only if flat image available)
  let layer2: FlatComparisonQCResult | null = null;
  console.log(`[ShotQC] Layer 2 check: flatImageBuffer=${flatImageBuffer ? `${flatImageBuffer.length} bytes` : 'NULL'}, shotType=${shotType}`);
  if (flatImageBuffer) {
    layer2 = await runFlatComparisonQC(generatedImageBuffer, flatImageBuffer, shotType, garmentDescription, metadata);
    if (layer2) {
      console.log(`[ShotQC] Layer 2: color=${layer2.colorMatch.score}, seams=${layer2.seamFidelity.score}, pockets=${layer2.pocketAccuracy.score}, silhouette=${layer2.silhouetteMatch.score}, length=${layer2.lengthCorrect.score}, bg=${layer2.backgroundCheck.score} → ${layer2.weightedScore} → ${layer2.pass ? 'PASS' : 'FAIL'}`);
    } else {
      console.error(`[ShotQC] Layer 2: Gemini call returned null — check API key or response parsing`);
    }
  } else {
    console.log('[ShotQC] Layer 2: skipped (no flat image buffer passed)');
  }

  // Overall: fail if either layer fails
  const overallPass = layer1.pass && (layer2 === null || layer2.pass);
  const overallScore = layer2 ? layer2.weightedScore : (layer1.pass ? 7.0 : 3.0);

  return {
    layer1,
    layer2,
    overallPass,
    overallScore,
    timestamp: new Date().toISOString(),
  };
}
