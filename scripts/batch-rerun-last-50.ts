/**
 * Batch rerun the last 50 jobs (by createdAt desc, non-archived) through the
 * latest Seedream pipeline. Skip retired shotTypes (M03/M04). Rerun ALL
 * active shots including previously-approved ones — flag `wasApproved=true`
 * on those so the results-page UI shows a "Pre-approved — Re-approve" badge
 * on the new version (reviewer can quickly re-bless after eyeballing).
 *
 * Usage:
 *   npx tsx scripts/batch-rerun-last-50.ts              # dry-run (lists what it would touch)
 *   npx tsx scripts/batch-rerun-last-50.ts --apply      # actually update Firestore + trigger worker
 *
 * Designed for the 2026-05-17 post-deploy backfill (rev 00583-zzn):
 * - Garment-agnostic prompt (culotte etc render correctly now)
 * - Hem-over-footwear rule (boots etc handled)
 * - Strip-paint tee tucking (M01/M02 show tucked-tee hem above waistband)
 * - Single-model lock (no twin M02 renders)
 *
 * Per-shot cost estimate: ~$0.20–0.30 (Seedream + Gemini strip-paint or
 * tee-edit). 50 jobs × ~4 shots each = ~200 generations = ~$40–60 spend.
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

import { Firestore, FieldValue } from '@google-cloud/firestore';
import { APP_CONFIG } from '../src/lib/config';
import { enqueueJob } from '../src/lib/firestore';

const apply = process.argv.includes('--apply');
const limit = 50;

const PROD_BASE = 'https://gstar-ai-studio-674145888056.europe-west1.run.app';

const db = new Firestore({ projectId: 'gstar-ai-studio' });

interface JobLite { id: string; jobName?: string; status?: string; archived?: boolean; createdAt?: any }
interface ShotLite { id: string; shotType?: string; status?: string }

async function main() {
  console.log(`[batch-rerun] mode=${apply ? 'APPLY' : 'DRY-RUN'} limit=${limit}`);
  console.log(`[batch-rerun] active shotTypes (will rerun): ${JSON.stringify(APP_CONFIG.shotTypes)}`);
  console.log(`[batch-rerun] skip rule: shotType in retired set (M03/M04). Approved shots ARE rerun and flagged wasApproved=true.\n`);

  const activeShotTypes = new Set<string>(APP_CONFIG.shotTypes);

  // 1. Last N non-archived jobs by createdAt desc.
  const snap = await db.collection('jobs')
    .orderBy('createdAt', 'desc')
    .limit(limit * 2)  // overfetch a bit since we filter archived below
    .get();
  const allJobs: JobLite[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as JobLite));
  const jobs = allJobs.filter(j => !j.archived).slice(0, limit);
  console.log(`[batch-rerun] fetched ${snap.docs.length} → ${jobs.length} non-archived`);

  let totalShotsReset = 0;
  let totalShotsSkipped = 0;
  let totalPreApproved = 0;
  let jobsToRerun = 0;
  let jobsNothingToDo = 0;

  for (const job of jobs) {
    const shotsSnap = await db.collection('shots').where('jobId', '==', job.id).get();
    const shots: ShotLite[] = shotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ShotLite));

    const toReset: ShotLite[] = [];
    const skipped: ShotLite[] = [];
    for (const s of shots) {
      const isActive = activeShotTypes.has(s.shotType || '');
      if (!isActive) {
        skipped.push(s);
      } else {
        toReset.push(s);
      }
    }

    totalShotsReset += toReset.length;
    totalShotsSkipped += skipped.length;
    const preApprovedInJob = toReset.filter(s => s.status === 'approved').length;
    totalPreApproved += preApprovedInJob;

    if (toReset.length === 0) {
      jobsNothingToDo++;
      console.log(`  [${job.id.slice(0,8)}] "${(job.jobName || '').slice(0, 40)}" — SKIP (no active shotTypes). ${skipped.length} retired shots untouched.`);
      continue;
    }
    jobsToRerun++;

    const resetSummary = toReset.map(s => `${s.shotType}(${s.status}${s.status === 'approved' ? '→preApproved' : ''})`).join(', ');
    const skipSummary = skipped.map(s => `${s.shotType}(${s.status})`).join(', ');
    console.log(`  [${job.id.slice(0,8)}] "${(job.jobName || '').slice(0, 40)}" — RESET: ${resetSummary} | SKIP: ${skipSummary || 'none'}`);

    if (!apply) continue;

    // Apply: reset shots + flag wasApproved if it was approved + clear m02AnchorUrl + set job status.
    const batch = db.batch();
    for (const s of toReset) {
      const ref = db.collection('shots').doc(s.id);
      const update: Record<string, unknown> = {
        provider: 'seedream',
        seedreamModel: FieldValue.delete(),
        status: 'pending',
        progressStep: '',
        progressPct: 0,
        updatedAt: new Date(),
      };
      if (s.status === 'approved') {
        update.wasApproved = true;
      }
      batch.update(ref, update);
    }
    await batch.commit();

    // Clear m02AnchorUrl only if M02 is being rerun (M05 depends on it).
    const m02BeingRerun = toReset.some(s => s.shotType === 'M02');
    if (m02BeingRerun) {
      await db.collection('jobs').doc(job.id).update({
        m02AnchorUrl: FieldValue.delete(),
        updatedAt: new Date(),
      });
    }

    // Update job status to 'generating' + enqueue so the worker picks it up.
    await db.collection('jobs').doc(job.id).update({
      status: 'generating',
      updatedAt: new Date(),
    });
    const result = await enqueueJob(job.id, (job.jobName as string) || job.id);
    if (result.slot !== null) {
      console.log(`    enqueued: slot=${result.slot}`);
    } else {
      console.log(`    queued: position=${result.position}`);
    }
  }

  console.log(`\n[batch-rerun] summary`);
  console.log(`  jobs scanned:                  ${jobs.length}`);
  console.log(`  jobs to rerun:                 ${jobsToRerun}`);
  console.log(`  jobs nothing-to-do (skip):     ${jobsNothingToDo}`);
  console.log(`  shots to reset:                ${totalShotsReset}`);
  console.log(`    of which pre-approved:       ${totalPreApproved} (UI will flag for re-approval)`);
  console.log(`  shots skipped (retired type):  ${totalShotsSkipped}`);
  console.log(`  est. cost:                     $${(totalShotsReset * 0.25).toFixed(2)} (rough)`);

  if (!apply) {
    console.log(`\n[batch-rerun] DRY-RUN — no Firestore writes. Re-run with --apply to execute.`);
    return;
  }

  // Trigger worker (one kick handles many enqueued jobs).
  console.log(`\n[batch-rerun] triggering worker at ${PROD_BASE}/api/jobs/process-queue …`);
  try {
    const r = await fetch(`${PROD_BASE}/api/jobs/process-queue`, { method: 'POST' });
    console.log(`[batch-rerun] worker trigger response: ${r.status}`);
  } catch (err) {
    console.warn(`[batch-rerun] worker trigger failed (non-blocking — worker will pick up on next dashboard load):`, err);
  }

  console.log(`\n✓ Done.`);
}

main().catch(e => { console.error(e); process.exit(1); });
