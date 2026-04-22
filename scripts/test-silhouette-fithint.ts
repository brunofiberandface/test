/**
 * Test script — option C verification.
 *
 * Runs Flash Lite silhouette analysis on the Kate Boyfriend focus garment
 * TWICE:
 *   1. Baseline = already cached on the job (no fitHint, no dressed-base fix)
 *   2. New run = with the new fitHint block prepended
 *
 * Compares both outputs side-by-side. Does NOT touch production, does NOT
 * deploy. Costs ~$0.004 in Flash Lite calls.
 *
 * Run: npx tsx scripts/test-silhouette-fithint.ts
 */

import * as path from 'path';
import * as fs from 'fs';

// ── Load .env.local and point GOOGLE_APPLICATION_CREDENTIALS at sa_key.json ──
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

// ── Imports (after env set-up) ──
import { Firestore } from '@google-cloud/firestore';
import { analyzeSilhouette } from '../src/lib/pipeline/silhouette';
import { downloadGarmentImage } from '../src/lib/gcs';
import { normalizeWardrobeItem } from '../src/lib/wardrobe-compat';

const JOB_ID = 'E9RZzfNp2aUeqKUtnFBg';

function divider(title: string) {
  console.log('\n' + '═'.repeat(80));
  console.log(title);
  console.log('═'.repeat(80));
}

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: {
      client_email: saKey.client_email,
      private_key: saKey.private_key,
    },
  });

  divider(`Loading job ${JOB_ID}`);
  const jobSnap = await db.collection('jobs').doc(JOB_ID).get();
  if (!jobSnap.exists) throw new Error(`Job ${JOB_ID} not found`);
  const job = jobSnap.data() as any;
  console.log(`Job name: ${job.jobName || '(unnamed)'}`);
  console.log(`Model ID: ${job.modelId}`);

  // Find focus slot in wardrobe
  const entries = Object.entries(job.wardrobe || {}) as Array<[string, any]>;
  const focusEntry = entries.find(([, v]) => v?.isFocus);
  if (!focusEntry) throw new Error('No focus item in job.wardrobe');
  const focusItemId: string = focusEntry[1].itemId;
  console.log(`Focus slot: ${focusEntry[0]}  →  wardrobe item: ${focusItemId}`);

  divider(`Loading focus wardrobe item`);
  const itemSnap = await db.collection('wardrobe').doc(focusItemId).get();
  if (!itemSnap.exists) throw new Error(`Wardrobe item ${focusItemId} not found`);
  const item = itemSnap.data() as any;
  console.log(`Name:            ${item.name}`);
  console.log(`Design number:   ${item.designNumber || '(none)'}`);
  console.log(`Category:        ${item.category}`);
  console.log(`Description:     ${item.description || '(none)'}`);
  console.log(`fitDescription:  ${item.fitDescription || '(none)'}`);
  console.log(`metadata.fitDescription: ${item.metadata?.fitDescription || '(none)'}`);

  // Build fit hint the same way jobs/route.ts now does
  const fitHint = [
    item?.name,
    item?.description,
    item?.fitDescription,
    item?.metadata?.fitDescription,
  ].filter(Boolean).join(' — ');

  divider('Built fitHint (what Flash Lite will now see)');
  console.log(fitHint || '(empty)');

  // ── Download images (use the SAME normalizer production uses) ──
  divider('Downloading garment images from GCS');
  const normalized = normalizeWardrobeItem(item);
  if (!normalized) throw new Error('normalizeWardrobeItem returned null');
  const fm = normalized.fitModels || ({} as any);
  console.log('normalized.fitModels keys:', Object.keys(fm));
  for (const k of Object.keys(fm)) {
    const v = (fm as any)[k];
    console.log(`  ${k}: ${v ? (typeof v === 'string' ? v.slice(0, 90) + '…' : '(non-string)') : '(empty)'}`);
  }
  console.log(`flatFrontUrl: ${normalized.flatFrontUrl ? 'set' : '(none)'}`);
  console.log(`flatBackUrl:  ${normalized.flatBackUrl ? 'set' : '(none)'}`);

  const stripQ = (u: string | undefined) => (u && typeof u === 'string' ? u.split('?')[0] : null);
  const fetchOpt = async (u: string | null) =>
    u ? downloadGarmentImage(u) : Promise.resolve(null as Buffer | null);

  const [flatFront, flatBack, frontBuf, front45L, front45R, backBuf, back45L, back45R] =
    await Promise.all([
      fetchOpt(stripQ(normalized.flatFrontUrl)),
      fetchOpt(stripQ(normalized.flatBackUrl)),
      fetchOpt(stripQ(fm.front)),
      fetchOpt(stripQ(fm.front45Left)),
      fetchOpt(stripQ(fm.front45Right)),
      fetchOpt(stripQ(fm.back)),
      fetchOpt(stripQ(fm.back45Left)),
      fetchOpt(stripQ(fm.back45Right)),
    ]);

  if (!flatFront) throw new Error('flatFrontUrl missing — cannot analyze');

  // Fallbacks: if a side angle is missing, reuse the straight-on angle.
  // Flash Lite tolerates this — it's just analyzing shapes.
  const front0 = frontBuf || flatFront;
  const f1 = front45L || front0;
  const f2 = front45R || front0;
  const back0 = backBuf || front0;
  const b1 = back45L || back0;
  const b2 = back45R || back0;

  const sz = (b: Buffer | null) => (b ? `${b.length} bytes` : '(missing)');
  console.log(`  flat front:  ${sz(flatFront)}`);
  console.log(`  flat back:   ${sz(flatBack)}`);
  console.log(`  front ×3:    ${sz(frontBuf)} / ${sz(front45L)} / ${sz(front45R)}`);
  console.log(`  back ×3:     ${sz(backBuf)} / ${sz(back45L)} / ${sz(back45R)}`);

  // Use fallback-filled sets for analysis
  const frontSet = [front0, f1, f2];
  const backSet = [back0, b1, b2];

  // ── Run NEW silhouette analysis WITH fitHint ──
  divider('Running NEW silhouette analysis (with fitHint)');
  console.log('(calling Flash Lite, this takes ~3-6 seconds)');
  const t0 = Date.now();
  const newResult = await analyzeSilhouette({
    flatFront,
    flatBack,
    frontAngles: [frontBuf, front45L, front45R],
    backAngles: [backBuf, back45L, back45R],
    fitHint,
  });
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // ── Compare ──
  divider('BASELINE FRONT — cached on job (NO fitHint, old flow)');
  console.log(job.silhouetteAnalysis?.front || '(no cached baseline on this job)');

  divider('NEW FRONT — with fitHint');
  console.log(newResult.front);

  divider('BASELINE BACK — cached on job (NO fitHint, old flow)');
  console.log(job.silhouetteAnalysis?.back || '(no cached baseline on this job)');

  divider('NEW BACK — with fitHint');
  console.log(newResult.back);

  // ── Quick diff of FIT CATEGORY line ──
  divider('FIT CATEGORY diff (grep "FIT CATEGORY" from each)');
  const grab = (txt: string | undefined) => {
    if (!txt) return '(none)';
    const m = txt.match(/FIT CATEGORY[^\n]*/i);
    return m ? m[0] : '(no "FIT CATEGORY" line found)';
  };
  console.log(`BASELINE front: ${grab(job.silhouetteAnalysis?.front)}`);
  console.log(`NEW      front: ${grab(newResult.front)}`);
  console.log(`BASELINE back : ${grab(job.silhouetteAnalysis?.back)}`);
  console.log(`NEW      back : ${grab(newResult.back)}`);

  console.log('\nDone. No production state touched.\n');
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
