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
  const wardrobe = await db.collection('wardrobe').get();
  const wanted = [/white.*leather.*low.*top.*sneaker/i, /contor.*3d.*wide/i, /judee.*low.*waist.*loose/i, /midge.*bootcut/i];
  console.log(`Scanning ${wardrobe.size} wardrobe items…\n`);
  for (const d of wardrobe.docs) {
    const w = d.data() as any;
    const name = (w.name as string) || '';
    if (wanted.some(re => re.test(name))) {
      console.log(`[${w.category}] ${name}`);
      console.log(`  id: ${d.id}`);
      console.log(`  flatFrontUrl: ${w.flatFrontUrl ? w.flatFrontUrl.slice(-80) : '-'}`);
      console.log(`  flatBackUrl: ${w.flatBackUrl ? w.flatBackUrl.slice(-80) : '-'}`);
      const fm = w.fitModels || {};
      const fmKeys = Object.keys(fm);
      console.log(`  fitModels: ${fmKeys.join(', ') || '(none)'}`);
      console.log();
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
