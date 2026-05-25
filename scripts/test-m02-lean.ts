/**
 * Local A/B: Bruno's lean prompt approach vs current rev 27 (overspecified).
 *
 * Calls generateSeedreamImage directly with:
 *   - Lean prompt (~150 words, mirrors Bruno's perfect manual test)
 *   - Minimal ref labels (~1 sentence each, no TIER framework, no GLOBAL_RULES)
 *   - Same 2 refs: matrix base (legs back) + fit-model back
 *
 * Total prompt budget ~600 chars (vs ~10KB current). Tests the hypothesis that
 * Seedream's failures (silhouette narrowing, jogger cuffs, color drift) were
 * partly caused by us drowning it in conflicting instructions.
 *
 * Stress cases: Bowey Barrel (was 3/3 skinny on rev 23), Cargo (jogger cuff
 * on rev 25, mid-calf crop on rev 26), Kate (gold/metallic on prior runs).
 *
 * Usage:
 *   npx tsx scripts/test-m02-lean.ts                 # all 3 cases
 *   npx tsx scripts/test-m02-lean.ts bowey           # one case
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

import { Firestore } from '@google-cloud/firestore';
import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';
import { getMatrixView } from '../src/lib/qa/shoe-matrix';

const OUT_BASE = path.join(projectRoot, 'test_outputs', 'm02-lean');
fs.mkdirSync(OUT_BASE, { recursive: true });

type Case = {
  label: string;
  modelId: string;
  shoeId: string;
  bottomId: string;
  bugHistory: string;
};

const CASES: Record<string, Case> = {
  bowey: {
    label: 'bowey-F9',
    modelId: 'F9',
    shoeId: 'PiLqQo7ObRvPrwBvbwZS',
    bottomId: 'Rq3K3UQGdJmVu4W0LwgK',
    bugHistory: 'Bowey Barrel Jeans — was 3/3 skinny on rev 23 baseline. Spec says 1.8x thigh, 2.2x knee.',
  },
  cargo: {
    label: 'cargo-M2',
    modelId: 'M2',
    shoeId: 'rsYW3jLvmZBTBuT6L4vI',
    bottomId: 'vTp2w3mYxytGaAflfG1r',
    bugHistory: 'Cargo trouser — jogger cuff on rev 25, mid-calf crop on rev 26. Spec says wide-leg, no cuff, long.',
  },
  kate: {
    label: 'kate-F6',
    modelId: 'F6',
    shoeId: 'Y47r4u3D9LPLtIRsAg8R',
    bottomId: 'YOiSIPlqgjcduhR3R6Ix',
    bugHistory: 'Kate Boyfriend Jeans — gold/metallic on F6_M02_v4 production run. Spec says sun-faded gunmetal grey.',
  },
};

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const which = process.argv[2];
  const toRun: Case[] = which ? [CASES[which]].filter(Boolean) : Object.values(CASES);
  if (toRun.length === 0) {
    console.error(`Unknown case: ${which}. Available: ${Object.keys(CASES).join(', ')}`);
    process.exit(1);
  }

  for (const c of toRun) {
    const outDir = path.join(OUT_BASE, c.label);
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`\n========== ${c.label} ==========`);
    console.log(`History: ${c.bugHistory}`);

    // Look up the matrix base + fit-model back URLs
    const matrixUrl = await getMatrixView(c.shoeId, c.modelId, 'legsBack');
    if (!matrixUrl) {
      console.error(`No legsBack matrix cell for ${c.shoeId}_${c.modelId}`);
      continue;
    }
    const bottom = (await db.collection('wardrobe').doc(c.bottomId).get()).data() as any;
    const fitBack = bottom?.fitModels?.back;
    if (!fitBack) {
      console.error(`No fitModels.back for ${c.bottomId}`);
      continue;
    }
    const garmentName = (bottom.name as string) || 'trousers';
    const garmentDescription = (bottom.description as string) || garmentName;

    console.log(`Matrix base:   ${matrixUrl}`);
    console.log(`Fit-model back: ${fitBack}`);
    console.log(`Garment: "${garmentName}"`);

    // PURE Bruno-manual prompt verbatim — no garment description, no IMAGE
    // labels, no output spec. Bruno's web-UI test of this exact prompt on
    // 3 distinctive silhouettes (wide cargo, wide barrel jeans, slim flare
    // denim) produced perfect renders.
    const prompt = `Apply the fitmodel trousers onto the AI model with shoes. so merge the two images, but the trousers should be fully respected in form and fit. all details need to be preserved, IMPORTANT is the trousers run naturally down respecting the fitmodel lenght of the trousers. the model needs to stand equally on 2 feet, 50% on each foot, keeping the same position as the underwear model.`;

    // Empty labels — seedream-client now skips the inventory block. The
    // logging field is still passed for log clarity but never reaches Seedream.
    const refs = [
      { url: matrixUrl.split('?')[0], label: 'matrix base (AI model + shoes + placeholder)' },
      { url: fitBack, label: 'fit-model back (target trousers)' },
    ];

    console.log(`Prompt length: ${prompt.length} chars`);
    console.log(`Total label length: ${refs.reduce((s, r) => s + r.label.length, 0)} chars`);

    for (const i of [1, 2, 3]) {
      const outFile = path.join(outDir, `run${i}.png`);
      try {
        console.log(`\n[run${i}] generating…`);
        const t0 = Date.now();
        const result = await generateSeedreamImage({
          prompt,
          referenceImages: refs,
          aspectRatio: '1:1',
        });
        const dt = ((Date.now() - t0) / 1000).toFixed(1);
        fs.writeFileSync(outFile, result.imageData);
        console.log(`[run${i}] DONE in ${dt}s — ${(result.imageData.length / 1024).toFixed(0)} KB → ${outFile}`);
      } catch (e) {
        console.error(`[run${i}] FAILED:`, (e as Error).message);
      }
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
