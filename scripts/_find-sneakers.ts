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
  const shoes = await db.collection('wardrobe').where('category', '==', 'shoe').get();
  console.log(`${shoes.size} shoes total\n`);
  // Filter to white/light + sneaker/low-top keywords + female
  for (const d of shoes.docs) {
    const w = d.data() as any;
    const name = ((w.name || '') as string).toLowerCase();
    const desc = ((w.description || '') as string).toLowerCase();
    const isWhite = /white|cream|ivory|bone/.test(name + ' ' + desc);
    const isSneaker = /sneaker|trainer|low.*top|low-top/.test(name + ' ' + desc);
    if (isSneaker && isWhite) {
      console.log(`${w.name}`);
      console.log(`  id: ${d.id}`);
      console.log(`  gender: ${w.gender || '?'} | openShoes: ${w.openShoes}`);
      console.log(`  description: ${(w.description || '').slice(0, 120)}`);
      console.log();
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
