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
  for (const st of ['M01', 'M02']) {
    const snap = await db.collection('promptVault').where('shotType', '==', st).where('pipeline', '==', 'seedream').where('isActive', '==', true).get();
    console.log(`\n=== Active ${st} seedream ===`);
    for (const d of snap.docs) {
      const v = d.data() as any;
      console.log(`rev ${v.revision} | ${v.filename} | gen prompt len: ${(v.generationPrompt || '').length}`);
      console.log('--- HEAD (first 400 chars) ---');
      console.log((v.generationPrompt || '').slice(0, 400));
      console.log('--- TAIL (last 200 chars) ---');
      console.log((v.generationPrompt || '').slice(-200));
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
