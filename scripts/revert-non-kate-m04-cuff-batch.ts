/**
 * URGENT REVERT (2026-05-12): The 2026-05-12 batch-rerun-m04-cuffed.ts
 * batch used a too-broad cuff detector that matched generic phrases
 * ("mid-calf", "cropped length", "raw selvedge") and applied the new
 * CUFFED Pass 2 prompt to garments that DO NOT have a rolled cuff
 * (3301 Flares, Culottes, CONTOR, RADAR LOOSE, etc.). User confirmed:
 * only Kate Boyfriend variants should have been in scope.
 *
 * This script reverts all M04 shots whose bottom is NOT a Kate Boyfriend
 * variant back to their pre-batch state:
 *   - status = 'done'
 *   - version -= 1 (revert the bump)
 *   - imageUrl set to the pre-batch GCS path (modelId_M04_v{prevVersion}.png)
 *
 * If the new v(N+1) render hasn't completed yet, this also dequeues it.
 *
 * Kate variants (KEEP, do NOT revert):
 *   YOiSIPlqgjcduhR3R6Ix  Kate Boyfriend Jeans
 *   PWYdwXzb61EXfjhSdulq  Kate Boyfriend Jeans 62
 *   OEyZ0lrt7s...          Kate Boyfriend Jeans 51
 *   OnOe3MaP00...          Kate Boyfriend Jeans
 *   5LCOIQVA7G...          Kate Boyfriend Jeans 53
 *   6aN3Hxx0GF...          Kate Boyfriend Jeans 61
 *
 * Usage:
 *   npx tsx scripts/revert-non-kate-m04-cuff-batch.ts             # dry-run
 *   npx tsx scripts/revert-non-kate-m04-cuff-batch.ts --execute   # commit
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

import { Firestore } from '@google-cloud/firestore';

const EXECUTE = process.argv.includes('--execute');
const APP_URL = process.env.APP_URL || 'https://gstar-ai-studio-dgybxlcuba-ew.a.run.app';

// Items that ARE truly rolled-cuff (user-confirmed scope: Kate variants only).
// All other items the broad detector flagged were false positives.
const KATE_KEEP_IDS = new Set([
  'YOiSIPlqgjcduhR3R6Ix',  // Kate Boyfriend Jeans
  'PWYdwXzb61EXfjhSdulq',  // Kate Boyfriend Jeans 62
  'OEyZ0lrt7soRIba963pI',  // Kate Boyfriend Jeans 51
  'OnOe3MaP00xavnoRtNN7',  // Kate Boyfriend Jeans (variant)
  '5LCOIQVA7GARxf33WxCY',  // Kate Boyfriend Jeans 53
  '6aN3Hxx0GFJFCW9U2Oyj',  // Kate Boyfriend Jeans 61
]);

function buildPrevImageUrl(jobName: string, modelId: string, version: number): string {
  // Match the upload pattern used in src/lib/gcs.ts: output/{jobName}/{modelId}_M04_v{N}.png
  const encName = encodeURIComponent(jobName);
  return `https://storage.googleapis.com/gstar-ai-studio-assets/output/${encName}/${modelId}_M04_v${version}.png`;
}

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  console.log(`MODE: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);

  // Build mapping of cuffed item ID prefix → full ID (since the detector list
  // earlier showed 10-char prefixes; resolve to full IDs by full-scan)
  // Actually, just scan jobs once and identify which jobs to revert.
  const jobsSnap = await db.collection('jobs').get();
  type Candidate = {
    jobId: string;
    jobName: string;
    bottomItemId: string;
    bottomName: string;
    shotId: string;
    currentVersion: number;
    currentStatus: string;
    currentImageUrl?: string;
    modelId: string;
  };
  const candidates: Candidate[] = [];

  for (const jd of jobsSnap.docs) {
    const job = jd.data() as any;
    const bottomConfig = job.wardrobe?.bottom;
    if (!bottomConfig?.itemId) continue;
    if (!bottomConfig.isFocus) continue;
    if (KATE_KEEP_IDS.has(bottomConfig.itemId)) continue;  // skip Kate
    // Resolve bottom name
    const bottomItem = (await db.collection('wardrobe').doc(bottomConfig.itemId).get()).data() as any;
    if (!bottomItem) continue;
    // Was this item flagged by the broad detector? Check silhouette
    const sil = (bottomItem.silhouetteBack || bottomItem.silhouetteFront || '') as string;
    const broadPatterns = [
      /\brolled\s+(cuff|hem|leg)/i,
      /\bcuffed\s+(hem|leg|cuff|edge)/i,
      /\bcropped\s+(length|leg|hem|pant|pants|jean|jeans|fit|cut|with)/i,
      /\babove[-\s]ankle\b/i,
      /\bankle[-\s]length\b/i,
      /\bcalf[-\s]length\b/i,
      /\bmid[-\s]calf\b/i,
      /\braw\s+selvedge/i,
      /\bcropped[-\s]with[-\s]cuff/i,
      /\bdeliberate\s+rolled\s+cuff/i,
      /\bfolded[-\s]up\s+hem\b/i,
      /\bturned[-\s]up\s+(cuff|hem)\b/i,
    ];
    const flaggedByOldDetector = broadPatterns.some(p => p.test(sil));
    if (!flaggedByOldDetector) continue;

    // This is a non-Kate job that the broad detector flagged → its M04s were affected
    const shotsSnap = await db.collection('shots')
      .where('jobId', '==', jd.id)
      .where('shotType', '==', 'M04')
      .get();
    for (const sd of shotsSnap.docs) {
      const s = sd.data() as any;
      const status = s.status as string;
      // Only revert shots whose version is recent (just bumped by the batch).
      // If the user re-rendered v(N+1) and approved it, we don't want to overwrite.
      // Heuristic: shot was touched after 2026-05-12T12:00:00Z by the batch.
      const touched = s.updatedAt?.toDate?.()?.getTime?.() || 0;
      const BATCH_THRESHOLD = new Date('2026-05-12T12:25:00Z').getTime();
      if (touched < BATCH_THRESHOLD) continue;  // not touched by my batch
      if (status === 'approved') continue;  // user already accepted, leave alone
      candidates.push({
        jobId: jd.id,
        jobName: job.jobName || jd.id,
        bottomItemId: bottomConfig.itemId,
        bottomName: bottomItem.name || '?',
        shotId: sd.id,
        currentVersion: (s.version as number) || 1,
        currentStatus: status,
        currentImageUrl: s.imageUrl,
        modelId: job.modelId,
      });
    }
  }

  console.log(`\n── SCOPE ──`);
  console.log(`Non-Kate shots touched by 2026-05-12 cuff batch: ${candidates.length}`);
  // Group by status
  const byStatus: Record<string, number> = {};
  for (const c of candidates) byStatus[c.currentStatus] = (byStatus[c.currentStatus] || 0) + 1;
  for (const [k, v] of Object.entries(byStatus).sort()) console.log(`  ${k.padEnd(12)} ${v}`);

  // Group by bottom name (so user can sanity-check the list)
  const byBottom: Record<string, number> = {};
  for (const c of candidates) byBottom[c.bottomName] = (byBottom[c.bottomName] || 0) + 1;
  console.log(`\nBy bottom garment:`);
  for (const [k, v] of Object.entries(byBottom).sort()) console.log(`  ${k.padEnd(40)} ${v}`);

  if (candidates.length === 0) {
    console.log(`\nNothing to revert.`);
    return;
  }

  if (!EXECUTE) {
    console.log(`\nDRY-RUN. Sample of shots to revert (first 10):`);
    for (const c of candidates.slice(0, 10)) {
      const prevV = c.currentVersion - 1;
      const newUrl = buildPrevImageUrl(c.jobName, c.modelId, prevV);
      console.log(`  ${c.shotId.slice(0,10)}  job=${c.jobId.slice(0,10)}  "${c.jobName}"  v${c.currentVersion}→v${prevV}  status:${c.currentStatus}→done`);
      console.log(`    → imageUrl: ${newUrl}`);
    }
    console.log(`\nRe-run with --execute to commit.`);
    return;
  }

  // EXECUTE
  console.log(`\nReverting ${candidates.length} shots...`);
  const BATCH_SIZE = 250;
  let written = 0;
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = candidates.slice(i, i + BATCH_SIZE);
    for (const c of chunk) {
      const prevV = c.currentVersion - 1;
      const prevUrl = buildPrevImageUrl(c.jobName, c.modelId, prevV);
      const ref = db.collection('shots').doc(c.shotId);
      batch.update(ref, {
        status: 'done',
        version: prevV,
        imageUrl: prevUrl,
        error: null,
        progressStep: '',
        progressPct: 100,
        updatedAt: new Date(),
      });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} reverted (${written}/${candidates.length})`);
  }

  // Remove these jobs from the queue if still enqueued
  console.log(`\nDequeueing affected jobs...`);
  const affectedJobIds = new Set(candidates.map(c => c.jobId));
  let dequeued = 0;
  for (const jobId of affectedJobIds) {
    try {
      await db.collection('queue').doc(jobId).delete();
      dequeued++;
    } catch { /* may not be in queue */ }
  }
  console.log(`  ${dequeued} queue entries removed`);

  console.log(`\n── DONE ──`);
  console.log(`Shots reverted: ${written}`);
  console.log(`Queue entries removed: ${dequeued}`);
  console.log(`\nNote: Kate Boyfriend variants (${KATE_KEEP_IDS.size} item IDs) were intentionally left alone.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
