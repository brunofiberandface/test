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
  // Inspect vault entries
  const vaultSnap = await db.collection('promptVault').get();
  console.log(`Total ${vaultSnap.size} vault entries`);
  for (const d of vaultSnap.docs) {
    const v = d.data() as any;
    if (!v.shotType?.startsWith('M0')) continue;
    console.log(`  ${d.id} | shotType=${v.shotType} | pipeline=${v.pipeline} | active=${v.active} | revision=${v.revision} | name=${v.name}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
