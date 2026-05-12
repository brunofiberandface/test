/**
 * Replay M03 generation for a given job, directly via Seedream-4.5.
 *
 * Mirrors scripts/replay-m04.ts but for M03 (single-pass front view).
 *
 * Usage:
 *   npx tsx scripts/replay-m03.ts <jobId> [outFilename]
 *
 * Bruno 2026-05-10: testing Path B (prompt inventory injection) — does delivering
 * the per-ref labels to Seedream via the prompt body restore the intended effect
 * of Phase B / shoe-size / expression label scoping?
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
  const outName = process.argv[3] || `${jobId}_M03`;
  if (!jobId) {
    console.error('usage: npx tsx scripts/replay-m03.ts <jobId> [outFilename]');
    process.exit(1);
  }

  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const jobDoc = await db.collection('jobs').doc(jobId).get();
  if (!jobDoc.exists) { console.error(`job ${jobId} not found`); process.exit(2); }
  const job = jobDoc.data() as any;
  console.log(`job: ${job.jobName || jobId}`);
  console.log(`model: ${job.modelId}`);

  const wardrobe = job.wardrobe;
  if (!wardrobe?.bottom?.itemId) { console.error('job has no bottom item'); process.exit(3); }
  const modelId = job.modelId || (job.modelIds && job.modelIds[0]);
  if (!modelId) { console.error('no modelId on job'); process.exit(4); }

  const focusEntry = [wardrobe.shoe, wardrobe.top, wardrobe.bottom].find((s: any) => s?.isFocus) || wardrobe.bottom;
  const focusDoc = await db.collection('wardrobe').doc(focusEntry.itemId).get();
  const focusItem = focusDoc.data() as any;
  const silhouetteFront: string = focusItem?.silhouetteFront || '';
  const silhouetteBack: string = focusItem?.silhouetteBack || '';
  console.log(`silhouetteFront: ${silhouetteFront.length} chars`);

  // Active M03 prompt (seedream pipeline)
  const promptSnap = await db.collection('promptVault')
    .where('shotType', '==', 'M03')
    .where('isActive', '==', true)
    .where('pipeline', '==', 'seedream')
    .limit(1).get();
  let promptDoc = promptSnap.docs[0]?.data() as any;
  if (!promptDoc) {
    const fb = await db.collection('promptVault')
      .where('shotType', '==', 'M03').where('isActive', '==', true).limit(1).get();
    promptDoc = fb.docs[0]?.data();
  }
  if (!promptDoc) { console.error('no active M03 prompt'); process.exit(5); }
  console.log(`prompt rev: ${promptDoc.revision}`);

  const content = promptDoc.content as string;
  // M03 prompts use the standard fenced-code-block convention (no Step1/Step2)
  const codeStart = content.indexOf('```\n');
  let generationPrompt = '';
  if (codeStart >= 0) {
    const body = content.substring(codeStart + 4);
    const codeEnd = body.indexOf('\n```');
    generationPrompt = codeEnd >= 0 ? body.substring(0, codeEnd) : body;
  }
  if (!generationPrompt) {
    // Fall back to entire content
    generationPrompt = content;
  }

  const ctx: any = {
    wardrobe,
    modelId,
    silhouette: { front: silhouetteFront, back: silhouetteBack },
    m03AnchorUrl: job.m03AnchorUrl,
    m04AnchorUrl: job.m04AnchorUrl,
    focusSlot: wardrobe.top?.isFocus ? 'top' : (wardrobe.shoe?.isFocus ? 'shoe' : undefined),
  };

  const prompt = {
    generationPrompt,
    silhouettePrompt: null,
    revision: promptDoc.revision,
    shotType: 'M03' as const,
  };

  console.log(`\n[replay-m03] calling Seedream-4.5 (M03, rev ${promptDoc.revision}) WITH prompt inventory injection...`);
  const t0 = Date.now();
  const result = await generateSeedreamShot('M03', ctx, prompt as any);
  console.log(`[replay-m03] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.imageData.length} bytes`);

  const outDir = '/tmp/m03_replay';
  await fs.promises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${outName}.png`);
  await fs.promises.writeFile(outPath, result.imageData);
  console.log(`saved: ${outPath}`);
}

main().catch(err => {
  console.error('replay-m03 failed:', err);
  process.exit(99);
});
