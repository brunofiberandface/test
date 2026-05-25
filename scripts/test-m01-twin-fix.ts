/**
 * Local A/B test for the M01 twin-model fix.
 *
 * Repros the F1+Midge twin bug by running matrixPaint() against the same
 * inputs that produced the production twin shot (FOeXAzcj7ak8WlJrNPly).
 *
 * Run sequence:
 *   1. "before" — current code (will be applied AFTER this file's
 *      check-in, but we test it via the current ref-construction logic).
 *   2. "after" — current code with 2-ref M01 (the fix already on disk).
 *
 * Since we can't easily flip the ref code at runtime from a script, this
 * script just runs the CURRENT in-repo matrix-paint.ts twice and saves
 * outputs side-by-side. The "before" reference is the production twin
 * image we already have at /tmp/gstar-debug/F1_M01_v1_0Ey.png.
 *
 * Usage:
 *   npx tsx scripts/test-m01-twin-fix.ts
 *
 * Outputs in test_outputs/m01-twin-fix/:
 *   after_run1.png  — seedream-only output, first attempt
 *   after_run2.png  — seedream-only output, second attempt (variance check)
 *   after_run3.png  — third attempt for confidence
 *   final_full.png  — post strip-paint full image
 */
import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  const c = fs.readFileSync(envPath, 'utf-8');
  for (const line of c.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { matrixPaint } from '../src/lib/pipeline/matrix-paint';
import type { JobWardrobe } from '../src/types';

const OUT_DIR = path.join(projectRoot, 'test_outputs', 'm01-twin-fix');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Reproducing job 0EyHGxBIcNUJN6jbr0Ad (F1 + Midge Slim Straight Jeans).
// Wardrobe pulled from the live job doc.
const MODEL_ID = 'F1';
const WARDROBE: JobWardrobe = {
  shoe:   { itemId: 'UWQztLuiruTWRgF0mO4H', isFocus: false },
  top:    { itemId: '75yjRi4aDa7aO2mftc5K', isFocus: false },
  bottom: { itemId: 'vdOxwqzTUBch6ktkOgfY', isFocus: true },
};

async function runOnce(label: string): Promise<void> {
  console.log(`\n[${label}] matrixPaint(M01, F1, Midge) starting...`);
  const t0 = Date.now();
  const result = await matrixPaint({
    shotType: 'M01',
    modelId: MODEL_ID,
    wardrobe: WARDROBE,
    focusSlot: 'bottom',
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const fp = path.join(OUT_DIR, `${label}.png`);
  fs.writeFileSync(fp, result.imageData);
  console.log(`[${label}] DONE in ${dt}s — ${result.imageData.length} bytes — teeEdited=${result.teeEdited} → ${fp}`);
  if (result.teeEditError) console.log(`[${label}] teeEditError: ${result.teeEditError}`);
}

async function main() {
  console.log(`Test: M01 twin-fix A/B`);
  console.log(`Job repro: 0EyHGxBIcNUJN6jbr0Ad (F1 + Midge Slim Straight Jeans)`);
  console.log(`Current matrix-paint.ts has been patched: M01 = 2 refs (matrix base + flat-front), no fit-model.`);
  console.log(`Original twin image was: ${path.join(OUT_DIR, '..', '..', '..', '..', 'tmp', 'gstar-debug', 'F1_M01_v1_0Ey.png')}`);
  console.log();

  for (const label of ['after_run1', 'after_run2', 'after_run3']) {
    try {
      await runOnce(label);
    } catch (err) {
      console.error(`[${label}] FAILED:`, (err as Error).message);
    }
  }

  console.log(`\nDone. Inspect: ${OUT_DIR}`);
  console.log(`Compare to production twin: /tmp/gstar-debug/F1_M01_v1_0Ey.png`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
