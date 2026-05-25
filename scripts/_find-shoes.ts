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
  const all = await db.collection('wardrobe').get();
  const cats: Record<string, number> = {};
  for (const d of all.docs) {
    const c = (d.data() as any).category || '(none)';
    cats[c] = (cats[c] || 0) + 1;
  }
  console.log('Categories:', cats);
  // Look for shoes by name
  console.log('\nWhite/low-top items by name:');
  for (const d of all.docs) {
    const w = d.data() as any;
    const name = ((w.name || '') as string);
    if (/sneaker|low.top|low-top/i.test(name)) {
      console.log(`  [${w.category}] ${name} (id=${d.id}, openShoes=${w.openShoes}, hasHeels=${w.hasHeels})`);
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
