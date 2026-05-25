/**
 * Dump the actual prompt(s) used for each shot in a job.
 * Reads from the shots subcollection / shot documents.
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

async function main() {
  const jobId = process.argv[2];
  if (!jobId) { console.error('usage: dump-job-prompts.ts <jobId>'); process.exit(1); }

  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const jobDoc = await db.collection('jobs').doc(jobId).get();
  if (!jobDoc.exists) { console.error('Job not found'); process.exit(1); }
  const job = jobDoc.data() as any;
  console.log(`Job: ${job.jobName || '?'}`);
  console.log(`Provider: ${job.provider}, Model: ${job.modelId}, Status: ${job.status}`);

  const shotsSnap = await db.collection('shots').where('jobId', '==', jobId).get();
  const sorted = shotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any))
    .sort((a, b) => (a.shotType || '').localeCompare(b.shotType || ''));

  for (const s of sorted) {
    console.log(`\n========================================`);
    console.log(`=== ${s.shotType}${s.variant && s.variant !== 'A' ? '-' + s.variant : ''} (shotId: ${s.id}) ===`);
    console.log(`========================================`);
    console.log(`status: ${s.status}, version: ${s.version}, teeEdit: ${s.teeEditApplied}`);
    if (s.imageUrl) console.log(`imageUrl: ${s.imageUrl}`);

    // Brute-force: print every field, show prompt-ish ones in full
    for (const [k, v] of Object.entries(s)) {
      if (k === 'id' || k === 'shotId' || k === 'jobId') continue;
      if (typeof v === 'string') {
        if (v.length > 200) {
          console.log(`\n--- ${k} (${v.length} chars) ---`);
          console.log(v);
        } else {
          console.log(`  ${k}: ${v.slice(0, 200)}`);
        }
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        console.log(`  ${k}: ${v}`);
      } else if (Array.isArray(v)) {
        console.log(`  ${k}: [array, len=${v.length}]`);
      } else if (v && typeof v === 'object') {
        const json = JSON.stringify(v);
        if (json.length > 500) console.log(`  ${k}: [object, ${json.length} chars]`);
        else console.log(`  ${k}: ${json}`);
      }
    }
  }
}

main().catch(e=>{console.error(e); process.exit(1)});
