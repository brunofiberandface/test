/**
 * Replay M04 generation for a given job, directly via Seedream-4.5.
 *
 * Pulls all references (model identity, garment flats, fit-model back angles,
 * top + shoes refs, leather patch if applicable, optional M03 front anchor)
 * from Firestore + GCS, builds the M04 prompt with the currently active
 * vault revision, calls Seedream, saves output to /tmp/m04_replay/<job>.png.
 *
 * Usage:
 *   npx tsx scripts/replay-m04.ts <jobId> [outFilename]
 *
 * Bruno 2026-05-07: tight Seedream-direct loop instead of redeploying the
 * service for every prompt iteration.
 */
import * as path from 'path';
import * as fs from 'fs';

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

import { generateSeedreamShot } from '../src/lib/pipeline/seedream-generate';
import { Firestore } from '@google-cloud/firestore';

async function main() {
  const jobId = process.argv[2];
  const outName = process.argv[3] || `${jobId}_M04`;
  if (!jobId) {
    console.error('usage: npx tsx scripts/replay-m04.ts <jobId> [outFilename]');
    process.exit(1);
  }

  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  // Pull job
  const jobDoc = await db.collection('jobs').doc(jobId).get();
  if (!jobDoc.exists) { console.error(`job ${jobId} not found`); process.exit(2); }
  const job = jobDoc.data() as any;
  console.log(`job: ${job.jobName || jobId}`);
  console.log(`focus: ${job.focusName || job.focusDesignNumber || '?'}`);

  // Wardrobe + model
  const wardrobe = job.wardrobe;
  if (!wardrobe?.bottom?.itemId) { console.error('job has no bottom item — cannot replay M04'); process.exit(3); }
  const modelId = job.modelId || (job.modelIds && job.modelIds[0]);
  if (!modelId) { console.error('no modelId on job'); process.exit(4); }

  // Pull silhouetteBack from focus garment's wardrobe item
  const focusEntry = [wardrobe.shoe, wardrobe.top, wardrobe.bottom].find((s: any) => s?.isFocus) || wardrobe.bottom;
  const focusDoc = await db.collection('wardrobe').doc(focusEntry.itemId).get();
  const focusItem = focusDoc.data() as any;
  const silhouetteBack: string = focusItem?.silhouetteBack || '';
  const silhouetteFront: string = focusItem?.silhouetteFront || '';
  if (!silhouetteBack) {
    console.warn('⚠ focus item has no cached silhouetteBack — Seedream will receive empty silhouette block');
  } else {
    console.log(`silhouetteBack: ${silhouetteBack.length} chars`);
    console.log('--- SILHOUETTE BACK (FULL) ---');
    console.log(silhouetteBack);
    console.log('-----');
  }
  // Skip the actual Seedream call when DRY_RUN is set
  if (process.env.DRY_RUN) { console.log('[DRY_RUN] skipping Seedream call'); return; }

  // Active M04 prompt
  const promptSnap = await db.collection('promptVault')
    .where('shotType', '==', 'M04')
    .where('isActive', '==', true)
    .where('pipeline', '==', 'seedream')
    .limit(1).get();
  let promptDoc = promptSnap.docs[0]?.data() as any;
  if (!promptDoc) {
    // Fallback: any active M04 (no pipeline filter)
    const fb = await db.collection('promptVault')
      .where('shotType', '==', 'M04').where('isActive', '==', true).limit(1).get();
    promptDoc = fb.docs[0]?.data();
  }
  if (!promptDoc) { console.error('no active M04 prompt'); process.exit(5); }
  console.log(`prompt rev: ${promptDoc.revision}`);

  // Extract Step 2 prompt body from the .md content
  const content = promptDoc.content as string;
  let generationPrompt = '';
  const step2Idx = content.indexOf('## Step 2 Prompt');
  if (step2Idx >= 0) {
    const after = content.substring(step2Idx);
    const codeStart = after.indexOf('```\n');
    if (codeStart >= 0) {
      const body = after.substring(codeStart + 4);
      const codeEnd = body.indexOf('\n```');
      generationPrompt = codeEnd >= 0 ? body.substring(0, codeEnd) : body;
    }
  }
  if (!generationPrompt) { console.error('failed to extract Step 2 prompt body'); process.exit(6); }

  // Build a context that mimics the production pipeline's GenerationContext
  const ctx: any = {
    wardrobe,
    modelId,
    silhouette: { front: silhouetteFront, back: silhouetteBack },
    m03AnchorUrl: job.m03AnchorUrl,
    m04AnchorUrl: job.m04AnchorUrl,
    // No apiKey — falls back to BYTEPLUS_API_KEY env var
  };

  const prompt = {
    generationPrompt,
    silhouettePrompt: null,
    revision: promptDoc.revision,
    shotType: 'M04' as const,
  };

  console.log(`\n[replay] calling Seedream-4.5 (M04, rev ${promptDoc.revision})...`);
  const t0 = Date.now();
  const result = await generateSeedreamShot('M04', ctx, prompt as any);
  console.log(`[replay] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.imageData.length} bytes`);

  const outDir = '/tmp/m04_replay';
  await fs.promises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${outName}.png`);
  await fs.promises.writeFile(outPath, result.imageData);
  console.log(`[wrote] ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
