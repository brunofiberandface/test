import * as path from 'path';
import * as fs from 'fs';
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
  const shoes = await db.collection('wardrobe').where('category', '==', 'shoes').get();
  const want = [/white.*leather.*low.*top.*sneaker/i, /grey.*sneaker/i, /(ankle.*boot.*brown.*suede|brown.*suede.*ankle.*boot)/i];
  for (const d of shoes.docs) {
    const w = d.data() as any;
    if (want.some(re => re.test(w.name || ''))) {
      console.log(`${w.name}`);
      console.log(`  id: ${d.id}`);
      console.log(`  flatFrontUrl: ${w.flatFrontUrl || '-'}`);
      console.log(`  flatBackUrl: ${w.flatBackUrl || '-'}`);
      console.log(`  fitModels: ${JSON.stringify(w.fitModels)}`);
      console.log();
    }
  }
  process.exit(0);
}
main().catch(()=>process.exit(1));
