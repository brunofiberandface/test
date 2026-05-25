/**
 * Poll the 6 queued shots until all are done or failed.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Firestore } from '@google-cloud/firestore';

const projectRoot = path.resolve(__dirname, '..');
const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));

const JOBS = [
  { jobNum: 176, jobId: 'wTqVWk8Y0SFdACpKsp9w' },
  { jobNum: 159, jobId: '5gmKGdX4wvFwnk0xWTpH' },
  { jobNum: 184, jobId: 'c8M0QkHGNkoDynD9VCzw' },
];
const TARGETS = ['M01', 'M02'];

const db = new Firestore({
  projectId: saKey.project_id || 'gstar-ai-studio',
  credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
});

async function poll(): Promise<boolean> {
  let allDone = true;
  const lines: string[] = [];
  for (const j of JOBS) {
    const shotsSnap = await db.collection('shots').where('jobId', '==', j.jobId).get();
    for (const doc of shotsSnap.docs) {
      const shot = doc.data();
      if (!TARGETS.includes(shot.shotType as string)) continue;
      const st = shot.shotType as string;
      const status = shot.status as string;
      const version = shot.version as number;
      const eta = shot.percentComplete ? ` ${shot.percentComplete}%` : '';
      lines.push(`  #${j.jobNum} ${st} v${version} ${status}${eta}`);
      if (status !== 'done' && status !== 'approved' && status !== 'failed') allDone = false;
    }
  }
  console.log(`[${new Date().toLocaleTimeString()}] ${lines.length} shots:`);
  for (const l of lines) console.log(l);
  console.log();
  return allDone;
}

async function main() {
  const startMs = Date.now();
  while (true) {
    const done = await poll();
    if (done) { console.log('All done.'); break; }
    const elapsedMin = ((Date.now() - startMs) / 60000).toFixed(1);
    if (parseFloat(elapsedMin) > 20) { console.log('Timed out after 20 min.'); break; }
    await new Promise(r => setTimeout(r, 30_000));
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
