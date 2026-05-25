/**
 * Twin detector CLI — given a path to a Seedream M01/M02 output PNG, prints
 * whether it reads as a single-model or a twin/diptych layout (per the
 * `detectTwinDiptych` heuristic in src/lib/pipeline/composite-back.ts).
 *
 * Usage:
 *   npx tsx scripts/twincheck.ts <path-to-png> [<more-paths>...]
 *
 * Threshold: luminance > 200 AND blueDominance < 10 → twin.
 */
import * as fs from 'fs';
import * as path from 'path';
import { detectTwinDiptych } from '../src/lib/pipeline/composite-back';

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('Usage: npx tsx scripts/twincheck.ts <path-to-png> [<more-paths>...]');
    process.exit(1);
  }
  for (const p of paths) {
    if (!fs.existsSync(p)) {
      console.error(`${p}: not found`);
      continue;
    }
    const buf = fs.readFileSync(p);
    const d = await detectTwinDiptych(buf);
    const tag = d.isTwin ? 'TWIN  ' : 'single';
    console.log(`${tag}  lum=${d.luminance.toFixed(1).padStart(6)}  blueDom=${d.blueDominance.toFixed(1).padStart(6)}  ${path.basename(p)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
