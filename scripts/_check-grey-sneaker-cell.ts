import * as fs from 'fs';
import * as path from 'path';
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');
import { Firestore } from '@google-cloud/firestore';
async function main() {
  const sa = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({ projectId: sa.project_id, credentials: { client_email: sa.client_email, private_key: sa.private_key } });
  const cellId = 'xaVs4I5KFQKq5AEq5m6I_F3';
  const c = (await db.collection('qaShoeMatrix').doc(cellId).get()).data() as any;
  console.log(`Cell ${cellId}: ${c ? 'EXISTS' : 'MISSING'}`);
  if (c) {
    console.log('status:', c.status);
    console.log('viewsCompleted:', c.viewsCompleted);
    if (c.images) {
      for (const k of Object.keys(c.images)) console.log(`  ${k}: ${c.images[k] ? 'set' : 'missing'}`);
    }
  }
  process.exit(0);
}
main().catch(()=>process.exit(1));
