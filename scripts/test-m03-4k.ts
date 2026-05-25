/**
 * Local test: run the CURRENT production M03 path at 4K Seedream output
 * on a given job. No predressed step, no architectural changes — just the
 * production seedreamM03() pipeline with the new 4K aspectToSize.
 *
 * Purpose: see what the deployed 4K bump produces in isolation, before
 * deciding whether to keep iterating on the predressed pipeline.
 *
 * Usage: npx tsx scripts/test-m03-4k.ts <jobId>
 *
 * Output:
 *   test_outputs/m03-4k/<jobId>/m03_4k.png         — new 4K Seedream M03
 *   test_outputs/m03-4k/<jobId>/m03_2k_reference.png — existing 2K M03 from Firestore
 *
 * Cost: ~$0.04 per call (one Seedream gen).
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
import { generateSeedreamShot, type SeedreamGenerationContext } from '../src/lib/pipeline/seedream-generate';
import { loadPrompt } from '../src/lib/pipeline/prompt-loader';
import type { ShotType, JobWardrobe } from '../src/types';
import { getFocusSlot } from '../src/types';

const jobId = process.argv[2];
if (!jobId) { console.error('Usage: npx tsx scripts/test-m03-4k.ts <jobId>'); process.exit(1); }

const OUT_DIR = path.join(projectRoot, 'test_outputs', 'm03-4k', jobId);
fs.mkdirSync(OUT_DIR, { recursive: true });

async function fetchBuf(url: string): Promise<Buffer> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  const db = new Firestore();
  const jobSnap = await db.collection('jobs').doc(jobId).get();
  if (!jobSnap.exists) throw new Error(`Job ${jobId} not found`);
  const job = jobSnap.data() as {
    wardrobe: JobWardrobe;
    modelId: string;
    silhouetteAnalysis?: { front: string; back: string };
    m03AnchorUrl?: string;
    m04AnchorUrl?: string;
    seedreamModel?: string;
  };
  console.log(`Job ${jobId}: model=${job.modelId}, focus=${getFocusSlot(job.wardrobe) || 'none'}`);

  // Pull existing M03 from job for reference
  const shotsSnap = await db.collection('shots')
    .where('jobId', '==', jobId)
    .where('shotType', '==', 'M03')
    .get();
  if (shotsSnap.docs.length > 0) {
    const ref = shotsSnap.docs[0].data() as { imageUrl?: string };
    if (ref.imageUrl) {
      const refBuf = await fetchBuf(ref.imageUrl);
      fs.writeFileSync(path.join(OUT_DIR, 'm03_2k_reference.png'), refBuf);
      console.log(`✓ Saved 2K reference M03 (${(refBuf.length / 1024).toFixed(0)} KB)`);
    }
  }

  // Build production-equivalent context (mirrors what /api/generate route does)
  const focusSlot = getFocusSlot(job.wardrobe) ?? undefined;
  const ctx: SeedreamGenerationContext = {
    wardrobe: job.wardrobe,
    modelId: job.modelId,
    silhouette: job.silhouetteAnalysis || { front: '', back: '' },
    m03AnchorUrl: job.m03AnchorUrl,
    m04AnchorUrl: job.m04AnchorUrl,
    apiKey: process.env.BYTEPLUS_API_KEY,
    model: job.seedreamModel, // typically undefined → uses default seedream-4-5-251128
    focusSlot,
  };

  // Load the active M03 prompt from Firestore vault (same as production)
  console.log('Loading active M03 prompt from vault…');
  const prompt = await loadPrompt('M03' as ShotType, undefined, 'seedream');
  console.log(`✓ Loaded prompt rev=${prompt.revision}`);

  // Run the production seedreamM03 path
  console.log('\n=== Running production seedreamM03 at 4K (2304×4096) ===');
  const t0 = Date.now();
  const result = await generateSeedreamShot('M03' as ShotType, ctx, prompt);
  console.log(`✓ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.imageData.length} bytes`);
  fs.writeFileSync(path.join(OUT_DIR, 'm03_4k.png'), result.imageData);

  console.log(`\n────────────────────────────────────────`);
  console.log(`Compare in: ${OUT_DIR}`);
  console.log(`  m03_2k_reference.png — old 2K production M03 (from Firestore)`);
  console.log(`  m03_4k.png           — new 4K production M03 (this run)`);
  console.log(`────────────────────────────────────────`);
}

main().catch(e => { console.error(e); process.exit(1); });
