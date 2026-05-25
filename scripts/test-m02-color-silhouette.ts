/**
 * Local repro for the two M02 production bugs:
 *
 *  A) Kate Boyfriend Jeans (F6) — M02 v4 came out GOLD/METALLIC shimmer
 *     instead of "sun faded gunmetal — warm grey-toned medium wash".
 *     Production:
 *     https://storage.googleapis.com/gstar-ai-studio-assets/output/Kate%20Boyfriend%20Jeans/F6_M02_v2.png
 *     Job: RuXZlglPjyYCvJ6XxDqZ — ran 2026-05-17 19:31 UTC on rev 00587-ckv.
 *
 *  B) Bowey Barrel Jeans (F9) — M02 v2 came out SKINNY instead of barrel.
 *     Silhouette spec says "1.8x thigh, 2.2x knee, NOT skinny" but Seedream
 *     defaulted to slim.
 *     Job: j7RnJwgHfCTfEzgTXjpI — ran 2026-05-17 19:50 UTC on rev 00588-fmt.
 *
 * No code changes for M02 in this round (M02 already shipped 2 refs); the only
 * lever available without re-uploading the vault is the prompt content. Run
 * this first WITHOUT touching the vault to confirm the bug reproduces locally
 * (rev 23 is currently active). Then if it does, upload rev 24 (v2 file) and
 * re-run to verify the strengthened prompt fixes it.
 *
 * Usage:
 *   npx tsx scripts/test-m02-color-silhouette.ts                 # both jobs
 *   npx tsx scripts/test-m02-color-silhouette.ts kate            # F6 Kate only
 *   npx tsx scripts/test-m02-color-silhouette.ts bowey           # F9 Bowey only
 *
 * Outputs in test_outputs/m02-color-silhouette/<label>/:
 *   run1.png, run2.png, run3.png  — three attempts for variance.
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

const OUT_BASE = path.join(projectRoot, 'test_outputs', 'm02-color-silhouette');
fs.mkdirSync(OUT_BASE, { recursive: true });

type Case = {
  label: string;
  modelId: string;
  wardrobe: JobWardrobe;
  bugDescription: string;
};

const CASES: Record<string, Case> = {
  kate: {
    label: 'kate-F6',
    modelId: 'F6',
    bugDescription: 'GOLD/METALLIC shimmer instead of sun-faded gunmetal grey denim',
    wardrobe: {
      shoe:   { itemId: 'Y47r4u3D9LPLtIRsAg8R', isFocus: false },
      top:    { itemId: 'kP9CgnGLwOaJiUrFdJFE', isFocus: false },
      bottom: { itemId: 'YOiSIPlqgjcduhR3R6Ix', isFocus: true },  // Kate Boyfriend Jeans
    },
  },
  bowey: {
    label: 'bowey-F9',
    modelId: 'F9',
    bugDescription: 'SKINNY denim instead of barrel-leg (1.8x thigh, 2.2x knee)',
    wardrobe: {
      shoe:   { itemId: 'PiLqQo7ObRvPrwBvbwZS', isFocus: false },
      top:    { itemId: 'ciMAoyYe3A936GSU2ItN', isFocus: false },
      bottom: { itemId: 'Rq3K3UQGdJmVu4W0LwgK', isFocus: true },  // Bowey Barrel Jeans
    },
  },
};

async function runOnce(c: Case, label: string, outDir: string): Promise<void> {
  console.log(`\n[${c.label}/${label}] matrixPaint(M02, ${c.modelId}, ${c.label}) starting...`);
  const t0 = Date.now();
  const result = await matrixPaint({
    shotType: 'M02',
    modelId: c.modelId,
    wardrobe: c.wardrobe,
    focusSlot: 'bottom',
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const fp = path.join(outDir, `${label}.png`);
  fs.writeFileSync(fp, result.imageData);
  console.log(`[${c.label}/${label}] DONE in ${dt}s — ${(result.imageData.length / 1024).toFixed(0)} KB — teeEdited=${result.teeEdited} → ${fp}`);
  if (result.teeEditError) console.log(`[${c.label}/${label}] teeEditError: ${result.teeEditError}`);
}

async function main() {
  const which = process.argv[2];
  const toRun: Case[] = which
    ? [CASES[which]].filter(Boolean)
    : Object.values(CASES);

  if (toRun.length === 0) {
    console.error(`Unknown case: ${which}. Available: ${Object.keys(CASES).join(', ')}`);
    process.exit(1);
  }

  console.log(`Cases: ${toRun.map(c => c.label).join(', ')}`);
  console.log();

  for (const c of toRun) {
    const outDir = path.join(OUT_BASE, c.label);
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`\n========== ${c.label} ==========`);
    console.log(`Bug repro target: ${c.bugDescription}`);

    for (const label of ['run1', 'run2', 'run3']) {
      try {
        await runOnce(c, label, outDir);
      } catch (err) {
        console.error(`[${c.label}/${label}] FAILED:`, (err as Error).message);
      }
    }

    console.log(`\nInspect: ${outDir}`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
