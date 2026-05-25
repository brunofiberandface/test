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
  const w = (await db.collection('wardrobe').doc('vTp2w3mYxytGaAflfG1r').get()).data() as any;
  console.log('=== silhouetteFront ===');
  console.log(w?.silhouetteFront || '(none)');
  console.log('\n\n=== silhouetteBack ===');
  console.log(w?.silhouetteBack || '(none)');
  console.log('\n\n=== description ===');
  console.log(w?.description);
  console.log('\n\n=== fitModels ===');
  console.log(JSON.stringify(w?.fitModels, null, 2));
  console.log('flatFrontUrl:', w?.flatFrontUrl);
  console.log('flatBackUrl:', w?.flatBackUrl);
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
