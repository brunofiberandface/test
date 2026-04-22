/**
 * Label Hybrid — three-stage deterministic leather-label composite.
 *
 * Unlike the old label-composite.ts (which extracted a real label from a mannequin
 * photo and warped it), this pipeline composites the label byte-identical from:
 *   1. A plain leather "material tile" rendered once by Gemini (no text).
 *   2. A line-art template PNG (the L2936-8.0 artwork).
 *   3. A Sobel-based deboss shader in Python/OpenCV.
 *
 * Gemini never sees or generates the label text, so letters cannot drift.
 * Per-colorway variation (base colour + emboss strength) is configured per
 * wardrobe document.
 *
 * CORNERS ARE SUPPLIED BY THE CALLER. The old auto-detection (Gemini
 * 2.5 Flash Lite) produced unreliable placements in production, so corners
 * are now picked manually in the shot detail UI and passed in via the
 * apply-label API route.
 *
 * Deployment requirements:
 *   - Dockerfile must install python3 + opencv-python-headless + numpy
 *   - scripts/label_hybrid.py must ship in the image (.dockerignore / .gcloudignore)
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

const PYTHON_SCRIPT = path.resolve(process.cwd(), 'scripts/label_hybrid.py');
const SUBPROCESS_TIMEOUT_MS = 60_000;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface LabelHybridConfig {
  /** Must be true for the pipeline to run on this wardrobe item. */
  enabled: boolean;
  /** Template identifier (currently only 'L2936-8.0'). */
  templateId: string;
  /** Public URL of the template PNG (artwork / height map). */
  templateUrl: string;
  /** Public URL of the plain-leather material tile (no text). */
  materialTileUrl: string;
  /** Leather body colour as hex, e.g. '#987545' (tan caramel). */
  baseColor: string;
  /** Optional stitch thread colour (reserved for future use). */
  stitchColor?: string;
  /** 0..1 — how strongly the shader debosses text. Tan: 0.85, black: 0.35. */
  embossStrength: number;
}

/**
 * Four corners in absolute PIXEL coordinates of the target image.
 * Order: tl, tr, br, bl (clockwise from top-left).
 *
 * Optional midpoints (tm/rm/bm/lm) bend the corresponding edge through that
 * point — used to curve the label sides into a V-shape so small leather
 * protrusions at the edges can be tucked out of view. When all four are
 * absent, the composite runs the classic 4-point pipeline, byte-identical
 * to the pre-midpoint path.
 */
export interface LabelCorners {
  tl: [number, number];
  tr: [number, number];
  br: [number, number];
  bl: [number, number];
  tm?: [number, number];
  rm?: [number, number];
  bm?: [number, number];
  lm?: [number, number];
}

// ─── Python subprocess helpers ─────────────────────────────────────────────

let _pythonAvailable: boolean | null = null;

export async function isPythonAvailable(): Promise<boolean> {
  if (_pythonAvailable !== null) return _pythonAvailable;
  try {
    await execFileAsync(
      'python3',
      ['-c', 'import cv2, numpy; print(cv2.__version__)'],
      { timeout: 5000 },
    );
    _pythonAvailable = true;
    console.log('[LabelHybrid] Python + OpenCV available');
  } catch {
    _pythonAvailable = false;
    console.log('[LabelHybrid] Python + OpenCV NOT available — hybrid pipeline disabled');
  }
  return _pythonAvailable;
}

async function runPython(argsJsonPath: string): Promise<Record<string, unknown>> {
  const { stdout, stderr } = await execFileAsync(
    'python3',
    [PYTHON_SCRIPT, argsJsonPath],
    {
      timeout: SUBPROCESS_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (stderr) {
    console.log(`[LabelHybrid] python stderr: ${stderr.trim().slice(-500)}`);
  }
  try {
    return JSON.parse(stdout.trim());
  } catch {
    throw new Error(`failed to parse python stdout: ${stdout.slice(0, 200)}`);
  }
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'label-hybrid-'));
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
}

