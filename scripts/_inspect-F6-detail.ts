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
  
  // F6 RuXZlglP M01 v2 + M02 v4
  const shots = await db.collection('shots').where('jobId', '==', 'RuXZlglPjyYCvJ6XxDqZ').get();
  for (const d of shots.docs) {
    const s = d.data() as any;
    if (s.shotType !== 'M01' && s.shotType !== 'M02') continue;
    console.log(`\n=== ${s.shotType} v${s.version} (${d.id}) ===`);
    console.log('status:', s.status);
    console.log('updatedAt:', s.updatedAt?.toDate?.()?.toISOString?.());
    console.log('createdAt:', s.createdAt?.toDate?.()?.toISOString?.());
    console.log('teeEditApplied:', s.teeEditApplied);
    console.log('teeEditError:', s.teeEditError);
    console.log('seedreamModel:', s.seedreamModel);
    console.log('provider:', s.provider);
    console.log('pipelineStages keys:', Object.keys(s.pipelineStages || {}));
    console.log('error:', s.error);
    console.log('progressStep:', s.progressStep);
  }
  
  // Inspect Kate Boyfriend Jeans wardrobe
  const job = await db.collection('jobs').doc('RuXZlglPjyYCvJ6XxDqZ').get();
  const j = job.data() as any;
  console.log('\n=== Job wardrobe ===');
  console.log('modelId:', j.modelId);
  console.log('wardrobe:', JSON.stringify(j.wardrobe, null, 2));
  
  const w = await db.collection('wardrobe').doc(j.wardrobe.bottom.itemId).get();
  const wd = w.data() as any;
  console.log('\n=== Kate Boyfriend Jeans ===');
  console.log('name:', wd.name);
  console.log('description (first 500):', (wd.description||'').slice(0, 500));
  console.log('fitModels:', JSON.stringify(wd.fitModels, null, 2));
  console.log('flatBackUrl:', wd.flatBackUrl);
  
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
