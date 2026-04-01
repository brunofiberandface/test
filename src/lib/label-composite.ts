/**
 * Label Composite v2 — Photoshop-quality label replacement using Python + OpenCV.
 *
 * Replaces the old Sharp bbox-crop+paste approach with proper computer vision:
 * 1. GrabCut segmentation (Python/OpenCV) — isolates label with alpha transparency
 * 2. Gemini 4-corner detection — finds label plane in generated image
 * 3. Perspective warp + Poisson seamless clone (Python/OpenCV) — natural blending
 *
 * Falls back to old Sharp approach if Python/OpenCV is unavailable.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

const BBOX_MODEL = 'gemini-2.5-flash-lite';
const PYTHON_SCRIPT = path.resolve(process.cwd(), 'scripts/label_composite.py');

interface LabelCorners {
  tl: [number, number];
  tr: [number, number];
  br: [number, number];
  bl: [number, number];
}

// ─── PYTHON SUBPROCESS HELPERS ─────────────────────────────────────────────

/**
 * Check if Python + OpenCV are available on this system.
 */
let _pythonAvailable: boolean | null = null;
async function isPythonAvailable(): Promise<boolean> {
  if (_pythonAvailable !== null) return _pythonAvailable;
  try {
    await execFileAsync('python3', ['-c', 'import cv2; print(cv2.__version__)'], { timeout: 5000 });
    _pythonAvailable = true;
    console.log('[LabelCV] Python + OpenCV available');
  } catch {
    _pythonAvailable = false;
    console.log('[LabelCV] Python + OpenCV NOT available — will use fallback');
  }
  return _pythonAvailable;
}

/**
 * Run the Python label composite script with given arguments.
 * Returns parsed JSON result from stdout.
 */
async function runPython(args: string[]): Promise<Record<string, unknown>> {
  try {
    const { stdout, stderr } = await execFileAsync('python3', [PYTHON_SCRIPT, ...args], {
      timeout: 60000, // 60s max
      maxBuffer: 1024 * 1024, // 1MB stdout
    });
    if (stderr) console.log(`[LabelCV] Python stderr: ${stderr.trim()}`);
    return JSON.parse(stdout.trim());
  } catch (err: any) {
    console.error(`[LabelCV] Python execution failed:`, err.message);
    if (err.stderr) console.error(`[LabelCV] stderr: ${err.stderr}`);
    return { status: 'failed', error: err.message };
  }
}

/**
 * Create a temp directory for pipeline files.
 */
async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'label-'));
}

// ─── GEMINI 4-CORNER DETECTION ─────────────────────────────────────────────

/**
 * Detect 4 corners of the label in a generated image using Gemini vision.
 * Returns corners in [TL, TR, BR, BL] order as pixel coordinates.
 * This is more accurate than OpenCV edge detection on AI-generated images.
 */
async function detectLabelCorners(
  imageBuffer: Buffer,
  imgWidth: number,
  imgHeight: number,
  apiKey: string,
): Promise<LabelCorners | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${BBOX_MODEL}:generateContent?key=${apiKey}`;

  const prompt = `Look at this image of a person wearing jeans (back view). Find the leather patch label on the back waistband — it says "G-STAR" or similar branding.

I need the FOUR CORNERS of the label patch (not just a bounding box) so I can perspective-warp a replacement label onto it.

Return the 4 corner points using NORMALIZED coordinates on a 0-1000 scale (where 0,0 is top-left of the image and 1000,1000 is bottom-right of the image). These are PROPORTIONAL coordinates, not pixel coordinates. For example, the exact center of the image = [500, 500]. A point at 25% from the left and 30% from the top = [250, 300].

RESPOND IN EXACT JSON (no markdown, no backticks):
{"found":true,"tl":[x,y],"tr":[x,y],"br":[x,y],"bl":[x,y]}

tl = top-left corner, tr = top-right corner, br = bottom-right corner, bl = bottom-left corner.

