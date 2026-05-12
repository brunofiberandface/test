/**
 * Read-only: inspect a job + its shots for tee/garment issues.
 */
import * as path from 'path';
import * as fs from 'fs';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  const c = fs.readFileSync(envPath, 'utf-8');
  for (const line of c.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { Firestore } from '@google-cloud/firestore';

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) { console.error('usage: inspect-job-shots.ts <jobId> [<jobId> ...]'); process.exit(1); }

  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  for (const id of ids) {
    const jobDoc = await db.collection('jobs').doc(id).get();
    if (!jobDoc.exists) { console.log(`\n=== ${id}: NOT FOUND ===`); continue; }
    const job = jobDoc.data() as any;
    console.log(`\n=== ${id} — ${job.jobName || '?'} ===`);
    console.log(`  status: ${job.status}, createdAt: ${(job.createdAt?.toDate?.() || job.createdAt) }`);
    console.log(`  provider: ${job.provider || '(default)'}`);

    const w = job.wardrobe || {};
    for (const cat of ['shoe', 'top', 'bottom']) {
      const slot = w[cat];
      if (!slot?.itemId) { console.log(`  wardrobe.${cat}: MISSING`); continue; }
      const itemDoc = await db.collection('wardrobe').doc(slot.itemId).get();
      if (!itemDoc.exists) { console.log(`  wardrobe.${cat}.itemId=${slot.itemId} → ITEM DELETED`); continue; }
      const item = itemDoc.data() as any;
      const flatFront = item.flatFrontUrl ? '✓' : '✗';
      const flatBack = item.flatBackUrl ? '✓' : '✗';
      const fitFront = item.fitModels?.front ? '✓' : '✗';
      const fitBack = item.fitModels?.back ? '✓' : '✗';
      const desc = (item.topDescription || item.description || '').slice(0, 60);
      console.log(`  wardrobe.${cat}: "${item.name?.slice(0, 50)}" focus=${slot.isFocus}`);
      console.log(`    flatFront=${flatFront} flatBack=${flatBack} fitFront=${fitFront} fitBack=${fitBack}`);
      if (cat === 'top') console.log(`    topDescription: "${desc}..."`);
    }

    const shotsSnap = await db.collection('shots').where('jobId', '==', id).get();
    console.log(`  shots (${shotsSnap.size}):`);
    for (const sd of shotsSnap.docs) {
      const s = sd.data() as any;
      console.log(`    ${s.shotType}${s.variant && s.variant !== 'A' ? '-' + s.variant : ''}: status=${s.status} v${s.version || 1}` +
        (s.teeEditApplied !== undefined ? ` teeEdit=${s.teeEditApplied}` : '') +
        (s.teeEditError ? ` ERR="${String(s.teeEditError).slice(0, 80)}"` : '') +
        (s.error ? ` SHOT_ERR="${String(s.error).slice(0, 80)}"` : ''));
      if (s.imageUrl) console.log(`      imageUrl: ${s.imageUrl}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
