/**
 * Local test: run the FULL production M03 + M04 pipeline at 4K Seedream
 * on a given job — Seedream + Gemini tee-edit (+ Gemini shoe-edit for M04).
 *
 * Skips matte / grounding-shadow / label-composite (those need Cloud Run Job
 * access for the matte service + complex labelAsset resolution). The subject
 * pixels are the same with or without matte, so this is enough to judge
 * t-shirt tucking, jean fit, identity, and overall quality.
 *
 * Usage: npx tsx scripts/test-fullpipeline-4k.ts <jobId>
 *
 * Outputs in test_outputs/fullpipeline-4k/<jobId>/:
 *   m03_2k_reference.png    — current production M03 (pre-4K bump)
 *   m04_2k_reference.png    — current production M04 (pre-4K bump)
 *   m03_4k_seedream.png     — raw Seedream M03 at 4K (sports-bra placeholder)
 *   m03_4k_post_teeedit.png — after Gemini tee-edit (real top painted)
 *   m04_4k_pass1.png        — Seedream Pass 1 (sports bra + briefs + shoes)
 *   m04_4k_pass2_seedream.png — Seedream Pass 2 (jeans painted)
 *   m04_4k_post_teeedit.png  — after Gemini tee-edit
 *   m04_4k_post_shoeedit.png — after Gemini shoe-edit (FINAL for comparison)
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
import { applyTeeEdit, needsTeeEdit } from '../src/lib/pipeline/seedream-tee-edit';
import { applyShoeEdit, needsShoeEdit } from '../src/lib/pipeline/imagen-shoe-edit';
import type { ShotType, JobWardrobe } from '../src/types';
import { getFocusSlot } from '../src/types';

const jobId = process.argv[2];
if (!jobId) { console.error('Usage: npx tsx scripts/test-fullpipeline-4k.ts <jobId>'); process.exit(1); }

const OUT_DIR = path.join(projectRoot, 'test_outputs', 'fullpipeline-4k', jobId);
fs.mkdirSync(OUT_DIR, { recursive: true });

async function fetchBuf(url: string): Promise<Buffer> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function runShotPipeline(
  shotType: 'M03' | 'M04',
  ctx: SeedreamGenerationContext,
  apiKey: string | undefined,
): Promise<void> {
  console.log(`\n══════════════════════════════════════════`);
  console.log(`  ${shotType} — full pipeline (Seedream 4K + Gemini edits)`);
  console.log(`══════════════════════════════════════════`);

  // 1. Seedream generation
  const prompt = await loadPrompt(shotType as ShotType, undefined, 'seedream');
  console.log(`[${shotType}] Loaded prompt rev=${prompt.revision}`);
  const t1 = Date.now();
  const seedreamResult = await generateSeedreamShot(shotType as ShotType, ctx, prompt);
  console.log(`[${shotType}] Seedream done in ${((Date.now() - t1) / 1000).toFixed(1)}s — ${seedreamResult.imageData.length} bytes`);
  fs.writeFileSync(path.join(OUT_DIR, `${shotType.toLowerCase()}_4k_seedream.png`), seedreamResult.imageData);

  // If two-pass, save Pass 1 too (M04 only)
  if (seedreamResult.pass1Url) {
    console.log(`[${shotType}] Two-pass Pass 1 URL: ${seedreamResult.pass1Url}`);
    try {
      const pass1Buf = await fetchBuf(seedreamResult.pass1Url);
      fs.writeFileSync(path.join(OUT_DIR, `${shotType.toLowerCase()}_4k_pass1.png`), pass1Buf);
      console.log(`[${shotType}] Saved Pass 1 (${(pass1Buf.length / 1024).toFixed(0)} KB)`);
      // Rename current seedream save to pass2 for clarity
      fs.renameSync(
        path.join(OUT_DIR, `${shotType.toLowerCase()}_4k_seedream.png`),
        path.join(OUT_DIR, `${shotType.toLowerCase()}_4k_pass2_seedream.png`),
      );
    } catch (e) {
      console.warn(`[${shotType}] Couldn't fetch Pass 1 URL:`, e instanceof Error ? e.message : e);
    }
  }

  let buf = seedreamResult.imageData;

  // 2. Tee-edit
  if (needsTeeEdit(shotType as ShotType, seedreamResult.model, ctx.focusSlot)) {
    console.log(`[${shotType}] Applying Gemini tee-edit…`);
    const t2 = Date.now();
    const teeResult = await applyTeeEdit({
      sourceImage: buf,
      wardrobe: ctx.wardrobe,
      shotType: shotType as ShotType,
      apiKey,
      focusSlot: ctx.focusSlot,
    });
    if (teeResult.edited) {
      console.log(`[${shotType}] Tee-edit done in ${((Date.now() - t2) / 1000).toFixed(1)}s — ${teeResult.imageData.length} bytes`);
      buf = teeResult.imageData;
      fs.writeFileSync(path.join(OUT_DIR, `${shotType.toLowerCase()}_4k_post_teeedit.png`), buf);
    } else {
      console.log(`[${shotType}] Tee-edit skipped or failed: ${teeResult.error || '(no error)'}`);
    }
  } else {
    console.log(`[${shotType}] Tee-edit not applicable for this shot/focus`);
  }

  // 3. Shoe-edit (M04 only)
  if (needsShoeEdit(shotType as ShotType)) {
    console.log(`[${shotType}] Applying Gemini shoe-edit…`);
    const t3 = Date.now();
    const shoeResult = await applyShoeEdit({
      sourceImage: buf,
      wardrobe: ctx.wardrobe,
      shotType: shotType as ShotType,
      apiKey,
    });
    if (shoeResult.edited) {
      console.log(`[${shotType}] Shoe-edit done in ${((Date.now() - t3) / 1000).toFixed(1)}s — ${shoeResult.imageData.length} bytes`);
      buf = shoeResult.imageData;
      fs.writeFileSync(path.join(OUT_DIR, `${shotType.toLowerCase()}_4k_post_shoeedit.png`), buf);
    } else {
      console.log(`[${shotType}] Shoe-edit skipped or failed: ${shoeResult.error || '(no error)'}`);
    }
  }
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

  // Pull existing M03 + M04 production references (2K)
  for (const shotType of ['M03', 'M04'] as const) {
    const shotSnap = await db.collection('shots')
      .where('jobId', '==', jobId)
      .where('shotType', '==', shotType)
      .get();
    if (shotSnap.docs.length > 0) {
      const ref = shotSnap.docs[0].data() as { imageUrl?: string };
      if (ref.imageUrl) {
        const refBuf = await fetchBuf(ref.imageUrl);
        fs.writeFileSync(path.join(OUT_DIR, `${shotType.toLowerCase()}_2k_reference.png`), refBuf);
        console.log(`✓ Saved 2K ${shotType} reference (${(refBuf.length / 1024).toFixed(0)} KB)`);
      }
    }
  }

  // When GEMINI_API_KEY is unset, generateImage falls back to Vertex AI via
  // the service account (sa_key.json). That's how our local dev setup runs
  // Gemini calls — no separate API key needed. Pass undefined explicitly.
  const apiKey = process.env.GEMINI_API_KEY || undefined;

  const focusSlot = getFocusSlot(job.wardrobe) ?? undefined;
  const ctx: SeedreamGenerationContext = {
    wardrobe: job.wardrobe,
    modelId: job.modelId,
    silhouette: job.silhouetteAnalysis || { front: '', back: '' },
    m03AnchorUrl: job.m03AnchorUrl,
    m04AnchorUrl: job.m04AnchorUrl,
    apiKey: process.env.BYTEPLUS_API_KEY,
    model: job.seedreamModel,
    focusSlot,
  };

  // Run M03 first (M04 may reference m03AnchorUrl in some flows — though for
  // this test we use the existing m03AnchorUrl from the job doc).
  await runShotPipeline('M03', ctx, apiKey);
  await runShotPipeline('M04', ctx, apiKey);

  console.log(`\n────────────────────────────────────────`);
  console.log(`DONE. Compare in: ${OUT_DIR}`);
  console.log(`────────────────────────────────────────`);
}

main().catch(e => { console.error(e); process.exit(1); });
