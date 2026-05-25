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
  
  // Show full fields of M01 rev 20 and M01 rev 21
  for (const id of ['NGku8UHsshmiaTrDFOab', 'QKqSvSK2AFOlEYnp6rOk']) {
    const snap = await db.collection('promptVault').doc(id).get();
    const d = snap.data() as any;
    console.log(`\n=== ${id} ===`);
    console.log('Keys:', Object.keys(d).sort());
    for (const k of Object.keys(d).sort()) {
      const v = d[k];
      if (typeof v === 'string' && v.length > 200) {
        console.log(`  ${k}: (${v.length} chars) ${v.slice(0, 150)}...`);
      } else if (v && typeof v === 'object' && v.toDate) {
        console.log(`  ${k}: ${v.toDate().toISOString()}`);
      } else {
        console.log(`  ${k}:`, JSON.stringify(v));
      }
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
