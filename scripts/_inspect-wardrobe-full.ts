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
  
  const bottomId = 'vdOxwqzTUBch6ktkOgfY';
  const ws = await db.collection('wardrobe').doc(bottomId).get();
  const wd = ws.data() as any;
  console.log('Wardrobe doc keys:', Object.keys(wd).sort());
  // Print URL-related fields
  for (const k of Object.keys(wd)) {
    if (/url/i.test(k) || /fit/i.test(k) || /flat/i.test(k)) {
      const v = wd[k];
      if (typeof v === 'string') console.log(`  ${k}: ${v.slice(0, 150)}`);
      else if (Array.isArray(v)) console.log(`  ${k}: [${v.length}] ${JSON.stringify(v).slice(0, 200)}`);
      else console.log(`  ${k}:`, JSON.stringify(v).slice(0, 200));
    }
  }
  
  const cellId = `UWQztLuiruTWRgF0mO4H_F1`;
  const cs = await db.collection('qaShoeMatrix').doc(cellId).get();
  const cd = cs.data();
  if (cd) {
    console.log('\n\nMatrix cell keys:', Object.keys(cd).sort());
    for (const k of Object.keys(cd)) {
      if (/url|front|back|body|legs/i.test(k)) {
        const v = (cd as any)[k];
        if (typeof v === 'string') console.log(`  ${k}: ${v.slice(0, 150)}`);
        else if (Array.isArray(v)) console.log(`  ${k}: [${v.length}] ${JSON.stringify(v).slice(0, 250)}`);
        else console.log(`  ${k}:`, JSON.stringify(v).slice(0, 250));
      }
    }
  } else {
    console.log('\n\nNo matrix cell exists');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
