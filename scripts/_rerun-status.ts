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
  const ids = ['j7RnJwgHfCTfEzgTXjpI', '0EyHGxBIcNUJN6jbr0Ad', 'RuXZlglPjyYCvJ6XxDqZ', 'lKvJ5JlcmvRBqonnNl8P', 'FXulcOtwRE2T7HNM3vJD'];
  for (const id of ids) {
    const job = (await db.collection('jobs').doc(id).get()).data() as any;
    const shotsSnap = await db.collection('shots').where('jobId', '==', id).get();
    const summary: Record<string, string> = {};
    for (const d of shotsSnap.docs) { const s = d.data() as any; summary[s.shotType] = `v${s.version}/${s.status}`; }
    console.log(`${id} (${job?.jobName?.slice(0,30)}): status=${job?.status} | shots: ${JSON.stringify(summary)}`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
