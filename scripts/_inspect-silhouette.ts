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
  
  // Bowey Barrel = j7Rn job's bottom (Rq3K3UQGdJmVu4W0LwgK)
  // Midge Slim Straight = 0Ey job's bottom (vdOxwqzTUBch6ktkOgfY)
  for (const [name, id] of [['Bowey Barrel', 'Rq3K3UQGdJmVu4W0LwgK'], ['Midge Slim Straight', 'vdOxwqzTUBch6ktkOgfY']]) {
    const ws = await db.collection('wardrobe').doc(id).get();
    const wd = ws.data() as any;
    console.log(`\n========== ${name} ==========`);
    console.log('name:', wd.name);
    console.log('description:', (wd.description||'').slice(0, 500));
    console.log('\n--- silhouetteFront ---');
    console.log(wd.silhouetteFront);
    console.log('\n--- silhouetteBack ---');
    console.log(wd.silhouetteBack);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
