/**
 * GET /api/label/preview?style=XXX&colorway=YYY&w=512&h=340
 *     or
 * GET /api/label/preview?shot=<shotId>&w=512&h=340
 *
 * Returns a PNG of an upright leather label (RGBA, rendered by the same
 * shader that runs the final composite) that the label-picker UI can overlay
 * on a shot and CSS-warp in real-time via matrix3d().
 *
 * Flow:
 *   1. Resolve three-tier render config for (styleCode, colorwayCode)
 *   2. Check cache — if HIT, stream the cached PNG
 *   3. On MISS, download template + material-tile, spawn label_hybrid.py in
 *      preview mode, cache the resulting PNG, stream it
 *
 * The cache key folds in baseColor + embossStrength + width+height so it
 * invalidates automatically when a colorway is edited.
 *
 * Why this exists:
 *   The label picker needs a real preview of how the leather label looks
 *   (grain, deboss, colour) so the user can stretch/squeeze it in place like
 *   Photoshop free-transform. Running the full Python shader on every drag
 *   would be unusable — caching per (style, colorway, size, config) means
 *   one subprocess spawn per colorway, then instant serving.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdtemp, mkdir, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  resolveLabelRenderConfig,
  shotsCol,
  getJob,
  getWardrobeItem,
} from '@/lib/firestore';
import { resolveAssetUrl } from '@/lib/label-render';
import { styleAndColorwayOf } from '@/lib/design-number';

const execFileAsync = promisify(execFile);
const PYTHON_SCRIPT = path.resolve(process.cwd(), 'scripts/label_hybrid.py');
const CACHE_DIR = path.join(tmpdir(), 'label-preview-cache');
const SUBPROCESS_TIMEOUT_MS = 30_000;

async function ensureCacheDir(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
}

function cacheKey(parts: {
  styleCode: string;
  colorwayCode: string;
  width: number;
  height: number;
  baseColor: string;
  embossStrength: number;
  templateId: string;
  materialTileUrl: string;
}): string {
  const raw = JSON.stringify(parts);
  return createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed ${url}: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    let styleCode = sp.get('style');
    let colorwayCode = sp.get('colorway');
    const shotId = sp.get('shot');
    const width = Math.max(64, Math.min(1024, parseInt(sp.get('w') || '512', 10) || 512));
    const height = Math.max(48, Math.min(1024, parseInt(sp.get('h') || '340', 10) || 340));

    // Resolve style/colorway via shot → job → focus wardrobe item, if asked.
    // The picker usually only knows the shot ID, so this saves it an extra
    // round-trip.
    if (shotId && (!styleCode || !colorwayCode)) {
      const shotDoc = await shotsCol.doc(shotId).get();
      if (!shotDoc.exists) {
        return NextResponse.json({ error: 'shot not found' }, { status: 404 });
      }
      const shot = shotDoc.data()!;
      const job = (await getJob(shot.jobId)) as { wardrobe?: Record<string, unknown> } | null;
      if (!job) {
        return NextResponse.json({ error: 'job not found' }, { status: 404 });
      }
      const focusSlot = Object.entries(job.wardrobe || {}).find(
        ([, v]) => (v as { isFocus?: boolean })?.isFocus,
      ) as [string, { itemId: string }] | undefined;
      if (!focusSlot) {
        return NextResponse.json(
          { error: 'no focus wardrobe item on job' },
          { status: 400 },
        );
      }
      const focusItem = (await getWardrobeItem(focusSlot[1].itemId)) as
        | { designNumber?: string }
        | null;
      if (!focusItem?.designNumber) {
        return NextResponse.json(
          { error: 'focus wardrobe item missing designNumber' },
          { status: 400 },
        );
      }
      const codes = styleAndColorwayOf(focusItem.designNumber);
      if (!codes) {
        return NextResponse.json(
          { error: `cannot parse designNumber "${focusItem.designNumber}"` },
          { status: 400 },
        );
      }
      styleCode = codes.styleCode;
      colorwayCode = codes.colorwayCode;
    }

    if (!styleCode || !colorwayCode) {
      return NextResponse.json(
        { error: 'query params required: (style + colorway) or (shot)' },
        { status: 400 },
      );
    }

    const render = await resolveLabelRenderConfig(styleCode, colorwayCode);
    if (!render) {
      return NextResponse.json(
        { error: `no three-tier label config for ${styleCode}/${colorwayCode}` },
        { status: 404 },
      );
    }

    const materialUrl = resolveAssetUrl(render.materialTileUrl);
    const templateUrl = resolveAssetUrl(render.artworkUrl);

    const key = cacheKey({
      styleCode,
      colorwayCode,
      width,
      height,
      baseColor: render.baseColor.hex,
      embossStrength: render.embossStrength,
      templateId: render.templateId,
      materialTileUrl: render.materialTileUrl,
    });
    await ensureCacheDir();
    const cachedPath = path.join(CACHE_DIR, `${key}.png`);

    let pngBuf: Buffer;
    if (await fileExists(cachedPath)) {
      pngBuf = await readFile(cachedPath);
    } else {
      // Cache miss — render via Python subprocess
      const workDir = await mkdtemp(path.join(tmpdir(), 'label-preview-'));
      try {
        const materialPath = path.join(workDir, 'material.png');
        const templatePath = path.join(workDir, 'template.png');
        const outputPath = path.join(workDir, 'preview.png');
        const argsPath = path.join(workDir, 'args.json');

        await Promise.all([
          downloadToFile(materialUrl, materialPath),
          downloadToFile(templateUrl, templatePath),
        ]);

        const args = {
          mode: 'preview',
          material_tile: materialPath,
          template: templatePath,
          base_color: render.baseColor.hex,
          emboss_strength: render.embossStrength,
          width,
          height,
          output: outputPath,
        };
        await writeFile(argsPath, JSON.stringify(args));

        const { stdout, stderr } = await execFileAsync(
          'python3',
          [PYTHON_SCRIPT, argsPath],
          { timeout: SUBPROCESS_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 },
        );
        if (stderr) {
          console.log(
            `[LabelPreview] python stderr: ${stderr.trim().slice(-400)}`,
          );
        }
        let result: Record<string, unknown>;
        try {
          result = JSON.parse(stdout.trim());
        } catch {
          throw new Error(`bad python stdout: ${stdout.slice(0, 200)}`);
        }
        if (!result.ok) {
          throw new Error(`python preview failed: ${JSON.stringify(result)}`);
        }
        pngBuf = await readFile(outputPath);
        // Write into cache (best-effort — if it fails we still return the buf)
        await writeFile(cachedPath, pngBuf).catch(() => {});
      } finally {
        rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    // Build a Uint8Array copy so the Response body is a plain ArrayBuffer
    const bodyBytes = new Uint8Array(pngBuf);
    return new Response(bodyBytes, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        // Immutable because the key folds config into it — any edit invalidates
        'Cache-Control': 'public, max-age=3600, immutable',
        'X-Label-Cache-Key': key,
      },
    });
  } catch (err) {
    console.error('[LabelPreview] failed:', err);
    return NextResponse.json(
      { error: 'label preview failed', details: String(err) },
      { status: 500 },
    );
  }
}