// ─── Corner validation ────────────────────────────────────────────────────

/**
 * Sanity-check manual corners before handing off to the Python shader.
 * Throws on clearly broken input (outside image, degenerate quad).
 */
export function validateCorners(
  corners: LabelCorners,
  imgWidth: number,
  imgHeight: number,
): void {
  const points: Array<[number, number]> = [
    corners.tl,
    corners.tr,
    corners.br,
    corners.bl,
  ];
  if (corners.tm) points.push(corners.tm);
  if (corners.rm) points.push(corners.rm);
  if (corners.bm) points.push(corners.bm);
  if (corners.lm) points.push(corners.lm);
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`corner has non-finite coordinate: (${x},${y})`);
    }
    if (x < 0 || y < 0 || x > imgWidth || y > imgHeight) {
      throw new Error(
        `corner (${x},${y}) outside image bounds ${imgWidth}x${imgHeight}`,
      );
    }
  }
  const width = Math.max(
    Math.abs(corners.tr[0] - corners.tl[0]),
    Math.abs(corners.br[0] - corners.bl[0]),
  );
  const height = Math.max(
    Math.abs(corners.bl[1] - corners.tl[1]),
    Math.abs(corners.br[1] - corners.tr[1]),
  );
  if (width < 10 || height < 6) {
    throw new Error(`quad too small: ${width}x${height}`);
  }
}

// ─── Woven pocket label ──────────────────────────────────────────────────

/** Simple 4-corner quad for the pocket label (no midpoints needed). */
export interface PocketLabelCorners {
  tl: [number, number];
  tr: [number, number];
  br: [number, number];
  bl: [number, number];
}

/**
 * Composite a pre-rendered woven label (e.g. Originals pocket patch) onto
 * a generated image. Unlike the leather pipeline this is a simple perspective
 * warp + blend — no material tile, no emboss shader, no tint.
 *
 * The woven label PNG ships in `public/` and is referenced by URL.
 */
