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
  const job = (await db.collection('jobs').doc('AfSmRKxuKvaV4jXsLFcY').get()).data() as any;
  console.log('=== JOB AfSmRKxuKvaV4jXsLFcY ===');
  console.log('jobName:', job?.jobName);
  console.log('status:', job?.status);
  console.log('awaitingCell:', JSON.stringify(job?.awaitingCell));
  console.log('modelId:', job?.modelId);
  console.log('wardrobe:', JSON.stringify(job?.wardrobe, null, 2));
  console.log('createdAt:', job?.createdAt?.toDate?.());
  console.log('updatedAt:', job?.updatedAt?.toDate?.());

  // Cell check
  const shoeId = job?.wardrobe?.shoe?.itemId;
  if (shoeId && job?.modelId) {
    const cellId = `${shoeId}_${job.modelId}`;
    const cell = (await db.collection('qaShoeMatrix').doc(cellId).get()).data() as any;
    console.log(`\n=== Cell ${cellId} ===`);
    if (!cell) { console.log('NO CELL EXISTS'); }
    else {
      console.log('status:', cell.status, '| blocked:', cell.blocked, '| archived:', cell.archived);
      console.log('viewsCompleted:', cell.viewsCompleted);
      console.log('imageUrl:', cell.imageUrl ? cell.imageUrl.slice(-100) : 'unset');
      if (cell.images) {
        for (const k of Object.keys(cell.images)) console.log(`  ${k}: ${cell.images[k] ? 'set' : 'MISSING'}`);
      } else { console.log('NO images map'); }
    }
  }

  const shots = await db.collection('shots').where('jobId', '==', 'AfSmRKxuKvaV4jXsLFcY').get();
  console.log(`\n${shots.size} shots:`);
  for (const d of shots.docs.sort((a,b)=>(a.data() as any).shotType.localeCompare((b.data() as any).shotType))) {
    const s = d.data() as any;
    console.log(`  ${s.shotType} v${s.version} ${s.status} | err=${s.error || '-'}`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
