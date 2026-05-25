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
import { Storage } from '@google-cloud/storage';
async function main() {
  const sa = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({ projectId: sa.project_id, credentials: { client_email: sa.client_email, private_key: sa.private_key } });
  const storage = new Storage({ projectId: sa.project_id, credentials: { client_email: sa.client_email, private_key: sa.private_key } });
  const ids = ['3xKezovO6eef7SJfMioC', 'xaVs4I5KFQKq5AEq5m6I', 'C0QleJPtkd58NRiHhPES'];
  for (const id of ids) {
    const w = (await db.collection('wardrobe').doc(id).get()).data() as any;
    console.log(`\n=== ${w.name} (${id}) ===`);
    console.log(`flatFrontUrl: ${w.flatFrontUrl || '-'}`);
    console.log(`flatBackUrl: ${w.flatBackUrl || '-'}`);
    // List all files in the shoe's GCS folder
    const [files] = await storage.bucket('gstar-ai-studio-assets').getFiles({ prefix: `wardrobe/shoes/${id}/` });
    console.log(`Files in GCS (${files.length}):`);
    for (const f of files) console.log(`  ${f.name.split('/').pop()}`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
