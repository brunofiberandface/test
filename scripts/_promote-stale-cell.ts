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

  // Scan ALL cells in 'batch-pending' that actually have 4 views populated.
  // Promote them to 'done' so awaiting-matrix jobs unblock. This is the
  // systemic fix Bruno: there are likely MORE stale cells beyond the one
  // job he's looking at. Safe operation — only promotes cells that are
  // genuinely complete (4 views + 4 image URLs).
  const VIEWS = ['fullBodyFront', 'fullBodyBack', 'legsFront', 'legsBack'] as const;
  const snap = await db.collection('qaShoeMatrix').where('status', '==', 'batch-pending').get();
  console.log(`Found ${snap.size} cells with status='batch-pending'`);

  let promoted = 0;
  let still_partial = 0;
  for (const d of snap.docs) {
    const c = d.data() as any;
    const completed = new Set<string>(c.viewsCompleted || []);
    const allImages = VIEWS.every(v => completed.has(v) && c.images?.[v]);
    if (allImages) {
      await d.ref.update({ status: 'done', updatedAt: new Date() });
      promoted++;
      console.log(`✓ ${d.id} → done`);
    } else {
      still_partial++;
      const missing = VIEWS.filter(v => !completed.has(v) || !c.images?.[v]);
      console.log(`  ${d.id} still partial (missing: ${missing.join(', ')})`);
    }
  }
  console.log(`\nPromoted ${promoted}, still partial ${still_partial}`);
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
