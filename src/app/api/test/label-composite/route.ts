/**
 * POST /api/test/label-composite
 *
 * Interactive test endpoint for the label composite v2 pipeline.
 * Tests both Python (GrabCut + seamless clone) and fallback (Sharp) paths.
 *
 * Body: { mannequinBackUrl, generatedBackUrl }
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractLabel, compositeLabel } from '@/lib/label-composite';
import { downloadGarmentImage } from '@/lib/gcs';
import sharp from 'sharp';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { mannequinBackUrl, generatedBackUrl } = body;

  const steps: Array<{ step: string; status: string; detail?: string; elapsed?: number }> = [];
  const t0 = Date.now();

  // Check Python availability
  let hasPython = false;
  try {
    const { stdout } = await execFileAsync('python3', ['-c', 'import cv2; print(cv2.__version__)'], { timeout: 5000 });
    hasPython = true;
    steps.push({ step: '0. Python + OpenCV check', status: 'ok', detail: `OpenCV ${stdout.trim()}` });
  } catch {
    steps.push({ step: '0. Python + OpenCV check', status: 'missing', detail: 'Python/OpenCV not available — using Sharp fallback' });
  }

  // Step 1: Download mannequin back image
  let mannequinBuffer: Buffer | null = null;
  try {
    const start = Date.now();
    mannequinBuffer = await downloadGarmentImage(mannequinBackUrl);
    const meta = await sharp(mannequinBuffer).metadata();
    const orientation = (meta.width || 0) > (meta.height || 0) ? 'LANDSCAPE' : 'PORTRAIT';
    steps.push({ step: '1. Download mannequin back', status: 'ok', detail: `${meta.width}x${meta.height} ${orientation} (${(mannequinBuffer.length / 1024).toFixed(0)}KB)`, elapsed: Date.now() - start });
  } catch (err) {
    steps.push({ step: '1. Download mannequin back', status: 'error', detail: String(err) });
    return NextResponse.json({ steps, error: 'Failed to download mannequin image' });
  }

  // Step 2: Extract label (GrabCut segmentation or fallback)
  let labelCrop: Buffer | null = null;
  try {
    const start = Date.now();
    labelCrop = await extractLabel(mannequinBuffer!);
    if (labelCrop) {
      const labelMeta = await sharp(labelCrop).metadata();
      const hasAlpha = labelMeta.channels === 4;
      const stats = await sharp(labelCrop).stats();
      const meanBrightness = stats.channels.slice(0, 3).reduce((sum, ch) => sum + ch.mean, 0) / 3;
      steps.push({
        step: `2. Extract label (${hasPython ? 'GrabCut' : 'Sharp fallback'})`,
        status: 'ok',
        detail: `${labelMeta.width}x${labelMeta.height}px ${hasAlpha ? 'RGBA' : 'RGB'} (${(labelCrop.length / 1024).toFixed(0)}KB) brightness: ${meanBrightness.toFixed(0)}/255`,
        elapsed: Date.now() - start,
      });
    } else {
      steps.push({ step: '2. Extract label', status: 'not_found', detail: 'No label detected or QC rejected', elapsed: Date.now() - start });
    }
  } catch (err) {
    steps.push({ step: '2. Extract label', status: 'error', detail: String(err) });
  }

  // Step 3: Download generated image
  let generatedBuffer: Buffer | null = null;
  if (generatedBackUrl) {
    try {
      const start = Date.now();
      generatedBuffer = await downloadGarmentImage(generatedBackUrl);
      const meta = await sharp(generatedBuffer).metadata();
      steps.push({ step: '3. Download generated back shot', status: 'ok', detail: `${meta.width}x${meta.height} (${(generatedBuffer.length / 1024).toFixed(0)}KB)`, elapsed: Date.now() - start });
    } catch (err) {
      steps.push({ step: '3. Download generated back shot', status: 'error', detail: String(err) });
    }
  }

  // Step 4: Composite (perspective warp + seamless clone or fallback)
  let compositeBuffer: Buffer | null = null;
  if (generatedBuffer && labelCrop) {
    try {
      const start = Date.now();
      compositeBuffer = await compositeLabel(generatedBuffer, labelCrop);
      const isSame = compositeBuffer.length === generatedBuffer.length;
      steps.push({
        step: `4. Composite (${hasPython ? 'seamless clone' : 'Sharp overlay'})`,
        status: isSame ? 'unchanged' : 'ok',
        detail: isSame ? 'Label position not found — returned original' : `Composite complete (${(compositeBuffer.length / 1024).toFixed(0)}KB)`,
        elapsed: Date.now() - start,
      });
    } catch (err) {
      steps.push({ step: '4. Composite', status: 'error', detail: String(err) });
    }
  }

  // Build response
  const result: Record<string, unknown> = {
    steps,
    totalElapsed: Date.now() - t0,
    pipeline: hasPython ? 'opencv' : 'sharp_fallback',
  };

  if (labelCrop) {
    result.labelCropBase64 = `data:image/png;base64,${labelCrop.toString('base64')}`;
    const lm = await sharp(labelCrop).metadata();
    result.labelCropDims = `${lm.width}x${lm.height}`;
    result.labelHasAlpha = lm.channels === 4;
  }

  if (compositeBuffer && generatedBuffer && compositeBuffer.length !== generatedBuffer.length) {
    const preview = await sharp(compositeBuffer).resize(800).jpeg({ quality: 80 }).toBuffer();
    result.compositePreviewBase64 = `data:image/jpeg;base64,${preview.toString('base64')}`;
    const cm = await sharp(compositeBuffer).metadata();
    result.compositeDims = `${cm.width}x${cm.height}`;
  }

  return NextResponse.json(result);
}

export async function GET() {
  return NextResponse.json({
    usage: 'POST with { mannequinBackUrl, generatedBackUrl }',
    pipeline: 'v2 — Python/OpenCV (GrabCut + seamless clone) with Sharp fallback',
  });
}
