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
  
  // Find ACTIVE M01 seedream + M02 seedream
  const m01 = await db.collection('promptVault').where('shotType', '==', 'M01').where('pipeline', '==', 'seedream').get();
  const m02 = await db.collection('promptVault').where('shotType', '==', 'M02').where('pipeline', '==', 'seedream').get();
  
  console.log('M01 seedream entries (sorted by revision desc):');
  const m01sorted = m01.docs.map(d => ({ id: d.id, ...(d.data() as any) })).sort((a,b)=>(b.revision??0)-(a.revision??0));
  for (const e of m01sorted.slice(0, 5)) {
    console.log(`  rev ${e.revision} | active=${e.active} | id=${e.id} | created=${e.createdAt?.toDate?.()}`);
  }
  console.log('\nM02 seedream entries (sorted by revision desc):');
  const m02sorted = m02.docs.map(d => ({ id: d.id, ...(d.data() as any) })).sort((a,b)=>(b.revision??0)-(a.revision??0));
  for (const e of m02sorted.slice(0, 5)) {
    console.log(`  rev ${e.revision} | active=${e.active} | id=${e.id} | created=${e.createdAt?.toDate?.()}`);
  }
  
  // Show the M01 rev 20 prompt (what was used)
  const m01rev20 = m01.docs.find(d => (d.data() as any).revision === 20);
  if (m01rev20) {
    const p = m01rev20.data() as any;
    console.log('\n=== M01 rev 20 prompt ===');
    console.log('Length:', (p.prompt || '').length);
    console.log(p.prompt || '(empty)');
    console.log('=== END ===');
  } else {
    console.log('\nNo M01 rev 20 found!');
    console.log('Latest M01:', m01sorted[0]?.revision);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
