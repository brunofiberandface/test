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
  
  const all = await db.collection('promptVault').where('shotType', '==', 'M06').get();
  console.log(`M06 entries: ${all.size}`);
  const sorted = all.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a,b)=>(b.revision??0)-(a.revision??0));
  for (const e of sorted.slice(0, 8)) {
    console.log(`  rev ${e.revision} | isActive=${e.isActive} | pipeline=${e.pipeline} | ${e.filename} | gen=${(e.generationPrompt||'').length}`);
  }
  
  const active = sorted.find(e => e.isActive === true && e.pipeline === 'seedream');
  if (active) {
    console.log(`\n=== ACTIVE M06 seedream rev ${active.revision} ===`);
    console.log('--- HEAD (first 800) ---');
    console.log((active.generationPrompt || '').slice(0, 800));
    console.log('\n--- TAIL (last 500) ---');
    console.log((active.generationPrompt || '').slice(-500));
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
