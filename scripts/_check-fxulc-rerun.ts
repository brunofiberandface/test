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
  const jobId = 'FXulcOtwRE2T7HNM3vJD';
  const job = (await db.collection('jobs').doc(jobId).get()).data() as any;
  console.log(`status: ${job?.status} | updatedAt: ${job?.updatedAt?.toDate?.()?.toISOString?.()}`);
  const shotsSnap = await db.collection('shots').where('jobId', '==', jobId).get();
  const sorted = shotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a,b)=> a.shotType.localeCompare(b.shotType));
  for (const s of sorted) {
    console.log(`  ${s.shotType} v${s.version}/${s.status} | updated=${s.updatedAt?.toDate?.()?.toISOString?.()?.slice(11,19) || '-'} | pipelineStages=${Object.keys(s.pipelineStages || {}).join(',') || '-'}`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
