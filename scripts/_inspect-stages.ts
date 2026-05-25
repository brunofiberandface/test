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
  // j7Rn M02 = 50i6W00eWwlNkYyTeuJx, 0Ey M01 = FOeXAzcj7ak8WlJrNPly, 0Ey M02 = HIMdMA24d4uMvzABlffK
  const ids = ['50i6W00eWwlNkYyTeuJx', 'FOeXAzcj7ak8WlJrNPly', 'HIMdMA24d4uMvzABlffK'];
  for (const id of ids) {
    const snap = await db.collection('shots').doc(id).get();
    const s = snap.data() as any;
    console.log(`\n=== ${s.shotType} v${s.version} (${id}) job=${s.jobId} ===`);
    console.log('teeEditApplied:', s.teeEditApplied);
    console.log('provider:', s.provider, 'seedreamModel:', s.seedreamModel);
    console.log('promptRevision:', s.promptRevision);
    console.log('progressStep:', s.progressStep);
    if (s.pipelineStages) {
      console.log('pipelineStages keys:', Object.keys(s.pipelineStages));
      for (const k of Object.keys(s.pipelineStages)) {
        const v = s.pipelineStages[k];
        if (v && typeof v === 'object') {
          console.log(`  ${k}:`, JSON.stringify(v).slice(0, 200));
        } else {
          console.log(`  ${k}:`, v);
        }
      }
    }
    if (s.prompt) {
      console.log('\n--- prompt (first 500 chars) ---');
      console.log(String(s.prompt).slice(0, 500));
      console.log('--- prompt (last 300 chars) ---');
      console.log(String(s.prompt).slice(-300));
      console.log('prompt total length:', String(s.prompt).length);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
