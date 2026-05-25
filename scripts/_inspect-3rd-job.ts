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
  
  // 3rd flagged: RuXZlglPjyYCvJ6XxDqZ (Kate Boyfriend Jeans), 4th: lKvJ5JlcmvRBqonnNl8P, 5th: FXulcOtwRE2T7HNM3vJD
  const ids = ['RuXZlglPjyYCvJ6XxDqZ', 'lKvJ5JlcmvRBqonnNl8P', 'FXulcOtwRE2T7HNM3vJD'];
  for (const id of ids) {
    const jobSnap = await db.collection('jobs').doc(id).get();
    const job = jobSnap.data() as any;
    if (!job) { console.log(`${id}: NOT FOUND`); continue; }
    console.log(`\n=== ${id} ${job.jobName} ===`);
    console.log('modelId:', job.modelId);
    console.log('updatedAt:', job.updatedAt?.toDate?.()?.toISOString?.());
    const shots = await db.collection('shots').where('jobId', '==', id).get();
    const byType: Record<string, any[]> = {};
    for (const d of shots.docs) {
      const s = d.data() as any;
      if (!byType[s.shotType]) byType[s.shotType] = [];
      byType[s.shotType].push(s);
    }
    for (const t of Object.keys(byType).sort()) {
      const latest = byType[t].sort((a,b)=>(b.version??0)-(a.version??0))[0];
      console.log(`  ${t} v${latest.version} ${latest.status} | tee=${latest.teeEditApplied} | url=${latest.imageUrl?.replace('https://storage.googleapis.com/gstar-ai-studio-assets', '')}`);
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
