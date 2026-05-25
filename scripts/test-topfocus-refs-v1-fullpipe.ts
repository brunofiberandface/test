/**
 * Fix #1 — FULL PIPELINE test on existing Seedream-NEW renders.
 *
 * Bruno's question: does fix #1's new 5-ref Seedream output survive the
 * downstream applyTeeEdit + upper-body crop, OR does applyTeeEdit silently
 * fail on the new composition (twin / off-center) and ship bra?
 *
 * Inputs: existing PNGs from test-topfocus-refs-v1.ts (no re-Seedream call,
 *         saves time and money).
 * Per render: applyTeeEdit (paints the top, tucked per hardcoded LENGTH
 *             OVERRIDE) → cropFromFullBody('upper-body') (head→mid-femur).
 *
 * Test cases:
 *   1. 176_M01_new_seed2 → clean single-model input
 *   2. 176_M01_new_seed3 → TWIN input (does tee-edit handle 2 models?)
 *
 * Outputs go alongside the originals as *_fullpipe.png so the comparison is
 * easy.
 */
import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { applyTeeEdit } from '../src/lib/pipeline/seedream-tee-edit';
import { cropFromFullBody } from '../src/lib/pipeline/elbow-crop';

const API_BASE = 'https://gstar-ai-studio-674145888056.europe-west1.run.app';
const IN_DIR = path.join(projectRoot, 'test_outputs/topfocus-refs-v1');

async function fetchJob(jobId: string) {
  const r = await fetch(`${API_BASE}/api/jobs/${jobId}`);
  if (!r.ok) throw new Error(`fetchJob ${r.status}`);
  const d = await r.json();
  return d.job || d;
}

async function fullPipeline(label: string, sourcePng: string, jobId: string, shotType: 'M01' | 'M02') {
  console.log(`\n══ ${label} ══`);
  const sourceBuf = fs.readFileSync(sourcePng);
  console.log(`  source: ${path.basename(sourcePng)} (${(sourceBuf.length / 1024).toFixed(0)}KB)`);

  const jobDoc = await fetchJob(jobId);
  const wardrobe = jobDoc.wardrobe || {};
  console.log(`  wardrobe top: ${wardrobe.top?.itemId} (${wardrobe.top?.isFocus ? 'FOCUS' : 'styling'})`);

  // Step 1 — applyTeeEdit (focusSlot=undefined per matrix-paint.ts:511-516)
  const t0 = Date.now();
  console.log(`  [step 1] applyTeeEdit…`);
  const teeResult = await applyTeeEdit({
    sourceImage: sourceBuf,
    wardrobe,
    shotType,
    // focusSlot intentionally undefined — matches matrix-paint top-focus call
  });
  const teeMs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`    → edited=${teeResult.edited} (${teeMs}s, ${(teeResult.imageData.length / 1024).toFixed(0)}KB)${teeResult.error ? ` ERROR: ${teeResult.error}` : ''}`);

  const postTeePath = sourcePng.replace('.png', '_post-teeedit.png');
  fs.writeFileSync(postTeePath, teeResult.imageData);

  // Step 2 — upper-body crop
  const t1 = Date.now();
  console.log(`  [step 2] cropFromFullBody('upper-body')…`);
  const cropResult = await cropFromFullBody(teeResult.imageData, 'upper-body');
  const cropMs = ((Date.now() - t1) / 1000).toFixed(1);
  console.log(`    → ${cropResult.width}×${cropResult.height} (${cropMs}s)`);

  const finalPath = sourcePng.replace('.png', '_fullpipe.png');
  fs.writeFileSync(finalPath, cropResult.imageData);
  console.log(`  → ${path.basename(finalPath)}`);
}

async function main() {
  // Case 1: clean single-model input
  await fullPipeline(
    '#176 M01 NEW seed2 (CLEAN SINGLE)',
    path.join(IN_DIR, '176_M01_new_seed2.png'),
    'wTqVWk8Y0SFdACpKsp9w',
    'M01',
  );
  // Case 2: twin input
  await fullPipeline(
    '#176 M01 NEW seed3 (TWIN)',
    path.join(IN_DIR, '176_M01_new_seed3.png'),
    'wTqVWk8Y0SFdACpKsp9w',
    'M01',
  );
  console.log(`\nDone.`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