export async function applyWovenLabel(
  imageBuffer: Buffer,
  corners: PocketLabelCorners,
  wovenLabelUrl: string,
): Promise<Buffer> {
  if (!(await isPythonAvailable())) {
    throw new Error('python + OpenCV not available on this runtime');
  }

  const sharp = (await import('sharp')).default;
  const meta = await sharp(imageBuffer).metadata();
  const imgWidth = meta.width || 0;
  const imgHeight = meta.height || 0;
  if (!imgWidth || !imgHeight) {
    throw new Error('could not read target image dimensions');
  }
  validateCorners(corners, imgWidth, imgHeight);

  const tempDir = await makeTempDir();
  try {
    const targetPath = path.join(tempDir, 'target.png');
    const labelPath = path.join(tempDir, 'woven_label.png');
    const outputPath = path.join(tempDir, 'out.png');
    const argsPath = path.join(tempDir, 'args.json');

    await writeFile(targetPath, imageBuffer);

    // The woven label may be a local file (public/) or a URL
    if (wovenLabelUrl.startsWith('http')) {
      await downloadToFile(wovenLabelUrl, labelPath);
    } else {
      // Local path (e.g. from public/ dir)
      const localPath = path.resolve(process.cwd(), 'public', wovenLabelUrl);
      const fs = await import('fs/promises');
      await fs.copyFile(localPath, labelPath);
    }

    const args = {
      mode: 'woven',
      target_image: targetPath,
      woven_label: labelPath,
      quad: [
        { x: corners.tl[0], y: corners.tl[1] },
        { x: corners.tr[0], y: corners.tr[1] },
        { x: corners.br[0], y: corners.br[1] },
        { x: corners.bl[0], y: corners.bl[1] },
      ],
      output: outputPath,
    };
    await writeFile(argsPath, JSON.stringify(args));

    const result = await runPython(argsPath);
    if (!result.ok) {
      throw new Error(`python woven shader failed: ${JSON.stringify(result)}`);
    }

    const composited = await readFile(outputPath);
    console.log(
      `[LabelHybrid] woven composited ${composited.length} bytes (was ${imageBuffer.length})`,
    );
    return composited;
  } finally {
    rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────

/**
 * Apply the hybrid leather-label composite to a generated image.
 *
 * @param imageBuffer Target image (PNG/JPEG) as a Buffer.
 * @param corners     Four corners in absolute pixel coordinates.
 * @param config      Per-wardrobe-item label configuration from Firestore.
 * @returns           Composited image as a Buffer.
 *
 * Throws on hard failures (no python, bad corners, subprocess crash). The
 * caller is responsible for deciding what to do on failure — unlike the
 * old auto-pipeline this no longer swallows errors silently.
 */
export async function applyHybridLabel(
  imageBuffer: Buffer,
  corners: LabelCorners,
  config: LabelHybridConfig,
): Promise<Buffer> {
  if (!config?.enabled) {
    throw new Error('labelConfig.enabled is false');
  }

  if (!(await isPythonAvailable())) {
    throw new Error('python + OpenCV not available on this runtime');
  }

  // Measure image dimensions, then validate corners against them
  const sharp = (await import('sharp')).default;
  const meta = await sharp(imageBuffer).metadata();
  const imgWidth = meta.width || 0;
  const imgHeight = meta.height || 0;
  if (!imgWidth || !imgHeight) {
    throw new Error('could not read target image dimensions');
  }
  validateCorners(corners, imgWidth, imgHeight);

  const tempDir = await makeTempDir();
  try {
    const targetPath = path.join(tempDir, 'target.png');
    const materialPath = path.join(tempDir, 'material.png');
    const templatePath = path.join(tempDir, 'template.png');
    const outputPath = path.join(tempDir, 'out.png');
    const argsPath = path.join(tempDir, 'args.json');

    await writeFile(targetPath, imageBuffer);
    await Promise.all([
      downloadToFile(config.materialTileUrl, materialPath),
      downloadToFile(config.templateUrl, templatePath),
    ]);

    const hasAnyMid = !!(
      corners.tm ||
      corners.rm ||
      corners.bm ||
      corners.lm
    );
    const midpoints: Record<string, { x: number; y: number } | null> = {};
    if (hasAnyMid) {
      midpoints.tm = corners.tm
        ? { x: corners.tm[0], y: corners.tm[1] }
        : null;
      midpoints.rm = corners.rm
        ? { x: corners.rm[0], y: corners.rm[1] }
        : null;
      midpoints.bm = corners.bm
        ? { x: corners.bm[0], y: corners.bm[1] }
        : null;
      midpoints.lm = corners.lm
        ? { x: corners.lm[0], y: corners.lm[1] }
        : null;
    }
    const args: Record<string, unknown> = {
      target_image: targetPath,
      material_tile: materialPath,
      template: templatePath,
      quad: [
        { x: corners.tl[0], y: corners.tl[1] },
        { x: corners.tr[0], y: corners.tr[1] },
        { x: corners.br[0], y: corners.br[1] },
        { x: corners.bl[0], y: corners.bl[1] },
      ],
      base_color: config.baseColor,
      stitch_color: config.stitchColor || '',
      emboss_strength: config.embossStrength,
      output: outputPath,
    };
    if (hasAnyMid) {
      args.midpoints = midpoints;
    }
    await writeFile(argsPath, JSON.stringify(args));

    const result = await runPython(argsPath);
    if (!result.ok) {
      throw new Error(`python shader reported failure: ${JSON.stringify(result)}`);
    }

    const composited = await readFile(outputPath);
    console.log(
      `[LabelHybrid] composited ${composited.length} bytes (was ${imageBuffer.length})`,
    );
    return composited;
  } finally {
    rm(tempDir, { recursive: true, force: true }).catch(() => {
      // best-effort cleanup
    });
  }
}
