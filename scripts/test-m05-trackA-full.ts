/**
 * End-to-end test of Track A: take the Seedream-cropped-refs output and
 * run it through the production tee-edit pipeline (Gemini paints the real tee).
 *
 * Validates that the final M05 (after Seedream + tee-edit) has the same tee
 * as the rest of the job's shots.
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

import { applyTeeEdit } from '../src/lib/pipeline/seedream-tee-edit';
import { Firestore } from '@google-cloud/firestore';

const JOB_ID = 'H6IsIQxs9n6yVTR1pbR0';
const SEEDREAM_OUTPUT = '/tmp/m05_replay/H6Is_M05_trackA_dryrun.png';

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const jobDoc = await db.collection('jobs').doc(JOB_ID).get();
  const job = jobDoc.data() as any;
  console.log(`Job: ${job.jobName}`);

  const sourceImage = fs.readFileSync(SEEDREAM_OUTPUT);
  console.log(`Source (Seedream M05 trackA dryrun): ${sourceImage.length} bytes`);

  console.log(`\nCalling applyTeeEdit...`);
  const t0 = Date.now();
  const result = await applyTeeEdit({
    sourceImage,
    wardrobe: job.wardrobe,
    shotType: 'M05',
  });
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — edited=${result.edited}, ${result.imageData.length} bytes`);
  if (result.error) console.log(`Error: ${result.error}`);

  const outPath = '/tmp/m05_replay/H6Is_M05_trackA_FINAL.png';
  await fs.promises.writeFile(outPath, result.imageData);
  console.log(`\n[wrote] ${outPath}`);
  console.log(`Inspect: open ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
