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
  const cellId = `UWQztLuiruTWRgF0mO4H_F1`;
  const cs = await db.collection('qaShoeMatrix').doc(cellId).get();
  const cd = cs.data() as any;
  console.log('\nImages object:');
  console.log(JSON.stringify(cd.images, null, 2));
  console.log('\nThumbs:');
  console.log(JSON.stringify(cd.thumbs, null, 2));
  console.log('\nFit models bottom (front, back, etc):');
  const bottom = await db.collection('wardrobe').doc('vdOxwqzTUBch6ktkOgfY').get();
  console.log(JSON.stringify((bottom.data() as any)?.fitModels, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
