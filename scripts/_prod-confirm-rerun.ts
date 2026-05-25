/**
 * Prod confirmation — trigger reruns of top-focus M01 + M02 on the 3 named jobs
 * so they re-render against rev 00607-7bn (new Gemini pass-2).
 *
 * Reads each job's shots from Firestore, identifies M01 + M02 (top-focus),
 * bumps version + sets status='queued', kicks the worker via /api/jobs/[id]/run-all.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Firestore } from '@google-cloud/firestore';

const projectRoot = path.resolve(__dirname, '..');
const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
const API_BASE = 'https://gstar-ai-studio-674145888056.europe-west1.run.app';

const JOBS = [
  { jobNum: 176, jobId: 'wTqVWk8Y0SFdACpKsp9w' },
  { jobNum: 159, jobId: '5gmKGdX4wvFwnk0xWTpH' },
  { jobNum: 184, jobId: 'c8M0QkHGNkoDynD9VCzw' },
];

async function main() {
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  for (const j of JOBS) {
    console.log(`\n──── #${j.jobNum} ${j.jobId} ────`);
    const shotsSnap = await db.collection('shots').where('jobId', '==', j.jobId).get();
    if (shotsSnap.empty) { console.log('  no shots found'); continue; }

    const targets = ['M01', 'M02'];
    for (const doc of shotsSnap.docs) {
      const shot = doc.data();
      const st = shot.shotType as string;
      if (!targets.includes(st)) continue;
      const oldVersion = (shot.version as number) || 1;
      const newVersion = oldVersion + 1;
      await doc.ref.update({
        version: newVersion,
        status: 'queued',
        updatedAt: new Date(),
      });
      console.log(`  ✓ ${st} v${oldVersion} → v${newVersion} (queued)`);
    }

    // Flip job status to 'generating' so the worker picks it up
    await db.collection('jobs').doc(j.jobId).update({ status: 'generating' });
    console.log('  job → generating');

    // Kick the worker
    const r = await fetch(`${API_BASE}/api/jobs/${j.jobId}/run-all`, { method: 'POST' });
    console.log(`  /run-all kick: HTTP ${r.status}`);
  }

  console.log('\nAll 3 jobs queued. Poll the API or check the UI for completion.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
