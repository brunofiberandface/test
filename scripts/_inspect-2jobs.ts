import * as path from 'path';
import * as fs from 'fs';
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
import { Firestore } from '@google-cloud/firestore';

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({ projectId: saKey.project_id || 'gstar-ai-studio', credentials: { client_email: saKey.client_email, private_key: saKey.private_key } });

  const jobIds = ['j7RnJwgHfCTfEzgTXjpI', '0EyHGxBIcNUJN6jbr0Ad'];
  for (const id of jobIds) {
    console.log(`\n=== JOB ${id} ===`);
    const jobSnap = await db.collection('jobs').doc(id).get();
    const job = jobSnap.data();
    if (!job) { console.log('NOT FOUND'); continue; }
    console.log('status:', job.status, '| awaitingCell:', job.awaitingCell);
    console.log('modelId:', job.modelId, '| shoeId:', job.shoeId);
    console.log('garmentId:', job.garmentId);
    console.log('createdAt:', job.createdAt?.toDate?.());
    console.log('updatedAt:', job.updatedAt?.toDate?.());

    const shotsSnap = await db.collection('shots').where('jobId', '==', id).get();
    console.log(`\n${shotsSnap.size} shots:`);
    const byType: Record<string, any[]> = {};
    for (const d of shotsSnap.docs) {
      const s = d.data() as any;
      const t = s.shotType;
      if (!byType[t]) byType[t] = [];
      byType[t].push({ id: d.id, version: s.version, status: s.status, teeEdited: s.teeEdited, wasApproved: s.wasApproved, approved: s.approved, createdAt: s.createdAt?.toDate?.()?.toISOString?.()?.slice(11, 19), urls: (s.urls||[]).length, finalUrl: s.finalUrl ? 'set' : 'unset' });
    }
    for (const t of Object.keys(byType).sort()) {
      console.log(`  ${t}:`);
      for (const v of byType[t].sort((a,b)=>(b.version??0)-(a.version??0))) {
        console.log(`    v${v.version ?? '?'} ${v.status} | tee=${v.teeEdited ?? '-'} | approved=${v.approved ?? '-'}${v.wasApproved ? ' wasApproved' : ''} | urls=${v.urls} final=${v.finalUrl} | ${v.createdAt} | ${v.id}`);
      }
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
