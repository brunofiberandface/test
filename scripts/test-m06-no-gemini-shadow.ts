/**
 * Test M06 matte pipeline WITHOUT the Gemini grounding-shadow regen step.
 *
 * Hypothesis: Gemini regen is causing the head-crop drift in matte-grey/
 * matte-white. Skipping it leaves the rembg + procedural-shadow output as
 * the master (less refined shadow but framing preserved).
 *
 * Method: take the production M06 v9 tee-edit (step 3) buffer and run
 * produceBackdropVariants() with disableShadow=true. Compare resulting
 * white + grey to the current matte-grey/matte-white (which DID run Gemini).
 *
 * Note: produceBackdropVariants requires GCS write access (uploads source
 * to temp bucket + triggers Cloud Run job). This runs against the real
 * Cloud Run subject-matte-job.
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

import { produceBackdropVariants } from '../src/lib/subject-matte';

const TEE_EDIT_URL = 'https://storage.googleapis.com/gstar-ai-studio-assets/output/Judee%20Low%20Waist%20Loose%20Jeans/debug/F9_M06_v9_teeedit.png';
const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/m06-no-gemini-shadow');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log(`Downloading tee-edit input...`);
  const resp = await fetch(TEE_EDIT_URL);
  if (!resp.ok) throw new Error(`fetch tee-edit ${resp.status}`);
  const teeEditBuf = Buffer.from(await resp.arrayBuffer());
  console.log(`Tee-edit input: ${(teeEditBuf.length / 1024).toFixed(0)}KB`);

  // Save the input for comparison
  fs.writeFileSync(path.join(OUT_DIR, 'input_tee-edit.png'), teeEditBuf);

  // Run the matte pipeline WITHOUT Gemini regen
  console.log(`\nRunning produceBackdropVariants with disableShadow=true...`);
  const t0 = Date.now();
  const result = await produceBackdropVariants(teeEditBuf, { disableShadow: true });
  if (!result) {
    console.error(`produceBackdropVariants returned null — see logs`);
    process.exit(1);
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  fs.writeFileSync(path.join(OUT_DIR, 'no-gemini_matte-grey.png'), result.greyBuffer);
  fs.writeFileSync(path.join(OUT_DIR, 'no-gemini_matte-white.png'), result.whiteBuffer);

  console.log(`\nDONE in ${dt}s`);
  console.log(`  upload: ${result.uploadMs}ms`);
  console.log(`  cloud run job (rembg+procedural-shadow): ${result.jobMs}ms`);
  console.log(`  download: ${result.downloadMs}ms`);
  console.log(`  geminiSkipped: ${result.geminiSkipped}`);
  console.log(`\nOutputs:`);
  console.log(`  ${path.join(OUT_DIR, 'no-gemini_matte-grey.png')} (${(result.greyBuffer.length / 1024).toFixed(0)}KB)`);
  console.log(`  ${path.join(OUT_DIR, 'no-gemini_matte-white.png')} (${(result.whiteBuffer.length / 1024).toFixed(0)}KB)`);
  console.log(`\nCompare to:`);
  console.log(`  current matte-grey (with Gemini regen): https://storage.googleapis.com/gstar-ai-studio-assets/output/Judee%20Low%20Waist%20Loose%20Jeans/debug/F9_M06_v9_matte-grey.png`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
