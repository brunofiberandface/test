/**
 * Integration test of the new M02 pipeline through the production
 * matrixPaint() function. Runs the full path: Tier-1 base → Seedream v9 →
 * Gemini extend-hem-over-shoe → strip-paint tee.
 *
 * Inputs match the production Judee job (AcPuFCu2I9PUDOZKpm1N):
 *   model: F9 (Tia)
 *   bottom: Judee Low Waist Loose Jeans (4nyMHh7ICQLrpxBX8zmP)
 *   shoe: Black leather chunky platform loafer (u6L8UZmZw7PM0iHLmNCv)
 *   top: olive linen tee (OhqDw6YrjCJrLDISuXNB)
 *
 * Pre-requisite: v9 vault prompt must be active (run promote-m02-v9-tier1.ts
 * without --dry first).
 *
 * 3 runs.
 */
import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { matrixPaint } from '../src/lib/pipeline/matrix-paint';

const WARDROBE = {
  shoe: { itemId: 'u6L8UZmZw7PM0iHLmNCv', isFocus: false },
  bottom: { itemId: '4nyMHh7ICQLrpxBX8zmP', isFocus: true },
  top: { itemId: 'OhqDw6YrjCJrLDISuXNB', isFocus: false },
};

const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/m02-integrated-pipeline');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function runOne(runIdx: number): Promise<void> {
  console.log(`\n=== run ${runIdx}/3 ===`);
  const t0 = Date.now();
  const result = await matrixPaint({
    shotType: 'M02',
    modelId: 'F9',
    wardrobe: WARDROBE as any,
    focusSlot: 'bottom',
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  const outPath = path.join(OUT_DIR, `run${runIdx}_final.png`);
  fs.writeFileSync(outPath, result.imageData);
  console.log(`DONE ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
  console.log(`  isUpperBodyCrop: ${result.isUpperBodyCrop}`);
  console.log(`  teeEdited: ${result.teeEdited}`);
  if (result.teeEditError) console.log(`  teeEditError: ${result.teeEditError}`);
  if (result.preStripPaintBuffer) {
    const preOut = path.join(OUT_DIR, `run${runIdx}_pre_strip_paint.png`);
    fs.writeFileSync(preOut, result.preStripPaintBuffer);
    console.log(`  saved pre-strip-paint snapshot: ${path.basename(preOut)}`);
  }
}

async function main() {
  console.log(`Integration test: F9 × Judee × black loafer × olive tee\n`);
  for (let i = 1; i <= 3; i++) {
    try {
      await runOne(i);
    } catch (e) {
      console.error(`run ${i} FAILED: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
