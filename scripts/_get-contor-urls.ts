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
  const w = (await db.collection('wardrobe').doc('ZB2GMhoH1hQDjdJQbD6d').get()).data() as any;
  console.log('CONTOR fit-model back:', w.fitModels?.back);
  console.log('CONTOR hem-front section:', (w.silhouetteFront || '').match(/HEM-TO-GROUND[^\n]*\n([\s\S]{0,600})/i)?.[1]?.slice(0, 500) || '(none)');
  console.log('\nCONTOR hem-back section:', (w.silhouetteBack || '').match(/HEM-TO-GROUND[^\n]*\n([\s\S]{0,600})/i)?.[1]?.slice(0, 500) || '(none)');
  process.exit(0);
}
main().catch(()=>process.exit(1));
