/**
 * Focused A/B: same M03 prompt + refs, run at OLD 2K size and NEW 4K size.
 *
 * Hypothesis: Bruno's complaint is that at 4K the model occupies less of
 * the frame than at 2K (more "empty studio"). If true, the prompt's
 * framing instructions are being interpreted differently at higher
 * resolution and we need to either tighten the prompt OR change how we
 * pass the size param to Seedream.
 *
 * This script overrides aspectToSize per-call to test both sizes
 * independently while keeping everything else identical.
 *
 * Usage: npx tsx scripts/test-framing-2k-vs-4k.ts <jobId>
 *
 * Outputs in test_outputs/framing-2k-vs-4k/<jobId>/:
 *   m03_old_2k.png  — Seedream at 1472×2624 (old)
 *   m03_new_4k.png  — Seedream at 2304×4096 (new)
 *   m03_4k_preset.png — Seedream with size="4K" string preset (BytePlus auto-aspect)
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
import { generateSeedreamImage, type SeedreamReferenceImage } from '../src/lib/pipeline/seedream-client';
import { ensureSeedreamSafeUrl } from '../src/lib/pipeline/seedream-image-safe';
import { loadPrompt } from '../src/lib/pipeline/prompt-loader';
import type { ShotType, JobWardrobe } from '../src/types';
import { getModel, getWardrobeItem } from '../src/lib/firestore';
import { normalizeWardrobeItem } from '../src/lib/wardrobe-compat';

const jobId = process.argv[2];
if (!jobId) { console.error('Usage: npx tsx scripts/test-framing-2k-vs-4k.ts <jobId>'); process.exit(1); }

const OUT_DIR = path.join(projectRoot, 'test_outputs', 'framing-2k-vs-4k', jobId);
fs.mkdirSync(OUT_DIR, { recursive: true });

const STUDIO_BACKDROP_URL = 'https://storage.googleapis.com/gstar-ai-studio-assets/backdrops/clean-studio-grey.jpg';

async function main() {
  const db = new Firestore();
  const jobSnap = await db.collection('jobs').doc(jobId).get();
  if (!jobSnap.exists) throw new Error(`Job ${jobId} not found`);
  const job = jobSnap.data() as { wardrobe: JobWardrobe; modelId: string };

  // Build the minimal set of M03 refs needed (mirrors seedreamM03 default
  // bottom-focus path: backdrop + model card front + flat front + 3 front
  // angles). This is just for the framing comparison — not the full
  // production ref structure.
  const model = await getModel(job.modelId) as { referenceImageUrl?: string; cardImageUrl?: string } | null;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;
  if (!modelRefUrl) throw new Error('No model card');

  const bottomCfg = job.wardrobe['bottom'];
  if (!bottomCfg?.itemId) throw new Error('No bottom in wardrobe');
  const bottom = await getWardrobeItem(bottomCfg.itemId) as Record<string, unknown> | null;
  if (!bottom) throw new Error('Bottom not found');
  const norm = normalizeWardrobeItem(bottom as Record<string, unknown>);
  const flatUrl = norm?.flatFrontUrl || (bottom as { flatFrontUrl?: string }).flatFrontUrl;
  const angles = [
    norm?.fitModels?.front,
    norm?.fitModels?.front45Left,
    norm?.fitModels?.front45Right,
  ].filter((u): u is string => typeof u === 'string' && u.length > 0).slice(0, 3);

  if (!flatUrl) throw new Error('No bottom flatFrontUrl');
  if (angles.length === 0) throw new Error('No bottom fit-model angles');

  // Use the SAME M03 prompt for both runs (loaded fresh from vault — same as
  // production), so any framing difference is purely due to the size param.
  const prompt = await loadPrompt('M03' as ShotType, undefined, 'seedream');
  console.log(`Loaded M03 prompt rev=${prompt.revision}`);
  // Inject minimal substitutions (this would normally go through buildPrompt;
  // we're skipping that for simplicity — same prompt for both 2K and 4K so
  // the comparison is fair).
  const finalPrompt = prompt.generationPrompt
    .replace(/\{garment_type\}/g, 'jeans')
    .replace(/\{top_description\}/g, 'simple black sports bra')
    .replace(/\{silhouette\}/g, '')
    .replace(/\{shoes_description\}/g, 'simple low-heel shoes')
    .replace(/\{gender\}/g, 'female');

  const refs: SeedreamReferenceImage[] = [
    { url: await ensureSeedreamSafeUrl(STUDIO_BACKDROP_URL), label: 'Studio backdrop' },
    { url: await ensureSeedreamSafeUrl(modelRefUrl.split('?')[0]), label: 'Model card front' },
    { url: await ensureSeedreamSafeUrl(flatUrl.split('?')[0]), label: 'Garment flat front' },
    ...await Promise.all(angles.map(async (a, i) => ({
      url: await ensureSeedreamSafeUrl(a.split('?')[0]),
      label: `Fit model front angle ${i + 1}`,
    }))),
  ];
  console.log(`Built ${refs.length} refs`);

  // Aspect for M03 in production is 9:16 (loaded from APP_CONFIG.shots.M03)
  // OR overridden by prompt.aspectOverride. Check what we get:
  const aspect = (prompt.aspectOverride || '9:16') as '9:16' | '3:4' | '1:1';
  console.log(`Aspect for M03: ${aspect} (override=${prompt.aspectOverride || 'none'})`);

  const runs: Array<{ name: string; size: string }> = [
    { name: 'old_2k', size: aspect === '9:16' ? '1472x2624' : aspect === '3:4' ? '1728x2304' : '2048x2048' },
    { name: 'new_4k', size: aspect === '9:16' ? '2304x4096' : aspect === '3:4' ? '3072x4096' : '4096x4096' },
    { name: '4k_preset', size: '4K' },
  ];

  for (const run of runs) {
    console.log(`\n=== Running ${run.name} (size=${run.size}) ===`);
    const t0 = Date.now();
    try {
      const result = await generateSeedreamImage({
        prompt: finalPrompt,
        referenceImages: refs,
        aspectRatio: aspect,
        size: run.size,
      });
      console.log(`✓ ${run.name} done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.imageData.length} bytes`);
      fs.writeFileSync(path.join(OUT_DIR, `m03_${run.name}.png`), result.imageData);
    } catch (e) {
      console.error(`✗ ${run.name} FAILED:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`\nDONE. Compare in: ${OUT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
