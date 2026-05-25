/**
 * Dump the FINAL prompts (post-injection) that matrix-paint sends to Seedream
 * for M01 and M02. Loads active vault prompts + applies all 4 placeholder
 * injectors against a real job's wardrobe.
 *
 * Run:
 *   npx tsx scripts/_dump-m01-m02-prompts.ts            # Bowey (j7Rn) + Midge (0Ey)
 *   npx tsx scripts/_dump-m01-m02-prompts.ts kate       # Kate Boyfriend F6
 *   npx tsx scripts/_dump-m01-m02-prompts.ts bowey      # Bowey Barrel F9
 *   npx tsx scripts/_dump-m01-m02-prompts.ts midge      # Midge Slim F1
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

import {
  loadPrompt,
  injectSilhouette,
  injectStylingDescriptions,
  injectGarmentType,
  injectMatrixContext,
} from '../src/lib/pipeline/prompt-loader';
import { getWardrobeItem } from '../src/lib/firestore';
import { normalizeWardrobeItem } from '../src/lib/wardrobe-compat';

type Case = {
  label: string;
  bottomId: string;
  shoeId: string;
};

const CASES: Record<string, Case> = {
  midge: { label: 'F1 + Midge Slim Straight', bottomId: 'vdOxwqzTUBch6ktkOgfY', shoeId: 'UWQztLuiruTWRgF0mO4H' },
  bowey: { label: 'F9 + Bowey Barrel', bottomId: 'Rq3K3UQGdJmVu4W0LwgK', shoeId: 'PiLqQo7ObRvPrwBvbwZS' },
  kate:  { label: 'F6 + Kate Boyfriend', bottomId: 'YOiSIPlqgjcduhR3R6Ix', shoeId: 'Y47r4u3D9LPLtIRsAg8R' },
};

async function dump(shotType: 'M01' | 'M02', c: Case): Promise<void> {
  const isBack = shotType === 'M02';
  const bottomItem = await getWardrobeItem(c.bottomId) as Record<string, unknown> | null;
  if (!bottomItem) throw new Error(`bottom ${c.bottomId} not found`);
  const shoeItem = await getWardrobeItem(c.shoeId) as Record<string, unknown> | null;
  const normalized = normalizeWardrobeItem(bottomItem);
  if (!normalized) throw new Error(`bottom ${c.bottomId} has no usable images`);

  const bottomName = (bottomItem.name as string) || 'bottom garment';
  const bottomDescription = (bottomItem.description as string) || bottomName;
  const bottomSilhouette = isBack
    ? ((bottomItem.silhouetteBack as string) || (bottomItem.silhouetteFront as string) || '')
    : ((bottomItem.silhouetteFront as string) || (bottomItem.silhouetteBack as string) || '');
  const shoeName = (shoeItem?.name as string) || 'footwear';
  const shoeDescription = (shoeItem?.description as string) || shoeName;

  const loaded = await loadPrompt(shotType, undefined, 'seedream');
  let p = loaded.generationPrompt;
  p = injectGarmentType(p, bottomName);
  p = injectSilhouette(p, bottomSilhouette);
  p = injectStylingDescriptions(p, '', shoeDescription);
  p = injectMatrixContext(p, bottomDescription, shoeName);

  console.log(`\n${'═'.repeat(90)}`);
  console.log(`${shotType}  —  ${c.label}  —  vault rev ${loaded.revision}  —  ${p.length} chars`);
  console.log('═'.repeat(90));
  console.log(p);
}

async function main() {
  const which = process.argv[2];
  const cases: Case[] = which ? [CASES[which]].filter(Boolean) : [CASES.bowey, CASES.midge];
  if (cases.length === 0) {
    console.error(`Unknown: ${which}. Try: midge, bowey, kate`);
    process.exit(1);
  }
  for (const c of cases) {
    for (const st of ['M01', 'M02'] as const) {
      try {
        await dump(st, c);
      } catch (e) {
        console.error(`${st}/${c.label} failed:`, (e as Error).message);
      }
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
