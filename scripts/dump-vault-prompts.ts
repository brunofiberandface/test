/**
 * Pull each prompt from promptVault by shotType + revision number,
 * for a specific job's shots.
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
  const jobId = process.argv[2];
  if (!jobId) { console.error('usage: dump-vault-prompts.ts <jobId>'); process.exit(1); }

  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const jobDoc = await db.collection('jobs').doc(jobId).get();
  if (!jobDoc.exists) { console.error('Job not found'); process.exit(1); }
  const job = jobDoc.data() as any;
  console.log(`Job: ${job.jobName}, provider=${job.provider}\n`);

  const shotsSnap = await db.collection('shots').where('jobId', '==', jobId).get();
  const sorted = shotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any))
    .sort((a, b) => (a.shotType || '').localeCompare(b.shotType || ''));

  for (const s of sorted) {
    const rev = s.promptRevision;
    console.log(`\n================================================================`);
    console.log(`=== ${s.shotType} (shotVersion v${s.version}, promptRevision rev${rev}) ===`);
    console.log(`================================================================`);

    // Look up promptVault entry for this shotType + revision
    // The vault key uses `revision` field
    const vaultSnap = await db.collection('promptVault')
      .where('shotType', '==', s.shotType)
      .where('revision', '==', rev)
      .get();

    if (vaultSnap.empty) {
      console.log(`(no vault entry found for shotType=${s.shotType} revision=${rev})`);
      // Fallback: try without revision constraint, list available
      const altSnap = await db.collection('promptVault')
        .where('shotType', '==', s.shotType)
        .orderBy('revision', 'desc')
        .limit(5)
        .get();
      console.log(`Recent ${s.shotType} revisions in vault:`);
      altSnap.docs.forEach(d => {
        const data = d.data() as any;
        console.log(`  rev${data.revision} id=${d.id} isActive=${data.isActive} pipeline=${data.pipeline || '?'} category=${data.category || '?'}`);
      });
      continue;
    }

    for (const v of vaultSnap.docs) {
      const data = v.data() as any;
      console.log(`\nvault doc ${v.id} (pipeline=${data.pipeline || '?'}, category=${data.category || '?'}, isActive=${data.isActive})`);
      const pf = ['promptText', 'prompt', 'content', 'text', 'body'];
      let printed = false;
      for (const f of pf) {
        if (typeof data[f] === 'string' && data[f].length > 0) {
          console.log(`\n--- ${f} (${data[f].length} chars) ---`);
          console.log(data[f]);
          printed = true;
        }
      }
      if (!printed) {
        console.log(`(no text field found — fields: ${Object.keys(data).join(', ')})`);
      }
    }
  }
}

main().catch(e=>{console.error(e); process.exit(1)});
