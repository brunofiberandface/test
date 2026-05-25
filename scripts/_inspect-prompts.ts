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
  // M01 twin shot, M02 j7Rn 
  const ids = ['FOeXAzcj7ak8WlJrNPly', '50i6W00eWwlNkYyTeuJx'];
  for (const id of ids) {
    const snap = await db.collection('shots').doc(id).get();
    const s = snap.data() as any;
    console.log(`\n========== ${s.shotType} v${s.version} (${id}) ==========`);
    console.log('promptRevision:', s.promptRevision);
    console.log('=== FULL PROMPT ===');
    console.log(s.prompt || '(no prompt stored)');
    console.log('=== END PROMPT ===');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