If no leather label is visible, respond:
{"found":false,"tl":[0,0],"tr":[0,0],"br":[0,0],"bl":[0,0]}`;

  try {
    // Downscale for detection
    const smallBuf = await sharp(imageBuffer).resize(1200, 1200, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: smallBuf.toString('base64') } },
            { text: prompt },
          ],
        }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) {
      console.error(`[LabelCV] Corners API error: ${response.status}`);
      return null;
    }

    const result = await response.json();
    const textPart = result.candidates?.[0]?.content?.parts?.find((p: any) => p.text);
    if (!textPart?.text) return null;

    let jsonText = textPart.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonText);
    if (!parsed.found) return null;

    // Detect if Gemini returned pixel coords instead of 0-1000 normalized
    const allCoords = [...parsed.tl, ...parsed.tr, ...parsed.br, ...parsed.bl];
    const maxCoord = Math.max(...allCoords);

    // If max coord > 1000, these are pixel coords from the 1200x1200 detection image
    // Convert to 0-1000 normalized first
    const detectionSize = 1200; // matches the resize above
    if (maxCoord > 1000) {
      console.log(`[LabelCV] Detected pixel coords (max=${maxCoord}) — converting to normalized`);
      const normalize = (pt: number[]): number[] => [
        Math.round((pt[0] / detectionSize) * 1000),
        Math.round((pt[1] / detectionSize) * 1000),
      ];
      parsed.tl = normalize(parsed.tl);
      parsed.tr = normalize(parsed.tr);
      parsed.br = normalize(parsed.br);
      parsed.bl = normalize(parsed.bl);
    }

    // Convert from 0-1000 normalized to pixel coordinates
    const toPixel = (pt: number[], w: number, h: number): [number, number] => [
      Math.round((pt[0] / 1000) * w),
      Math.round((pt[1] / 1000) * h),
    ];

    const corners: LabelCorners = {
      tl: toPixel(parsed.tl, imgWidth, imgHeight),
      tr: toPixel(parsed.tr, imgWidth, imgHeight),
      br: toPixel(parsed.br, imgWidth, imgHeight),
      bl: toPixel(parsed.bl, imgWidth, imgHeight),
    };

    // Validate: corners should form a reasonable quadrilateral
    const width = Math.abs(corners.tr[0] - corners.tl[0]);
    const height = Math.abs(corners.bl[1] - corners.tl[1]);
    if (width < 15 || height < 10) {
      console.log(`[LabelCV] Corners too small (${width}x${height}) — skipping`);
      return null;
    }

    // Check for reasonable aspect ratio (labels are wider than tall, typically 2:1 to 5:1)
    const aspectRatio = width / Math.max(1, height);
    if (aspectRatio < 0.5 || aspectRatio > 8) {
      console.log(`[LabelCV] Corners aspect ratio unreasonable (${aspectRatio.toFixed(1)}) — skipping`);
      return null;
    }

    // Check that corners are roughly in the expected waistband area (top 15-45% of image)
    const avgY = (corners.tl[1] + corners.tr[1] + corners.br[1] + corners.bl[1]) / 4;
    const yFraction = avgY / imgHeight;
    if (yFraction < 0.08 || yFraction > 0.55) {
      console.log(`[LabelCV] Label position unlikely (y=${(yFraction * 100).toFixed(0)}% — expected 8-55%) — skipping`);
      return null;
    }

    console.log(`[LabelCV] 4 corners detected: TL(${corners.tl}) TR(${corners.tr}) BR(${corners.br}) BL(${corners.bl})`);
    return corners;
  } catch (err) {
    console.error('[LabelCV] Corner detection failed:', err);
    return null;
  }
}

// ─── PUBLIC API ────────────────────────────────────────────────────────────

/**
 * Extract the leather label from a flat back image or fit model back-view image.
 *
 * Uses Python + OpenCV GrabCut for pixel-perfect segmentation with alpha transparency.
 * Falls back to Gemini bbox + Sharp crop if Python unavailable.
 *
 * @returns PNG buffer (RGBA with transparent background) or null
 */
export async function extractLabel(mannequinBackBuffer: Buffer): Promise<Buffer | null> {
  const hasPython = await isPythonAvailable();

  if (hasPython) {
    return extractLabelPython(mannequinBackBuffer);
  } else {
    return extractLabelFallback(mannequinBackBuffer);
  }
}

/**
 * Composite the real label onto a generated image.
 *
 * Uses Python + OpenCV for perspective warp + Poisson seamless clone.
 * Gemini provides 4-corner detection for accurate perspective mapping.
 * Falls back to Sharp overlay if Python unavailable.
 */
export async function compositeLabel(
  generatedBuffer: Buffer,
  labelBuffer: Buffer,
): Promise<Buffer> {
  const hasPython = await isPythonAvailable();

  if (hasPython) {
    return compositeLabelPython(generatedBuffer, labelBuffer);
  } else {
    return compositeLabelFallback(generatedBuffer, labelBuffer);
  }
}

// ─── PYTHON PIPELINE (PRIMARY) ─────────────────────────────────────────────

async function extractLabelPython(mannequinBackBuffer: Buffer): Promise<Buffer | null> {
  const tmpDir = await makeTempDir();
  const inputPath = path.join(tmpDir, 'mannequin.jpg');
  const outputPath = path.join(tmpDir, 'label.png');

  try {
    await writeFile(inputPath, mannequinBackBuffer);

    const result = await runPython(['extract', inputPath, outputPath]);

    if (result.status !== 'ok') {
      console.warn(`[LabelCV] Python extraction failed: ${result.error}`);
      // Try fallback
      return extractLabelFallback(mannequinBackBuffer);
    }

    const labelBuffer = await readFile(outputPath);
    console.log(`[LabelCV] Label extracted via GrabCut: ${result.width}x${result.height}px, ${result.opacity_pct}% opaque`);

    // QC: verify with Gemini that this is actually a label
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      const qc = await qcLabelCrop(labelBuffer, apiKey);
      if (!qc.valid) {
        console.warn(`[LabelCV] QC rejected Python crop: ${qc.reason}`);
        return null;
      }
      return qc.correctedBuffer;
    }

    return labelBuffer;
  } catch (err) {
    console.error('[LabelCV] Python extract error:', err);
    return extractLabelFallback(mannequinBackBuffer);
  } finally {
    // Cleanup temp files
    try { await unlink(inputPath); } catch { /* */ }
    try { await unlink(outputPath); } catch { /* */ }
    try { const { rmdir } = await import('fs/promises'); await rmdir(tmpDir); } catch { /* */ }
  }
}

async function compositeLabelPython(
  generatedBuffer: Buffer,
  labelBuffer: Buffer,
): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY;

  // Step 1: Detect 4 corners via Gemini (better than OpenCV for AI-generated images)
  const meta = await sharp(generatedBuffer).metadata();
  const imgW = meta.width || 1;
  const imgH = meta.height || 1;

  let cornersArg: string | undefined;
  if (apiKey) {
    const corners = await detectLabelCorners(generatedBuffer, imgW, imgH, apiKey);
    if (corners) {
      cornersArg = JSON.stringify([
        corners.tl, corners.tr, corners.br, corners.bl,
      ]);
    } else {
      console.log('[LabelCV] No corners detected — Python will auto-detect position');
    }
  }

  // Step 2: Run Python composite (perspective warp + seamless clone)
  const tmpDir = await makeTempDir();
  const targetPath = path.join(tmpDir, 'generated.jpg');
  const labelPath = path.join(tmpDir, 'label.png');
  const outputPath = path.join(tmpDir, 'composite.jpg');

  try {
    await writeFile(targetPath, generatedBuffer);
    await writeFile(labelPath, labelBuffer);

    const args = ['composite', targetPath, labelPath, outputPath];
    if (cornersArg) args.push(cornersArg);

    const result = await runPython(args);

    if (result.status !== 'ok') {
      console.warn(`[LabelCV] Python composite failed: ${result.error} — returning original`);
      return generatedBuffer;
    }

    const compositeBuffer = await readFile(outputPath);
    console.log(`[LabelCV] Composite via ${result.method}: center=${JSON.stringify(result.label_center)}, mask=${result.mask_pixels}px`);
    return compositeBuffer;
  } catch (err) {
    console.error('[LabelCV] Python composite error:', err);
    return generatedBuffer;
  } finally {
    try { await unlink(targetPath); } catch { /* */ }
    try { await unlink(labelPath); } catch { /* */ }
    try { await unlink(outputPath); } catch { /* */ }
    try { const { rmdir } = await import('fs/promises'); await rmdir(tmpDir); } catch { /* */ }
  }
}

// ─── FALLBACK (Sharp + Gemini bbox — old approach) ─────────────────────────

async function extractLabelFallback(mannequinBackBuffer: Buffer): Promise<Buffer | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const metaIn = await sharp(mannequinBackBuffer).metadata();
    let imgW = metaIn.width || 1;
    let imgH = metaIn.height || 1;
    let workBuffer = mannequinBackBuffer;

    // Handle landscape
    if (imgW > imgH) {
      console.log(`[LabelCV-fallback] Landscape (${imgW}x${imgH}) — rotating 270°`);
      workBuffer = await sharp(mannequinBackBuffer).rotate(270).toBuffer();
      const rm = await sharp(workBuffer).metadata();
      imgW = rm.width || 1;
      imgH = rm.height || 1;
    }

    // Downscale for detection
    const scale = Math.min(1, 2000 / Math.max(imgW, imgH));
    let detectBuf = workBuffer;
    if (scale < 1) {
      detectBuf = await sharp(workBuffer)
        .resize(Math.round(imgW * scale), Math.round(imgH * scale))
        .jpeg({ quality: 85 }).toBuffer();
    }

    const bbox = await detectLabelBbox(detectBuf, imgW, imgH, apiKey);
    if (!bbox) return null;

    const lW = bbox.x2 - bbox.x1;
    const lH = bbox.y2 - bbox.y1;
    const pad = Math.round(Math.max(lW, lH) * 0.15);

    const crop = await sharp(workBuffer)
      .extract({
        left: Math.max(0, bbox.x1 - pad),
        top: Math.max(0, bbox.y1 - pad),
        width: Math.min(imgW - Math.max(0, bbox.x1 - pad), lW + pad * 2),
        height: Math.min(imgH - Math.max(0, bbox.y1 - pad), lH + pad * 2),
      })
      .png().toBuffer();

    // Blank check
    const stats = await sharp(crop).stats();
    const brightness = stats.channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / 3;
    if (brightness > 220) {
      console.warn('[LabelCV-fallback] Blank crop — skipping');
      return null;
    }

    // QC
    const qc = await qcLabelCrop(crop, apiKey);
    if (!qc.valid) return null;
    return qc.correctedBuffer;
  } catch (err) {
    console.error('[LabelCV-fallback] Extract failed:', err);
    return null;
  }
}

async function compositeLabelFallback(
  generatedBuffer: Buffer,
  labelBuffer: Buffer,
): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return generatedBuffer;

  try {
    const meta = await sharp(generatedBuffer).metadata();
    const imgW = meta.width || 1;
    const imgH = meta.height || 1;

    const bbox = await detectLabelBbox(generatedBuffer, imgW, imgH, apiKey);
    if (!bbox) return generatedBuffer;

    const w = bbox.x2 - bbox.x1;
    const h = bbox.y2 - bbox.y1;
    if (w < 20 || h < 10) return generatedBuffer;

    const resized = await sharp(labelBuffer).resize(w, h, { fit: 'fill' }).png().toBuffer();
    return sharp(generatedBuffer)
      .composite([{ input: resized, left: bbox.x1, top: bbox.y1 }])
      .jpeg({ quality: 95 }).toBuffer();
  } catch {
    return generatedBuffer;
  }
}

// ─── SHARED HELPERS ────────────────────────────────────────────────────────

async function qcLabelCrop(
  cropBuffer: Buffer,
  apiKey: string,
): Promise<{ valid: boolean; correctedBuffer: Buffer; reason: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${BBOX_MODEL}:generateContent?key=${apiKey}`;

  const prompt = `Look at this image closely. Answer these questions:

1. Is this a leather/fabric patch label from the back waistband of jeans? It should show text like "G-STAR", "RAW", "ORIGINALS", or "DENIM" embossed on a dark leather patch.
2. Is the text UPSIDE DOWN or ROTATED? Check if you need to flip or rotate the image to read the text normally (left-to-right, top-to-bottom).

RESPOND IN EXACT JSON (no markdown, no backticks):
{"isLabel":true,"textOrientation":"normal|upside_down|rotated_90|rotated_270","confidence":"high|medium|low"}

If this is NOT a leather label patch at all:
{"isLabel":false,"textOrientation":"none","confidence":"high"}`;

  try {
    const smallCrop = await sharp(cropBuffer).resize(400, 400, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: smallCrop.toString('base64') } },
            { text: prompt },
          ],
        }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) {
      return { valid: true, correctedBuffer: cropBuffer, reason: 'QC API failed — passing through' };
    }

    const result = await response.json();
    const textPart = result.candidates?.[0]?.content?.parts?.find((p: any) => p.text);
    if (!textPart?.text) {
      return { valid: true, correctedBuffer: cropBuffer, reason: 'QC returned no text — passing through' };
    }

    let jsonText = textPart.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    }

    const qc = JSON.parse(jsonText);
    console.log(`[LabelCV] QC: isLabel=${qc.isLabel}, orientation=${qc.textOrientation}, confidence=${qc.confidence}`);

    if (!qc.isLabel) {
      return { valid: false, correctedBuffer: cropBuffer, reason: `Not a label (${qc.confidence})` };
    }

    let corrected = cropBuffer;
    if (qc.textOrientation === 'upside_down') {
      corrected = await sharp(cropBuffer).rotate(180).toBuffer();
    } else if (qc.textOrientation === 'rotated_90') {
      corrected = await sharp(cropBuffer).rotate(270).toBuffer();
    } else if (qc.textOrientation === 'rotated_270') {
      corrected = await sharp(cropBuffer).rotate(90).toBuffer();
    }

    return { valid: true, correctedBuffer: corrected, reason: `OK (${qc.textOrientation})` };
  } catch (err) {
    console.error('[LabelCV] QC failed:', err);
    return { valid: true, correctedBuffer: cropBuffer, reason: 'QC exception — passing through' };
  }
}

