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
  
  const jobIds = ['0EyHGxBIcNUJN6jbr0Ad', 'j7RnJwgHfCTfEzgTXjpI'];
  for (const id of jobIds) {
    const snap = await db.collection('jobs').doc(id).get();
    const j = snap.data() as any;
    console.log(`\n=== JOB ${id} ===`);
    console.log('jobName:', j.jobName);
    console.log('modelId:', j.modelId);
    console.log('wardrobe:', JSON.stringify(j.wardrobe, null, 2));
    
    // Get the bottom item
    const w = j.wardrobe || {};
    const bottomId = w.bottom?.itemId;
    if (bottomId) {
      const ws = await db.collection('wardrobe').doc(bottomId).get();
      const wd = ws.data() as any;
      console.log(`\n  Bottom (${bottomId}): ${wd?.name}`);
      console.log('  fitFrontUrl:', wd?.fitFrontUrl);
      console.log('  fitBackUrl:', wd?.fitBackUrl);
      console.log('  fitFrontUrls:', wd?.fitFrontUrls);
      console.log('  fitBackUrls:', wd?.fitBackUrls);
      console.log('  flatFrontUrl:', wd?.flatFrontUrl);
      console.log('  silhouetteFront (first 300):', (wd?.silhouetteFront || '').slice(0, 300));
    }
    // Find matrix cell
    const shoeId = w.shoe?.itemId;
    if (shoeId) {
      const cellId = `${shoeId}_${j.modelId}`;
      const cs = await db.collection('qaShoeMatrix').doc(cellId).get();
      const cd = cs.data() as any;
      console.log(`\n  Matrix cell ${cellId}:`);
      if (cd) {
        console.log('    fullBodyFront:', cd?.fullBodyFront);
        console.log('    fullBodyBack:', cd?.fullBodyBack);
        console.log('    fullBodyFrontUrls:', cd?.fullBodyFrontUrls);
      } else {
        console.log('    NO CELL');
      }
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
