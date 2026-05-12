/**
 * Batch-rerun M06 shots for all top-focus jobs.
 *
 * 2026-05-12: Re-renders every top-focus M06 shot under the new focus-aware
 * Gemini path (gemini-m06.ts:generateM06TopFocusWithGemini) so historical
 * top-focus jobs use the t01-t05 pose vocabulary + body-only pose ref +
 * identity head crop.
 *
 * Default: dry-run (prints scope, no DB writes).
 * Pass --execute to actually reset shots + re-enqueue jobs.
 *
 * Skips:
 *   - Shots with status='approved' (user explicitly blessed)
 *   - Shots already 'queued' or 'generating' (in flight or pending)
 *
 * For each eligible shot:
 *   - status = 'queued'
 *   - error = null
 *   - progressStep = ''
 *   - progressPct = 0
 *   - version = currentVersion + 1
 *   - m06TopPoseId is DELETED (so the renderer random-picks t01-t05)
 *   - useDressedBase deleted (consistency with M05 batch pattern)
 *
 * For each parent job:
 *   - status set back to 'generating' so the worker re-picks it
 *   - Re-enqueued via enqueueJob
 *
 * Worker is triggered once at the end.
 *
 * Usage:
 *   npx tsx scripts/batch-rerun-m06-topfocus.ts             # dry-run
 *   npx tsx scripts/batch-rerun-m06-topfocus.ts --execute   # commit changes
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

const EXECUTE = process.argv.includes('--execute');
const APP_URL = process.env.APP_URL || 'https://gstar-ai-studio-dgybxlcuba-ew.a.run.app';

function isTopFocus(wardrobe: any): boolean {
  if (!wardrobe) return false;
  const topConfig = wardrobe?.top;
  return !!(topConfig && topConfig.isFocus === true && topConfig.itemId);
}

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  console.log(`MODE: ${EXECUTE ? 'EXECUTE (committing changes)' : 'DRY-RUN (no DB writes)'}`);
  console.log(`Querying all jobs...`);

  const jobsSnap = await db.collection('jobs').get();
  console.log(`  total jobs: ${jobsSnap.size}`);

  const topFocusJobs: { id: string; jobName: string }[] = [];
  for (const doc of jobsSnap.docs) {
    const job = doc.data() as any;
    if (isTopFocus(job.wardrobe)) {
      topFocusJobs.push({ id: doc.id, jobName: job.jobName || doc.id });
    }
  }
  console.log(`  top-focus jobs: ${topFocusJobs.length}`);

  // For each top-focus job, list M06 shots
  const reset: { shotId: string; jobId: string; jobName: string; version: number; previousStatus: string }[] = [];
  const skipped: { shotId: string; jobId: string; reason: string; status: string }[] = [];
  const affectedJobIds = new Set<string>();

  for (const j of topFocusJobs) {
    const shotsSnap = await db.collection('shots')
      .where('jobId', '==', j.id)
      .where('shotType', '==', 'M06')
      .get();
    for (const sDoc of shotsSnap.docs) {
      const shot = sDoc.data() as any;
      const status = shot.status as string;
      if (status === 'approved') {
        skipped.push({ shotId: sDoc.id, jobId: j.id, reason: 'approved', status });
        continue;
      }
      if (status === 'queued' || status === 'generating') {
        skipped.push({ shotId: sDoc.id, jobId: j.id, reason: 'in flight / queued', status });
        continue;
      }
      reset.push({
        shotId: sDoc.id,
        jobId: j.id,
        jobName: j.jobName,
        version: (shot.version as number) || 1,
        previousStatus: status,
      });
      affectedJobIds.add(j.id);
    }
  }

  console.log(`\n── SCOPE ─────────────────────────────────────────────`);
  console.log(`Top-focus jobs:               ${topFocusJobs.length}`);
  console.log(`M06 shots eligible for reset: ${reset.length}`);
  console.log(`M06 shots skipped (approved): ${skipped.filter(s => s.reason === 'approved').length}`);
  console.log(`M06 shots skipped (in flight): ${skipped.filter(s => s.reason !== 'approved').length}`);
  console.log(`Distinct jobs to re-enqueue:  ${affectedJobIds.size}`);

  // Status breakdown of resettable
  const statusBreakdown: Record<string, number> = {};
  for (const r of reset) statusBreakdown[r.previousStatus] = (statusBreakdown[r.previousStatus] || 0) + 1;
  console.log(`\nBreakdown of resettable by previous status:`);
  for (const [s, n] of Object.entries(statusBreakdown).sort()) {
    console.log(`  ${s.padEnd(12)} ${n}`);
  }

  if (reset.length === 0) {
    console.log(`\nNothing to do. Exit.`);
    return;
  }

  if (!EXECUTE) {
    console.log(`\nDRY-RUN — no DB writes. Re-run with --execute to commit.`);
    console.log(`Sample of shots that would be reset (first 10):`);
    for (const r of reset.slice(0, 10)) {
      console.log(`  ${r.shotId} job=${r.jobId} (${r.jobName}) v${r.version}→v${r.version + 1} prev=${r.previousStatus}`);
    }
    return;
  }

  // EXECUTE
  console.log(`\nResetting ${reset.length} M06 shots...`);
  const BATCH_SIZE = 250;  // Firestore batch limit is 500, leave headroom
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
        m06TopPoseId: FieldValue.delete(),   // unset → random pick (t01-t05)
        useDressedBase: FieldValue.delete(),
        updatedAt: new Date(),
      });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} shots reset (${written}/${reset.length})`);
  }

  console.log(`\nRe-enqueueing ${affectedJobIds.size} jobs...`);
  // Set job status back to 'generating' so worker picks them up
  // (writes are small — direct, no batch needed)
  let jobsUpdated = 0;
  for (const jobId of affectedJobIds) {
    try {
      await db.collection('jobs').doc(jobId).update({
        status: 'generating',
        updatedAt: new Date(),
      });
      jobsUpdated++;
    } catch (e) {
      console.warn(`  job ${jobId} update failed (non-blocking):`, (e as Error).message);
    }
  }
  console.log(`  ${jobsUpdated}/${affectedJobIds.size} jobs marked generating`);

  // Enqueue + trigger worker via API (uses the same path as the dashboard)
  console.log(`\nEnqueuing jobs via API...`);
  let enqueued = 0;
  for (const jobId of affectedJobIds) {
    try {
      const resp = await fetch(`${APP_URL}/api/jobs/${jobId}/enqueue`, { method: 'POST' });
      if (resp.ok) enqueued++;
    } catch { /* non-blocking */ }
  }
  console.log(`  ${enqueued}/${affectedJobIds.size} jobs enqueued`);

  // Single worker trigger at the end
  try {
    await fetch(`${APP_URL}/api/jobs/process-queue`, { method: 'POST' });
    console.log(`Worker triggered.`);
  } catch (e) {
    console.warn(`Worker trigger failed (non-blocking):`, (e as Error).message);
  }

  console.log(`\n── DONE ─────────────────────────────────────────────`);
  console.log(`Shots reset:    ${written}`);
  console.log(`Jobs re-enqueued: ${enqueued}`);
  console.log(`Next: monitor logs for [GeminiM06:topfocus] pose=tNN entries.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
