/**
 * Pull CONTOR 3D WIDE WMN's silhouette text from the wardrobe doc.
 * The silhouette is the per-garment text injected at {silhouette} in M04.
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
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const ids = ['ZB2GMhoH1hQDjdJQbD6d']; // CONTOR
  for (const id of ids) {
    const doc = await db.collection('wardrobe').doc(id).get();
    if (!doc.exists) { console.log(`${id}: NOT FOUND`); continue; }
    const w = doc.data() as any;
    console.log(`\n=== ${w.name} (${id}) ===`);
    console.log(`category: ${w.category}, garmentType: ${w.garmentType}`);
    console.log(`flatFrontUrl: ${w.flatFrontUrl ? '✓' : '✗'}`);
    console.log(`flatBackUrl: ${w.flatBackUrl ? '✓' : '✗'}`);
    console.log(`fitModels.front: ${w.fitModels?.front ? '✓' : '✗'}`);
    console.log(`fitModels.back: ${w.fitModels?.back ? '✓' : '✗'}`);
    console.log(`\nAll fields: ${Object.keys(w).join(', ')}`);

    // Print silhouette-like fields
    for (const f of ['silhouetteFront', 'silhouetteBack', 'description']) {
      if (w[f] && typeof w[f] === 'string' && w[f].length > 0) {
        console.log(`\n--- ${f} (${w[f].length} chars) ---`);
        console.log(w[f]);
      }
    }
  }
}
main().catch(e=>{console.error(e); process.exit(1)});
