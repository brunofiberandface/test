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
  const w = await db.collection('wardrobe').doc('kP9CgnGLwOaJiUrFdJFE').get();
  const d = w.data() as any;
  console.log('kP9CgnGLwOaJiUrFdJFE keys:', Object.keys(d).sort().join(', '));
  for (const k of Object.keys(d)) {
    if (/url|flat|fit|thumb|image/i.test(k)) {
      const v = d[k];
      if (typeof v === 'string') console.log(`  ${k}: ${v.slice(0, 200)}`);
      else if (Array.isArray(v)) console.log(`  ${k}: [${v.length}] ${JSON.stringify(v).slice(0, 200)}`);
      else console.log(`  ${k}:`, JSON.stringify(v).slice(0, 200));
    }
  }
  console.log('\nname:', d.name);
  console.log('description:', (d.description||'').slice(0, 200));
  console.log('category:', d.category);
  
  // Try to list GCS files for this item
  const { Storage } = await import('@google-cloud/storage');
  const storage = new Storage({ projectId: 'gstar-ai-studio', credentials: { client_email: saKey.client_email, private_key: saKey.private_key } });
  const [files] = await storage.bucket('gstar-ai-studio-assets').getFiles({ prefix: 'wardrobe/top/kP9CgnGLwOaJiUrFdJFE/' });
  console.log(`\n${files.length} files in GCS:`);
  for (const f of files) console.log(`  ${f.name} (${f.metadata.size}B)`);
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
