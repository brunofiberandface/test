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
  const ids = ['50i6W00eWwlNkYyTeuJx', 'FOeXAzcj7ak8WlJrNPly', 'HIMdMA24d4uMvzABlffK'];
  for (const id of ids) {
    const snap = await db.collection('shots').doc(id).get();
    const s = snap.data();
    console.log(`\n=== SHOT ${id} ===`);
    if (!s) { console.log('NOT FOUND'); continue; }
    console.log('keys:', Object.keys(s).sort().join(', '));
    console.log('shotType:', s.shotType, 'version:', s.version, 'status:', s.status);
    console.log('approved:', s.approved, 'wasApproved:', s.wasApproved);
    console.log('teeEdited:', s.teeEdited);
    console.log('imageUrl:', s.imageUrl);
    console.log('finalImageUrl:', s.finalImageUrl);
    console.log('updatedAt:', s.updatedAt?.toDate?.());
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
