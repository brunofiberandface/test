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
  const jobId = 'RuXZlglPjyYCvJ6XxDqZ';
  const job = (await db.collection('jobs').doc(jobId).get()).data() as any;
  console.log('m06PoseId:', job?.m06PoseId, '| modelId:', job.modelId);
  const shots = await db.collection('shots').where('jobId', '==', jobId).where('shotType', '==', 'M06').get();
  for (const d of shots.docs) {
    const s = d.data() as any;
    console.log(`\n=== M06 v${s.version} (${d.id}) ===`);
    console.log('status:', s.status, '| updatedAt:', s.updatedAt?.toDate?.());
    console.log('imageUrl:', s.imageUrl);
    console.log('pipelineStages:', Object.keys(s.pipelineStages || {}));
    if (s.pipelineStages) for (const k of Object.keys(s.pipelineStages)) console.log(`  ${k}: ${s.pipelineStages[k]}`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