async function detectLabelBbox(
  imageBuffer: Buffer,
  imgWidth: number,
  imgHeight: number,
  apiKey: string,
): Promise<{ x1: number; y1: number; x2: number; y2: number } | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${BBOX_MODEL}:generateContent?key=${apiKey}`;

  const prompt = `Look at this image of jeans/pants. Find the leather patch label on the back waistband — it says "G-STAR" or "G-STAR RAW" or "G-STAR ORIGINALS".

Return the bounding box using NORMALIZED coordinates on a 0-1000 scale.

RESPOND IN EXACT JSON (no markdown, no backticks):
{"found":true,"x1":0,"y1":0,"x2":0,"y2":0}

If no leather label is visible:
{"found":false,"x1":0,"y1":0,"x2":0,"y2":0}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: imageBuffer.toString('base64') } },
            { text: prompt },
          ],
        }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) return null;

    const result = await response.json();
    const textPart = result.candidates?.[0]?.content?.parts?.find((p: any) => p.text);
    if (!textPart?.text) return null;

    let jsonText = textPart.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonText);
    if (!parsed.found) return null;

    const raw = [parsed.x1, parsed.y1, parsed.x2, parsed.y2];
    const isNorm = Math.max(...raw) <= 1000;

    const bbox = isNorm ? {
      x1: Math.max(0, Math.round((raw[0] / 1000) * imgWidth)),
      y1: Math.max(0, Math.round((raw[1] / 1000) * imgHeight)),
      x2: Math.min(imgWidth, Math.round((raw[2] / 1000) * imgWidth)),
      y2: Math.min(imgHeight, Math.round((raw[3] / 1000) * imgHeight)),
    } : {
      x1: Math.max(0, Math.round(raw[0])),
      y1: Math.max(0, Math.round(raw[1])),
      x2: Math.min(imgWidth, Math.round(raw[2])),
      y2: Math.min(imgHeight, Math.round(raw[3])),
    };

    if (bbox.x2 <= bbox.x1 || bbox.y2 <= bbox.y1) return null;
    return bbox;
  } catch {
    return null;
  }
}
