/**
 * Batch-rerun M04 shots whose bottom garment has a cropped / cuffed / rolled
 * hem — once the cuff-preserving Pass 2 prompt is live, every existing M04
 * render for these garments was produced under the old "jeans go over the
 * shoes" prompt and lost its cuff. Re-rendering with the new code fixes them.
 *
 * Detection: silhouetteIndicatesCroppedHem against wardrobeItem.silhouetteBack
 * (with silhouetteFront as fallback) — same logic as seedream-twopass.ts +
 * gemini-shoe-edit.ts.
 *
 * Scope: bottom-focus jobs where the bottom item matches the cuff detector.
 * (Top-focus jobs don't hit the M04 two-pass cuff path because the focus
 * is the top; the bottom there is described as "plain mid-blue jeans" via
 * text and doesn't share the same cuff-loss issue.)
 *
 * Default: dry-run. Pass --execute to commit.
 *
 * Skips approved + in-flight shots, same pattern as batch-rerun-m06-topfocus.
 *
 * Usage:
 *   npx tsx scripts/batch-rerun-m04-cuffed.ts             # dry-run
 *   npx tsx scripts/batch-rerun-m04-cuffed.ts --execute   # commit
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

import { Firestore, FieldValue } from '@google-cloud/firestore';
import { silhouetteIndicatesCroppedHem } from '../src/lib/pipeline/cropped-hem-detector';

const EXECUTE = process.argv.includes('--execute');
const APP_URL = process.env.APP_URL || 'https://gstar-ai-studio-dgybxlcuba-ew.a.run.app';

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  console.log(`MODE: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);

  // Step 1: identify all wardrobe bottom items with cuffed silhouette
  console.log(`\nScanning wardrobe items for cuffed hems...`);
  const wardrobeSnap = await db.collection('wardrobe').get();
  const cuffedItemIds = new Set<string>();
  const cuffedItemNames = new Map<string, string>();
  for (const d of wardrobeSnap.docs) {
    const item = d.data() as any;
    const silhouetteBack = item.silhouetteBack as string | undefined;
    const silhouetteFront = item.silhouetteFront as string | undefined;
    if (silhouetteIndicatesCroppedHem(silhouetteBack || silhouetteFront)) {
      cuffedItemIds.add(d.id);
      cuffedItemNames.set(d.id, item.name || d.id);
    }
  }
  console.log(`  ${cuffedItemIds.size} wardrobe items have cuffed/cropped hems:`);
  for (const id of cuffedItemIds) console.log(`    • ${id}  ${cuffedItemNames.get(id)}`);

  if (cuffedItemIds.size === 0) {
    console.log(`\nNothing to do.`);
    return;
  }

  // Step 2: find jobs whose bottom is one of these items AND bottom is focus
  console.log(`\nScanning jobs...`);
  const jobsSnap = await db.collection('jobs').get();
  const affectedJobs: { id: string; jobName: string; bottomItemId: string }[] = [];
  for (const d of jobsSnap.docs) {
    const job = d.data() as any;
    const bottomConfig = job.wardrobe?.bottom;
    if (!bottomConfig?.itemId) continue;
    if (!bottomConfig.isFocus) continue;  // only bottom-focus jobs hit the M04 two-pass cuff path
    if (cuffedItemIds.has(bottomConfig.itemId)) {
      affectedJobs.push({
        id: d.id,
        jobName: job.jobName || d.id,
        bottomItemId: bottomConfig.itemId,
      });
    }
  }
  console.log(`  ${affectedJobs.length} bottom-focus jobs use a cuffed-hem bottom`);

  // Step 3: find their M04 shots (non-approved, non-in-flight)
  const reset: { shotId: string; jobId: string; jobName: string; version: number; previousStatus: string; bottomName: string }[] = [];
  const skipped: { shotId: string; jobId: string; reason: string; status: string }[] = [];
  const affectedJobIds = new Set<string>();

  for (const j of affectedJobs) {
    const shotsSnap = await db.collection('shots')
      .where('jobId', '==', j.id)
      .where('shotType', '==', 'M04')
      .get();
    for (const sDoc of shotsSnap.docs) {
      const shot = sDoc.data() as any;
      const status = shot.status as string;
      if (status === 'approved') {
        skipped.push({ shotId: sDoc.id, jobId: j.id, reason: 'approved', status });
        continue;
      }
      if (status === 'queued' || status === 'generating') {
        skipped.push({ shotId: sDoc.id, jobId: j.id, reason: 'in flight', status });
        continue;
      }
      reset.push({
        shotId: sDoc.id,
        jobId: j.id,
        jobName: j.jobName,
        version: (shot.version as number) || 1,
        previousStatus: status,
        bottomName: cuffedItemNames.get(j.bottomItemId) || j.bottomItemId,
      });
      affectedJobIds.add(j.id);
    }
  }

  console.log(`\n── SCOPE ─────────────────────────────────────────────`);
  console.log(`Wardrobe items with cuffs:    ${cuffedItemIds.size}`);
  console.log(`Bottom-focus jobs affected:   ${affectedJobs.length}`);
  console.log(`M04 shots eligible for reset: ${reset.length}`);
  console.log(`M04 shots skipped (approved): ${skipped.filter(s => s.reason === 'approved').length}`);
  console.log(`M04 shots skipped (in flight): ${skipped.filter(s => s.reason !== 'approved').length}`);
  console.log(`Distinct jobs to re-enqueue:  ${affectedJobIds.size}`);

  const statusBreakdown: Record<string, number> = {};
  for (const r of reset) statusBreakdown[r.previousStatus] = (statusBreakdown[r.previousStatus] || 0) + 1;
  console.log(`\nBreakdown of resettable by previous status:`);
  for (const [s, n] of Object.entries(statusBreakdown).sort()) {
    console.log(`  ${s.padEnd(12)} ${n}`);
  }

  if (reset.length === 0) {
    console.log(`\nNothing to do.`);
    return;
  }

  if (!EXECUTE) {
    console.log(`\nDRY-RUN — no DB writes. Re-run with --execute to commit.`);
    console.log(`Sample of shots that would be reset (first 15):`);
    for (const r of reset.slice(0, 15)) {
      console.log(`  ${r.shotId} job=${r.jobId} (${r.jobName})  v${r.version}→v${r.version + 1}  prev=${r.previousStatus}  bottom="${r.bottomName}"`);
    }
    return;
  }

  // EXECUTE
  console.log(`\nResetting ${reset.length} M04 shots...`);
  const BATCH_SIZE = 250;
  let written = 0;
  for (let i = 0; i < reset.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = reset.slice(i, i + BATCH_SIZE);
    for (const r of chunk) {
      const ref = db.collection('shots').doc(r.shotId);
      batch.update(ref, {
        status: 'queued',
        error: null,
        progressStep: '',
        progressPct: 0,
        version: r.version + 1,
        useDressedBase: FieldValue.delete(),
        updatedAt: new Date(),
      });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} shots reset (${written}/${reset.length})`);
  }

  console.log(`\nRe-enqueueing ${affectedJobIds.size} jobs...`);
  let jobsUpdated = 0;
  for (const jobId of affectedJobIds) {
    try {
      await db.collection('jobs').doc(jobId).update({ status: 'generating', updatedAt: new Date() });
      jobsUpdated++;
    } catch (e) {
      console.warn(`  job ${jobId} update failed (non-blocking):`, (e as Error).message);
    }
  }
  console.log(`  ${jobsUpdated}/${affectedJobIds.size} jobs marked generating`);

  console.log(`\nEnqueuing jobs via API...`);
  let enqueued = 0;
  for (const jobId of affectedJobIds) {
    try {
      const resp = await fetch(`${APP_URL}/api/jobs/${jobId}/enqueue`, { method: 'POST' });
      if (resp.ok) enqueued++;
    } catch { /* non-blocking */ }
  }
  console.log(`  ${enqueued}/${affectedJobIds.size} jobs enqueued`);

  try {
    await fetch(`${APP_URL}/api/jobs/process-queue`, { method: 'POST' });
    console.log(`Worker triggered.`);
  } catch (e) {
    console.warn(`Worker trigger failed (non-blocking):`, (e as Error).message);
  }

  console.log(`\n── DONE ─────────────────────────────────────────────`);
  console.log(`Shots reset:    ${written}`);
  console.log(`Jobs re-enqueued: ${enqueued}`);
  console.log(`Next: monitor logs for [TwoPass M04] CUFFED branch entries.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
