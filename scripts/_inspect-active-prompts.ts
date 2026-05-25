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

  for (const id of ['QKqSvSK2AFOlEYnp6rOk', '4h7Lcog2CvuAYO25p4js']) {
    const snap = await db.collection('promptVault').doc(id).get();
    const d = snap.data() as any;
    console.log(`\n========== ${d.shotType} rev ${d.revision} (${d.filename}) ==========`);
    const content = d.content || d.generationPrompt || '';
    console.log('Length:', content.length);
    console.log(content);
    console.log(`========== END ==========`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
