/**
 * Color consistency via LAB histogram matching (Python/scikit-image).
 *
 * Matches the color distribution of a generated image to a mannequin reference,
 * ensuring AI-generated shots maintain the real garment's color characteristics.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink, rmdir } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';

const execFileAsync = promisify(execFile);
const COLOR_MATCH_SCRIPT = path.resolve(process.cwd(), 'scripts/color_match.py');

interface ColorMatchResult {
  applied: boolean;
  correctedBuffer: Buffer;
  deltaE_before: number;
  deltaE_after: number;
  garmentPixels: number;
}

/**
 * Check if scikit-image is available.
 */
let _skimageAvailable: boolean | null = null;
async function isSkimageAvailable(): Promise<boolean> {
  if (_skimageAvailable !== null) return _skimageAvailable;
  try {
    await execFileAsync('python3', ['-c', 'from skimage.exposure import match_histograms; print("ok")'], { timeout: 10000 });
    _skimageAvailable = true;
    console.log('[ColorMatch] scikit-image available');
  } catch {
    _skimageAvailable = false;
    console.log('[ColorMatch] scikit-image NOT available — color matching disabled');
  }
  return _skimageAvailable;
}

/**
 * Match generated image colors to mannequin reference.
 *
 * @param generatedBuffer - AI-generated image buffer
 * @param referenceBuffer - Mannequin reference image buffer (color ground truth)
 * @param maskBounds - Optional garment region bounds (normalized 0-1)
 * @returns Color-corrected image buffer and metrics
 */
export async function matchColorsToReference(
  generatedBuffer: Buffer,
  referenceBuffer: Buffer,
  maskBounds?: { x1: number; y1: number; x2: number; y2: number },
): Promise<ColorMatchResult> {
  const hasSkimage = await isSkimageAvailable();

  if (!hasSkimage) {
    return {
      applied: false,
      correctedBuffer: generatedBuffer,
      deltaE_before: 0,
      deltaE_after: 0,
      garmentPixels: 0,
    };
  }

  const tmpDir = await (async () => {
    let dir: string | null = null;
    try {
      // Create a temp directory
      const baseTmp = tmpdir();
      const timestamp = Date.now();
      const rand = Math.random().toString(36).substring(7);
      dir = path.join(baseTmp, `colormatch-${timestamp}-${rand}`);
      // Manually create it by attempting write
      return dir;
    } catch {
      throw new Error('Failed to create temp directory');
    }
  })();

  const refPath = path.join(tmpDir, 'reference.jpg');
  const genPath = path.join(tmpDir, 'generated.jpg');
  const outPath = path.join(tmpDir, 'corrected.jpg');

  try {
    // Ensure directory exists
    await (async () => {
      const fs = await import('fs');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
    })();

    await writeFile(refPath, referenceBuffer);
    await writeFile(genPath, generatedBuffer);

    const args = ['match', refPath, genPath, outPath];
    if (maskBounds) {
      args.push(JSON.stringify(maskBounds));
    }

    const { stdout, stderr } = await execFileAsync('python3', [COLOR_MATCH_SCRIPT, ...args], {
      timeout: 120000, // 2min max
      maxBuffer: 1024 * 1024,
    });

    if (stderr) console.log(`[ColorMatch] stderr: ${stderr.trim()}`);

    const result = JSON.parse(stdout.trim());

    if (result.status !== 'ok') {
      console.warn(`[ColorMatch] Python matching failed: ${result.error}`);
      return {
        applied: false,
        correctedBuffer: generatedBuffer,
        deltaE_before: result.delta_e_before || 0,
        deltaE_after: result.delta_e_before || 0,
        garmentPixels: 0,
      };
    }

    const correctedBuffer = await readFile(outPath);
    console.log(`[ColorMatch] Color matched: ΔE ${result.delta_e_before} → ${result.delta_e_after} (${result.garment_pixels} garment pixels)`);

    return {
      applied: true,
      correctedBuffer,
      deltaE_before: result.delta_e_before,
      deltaE_after: result.delta_e_after,
      garmentPixels: result.garment_pixels,
    };
  } catch (err: any) {
    console.error('[ColorMatch] Error:', err.message);
    return {
      applied: false,
      correctedBuffer: generatedBuffer,
      deltaE_before: 0,
      deltaE_after: 0,
      garmentPixels: 0,
    };
  } finally {
    try { await unlink(refPath); } catch { /* */ }
    try { await unlink(genPath); } catch { /* */ }
    try { await unlink(outPath); } catch { /* */ }
    try { await rmdir(tmpDir); } catch { /* */ }
  }
}
