/**
 * Read-only: dump fit-model + flat URLs + silhouetteBack for a wardrobe bottom.
 * Used to verify whether the cached silhouette description includes
 * garment-specific features (e.g. rolled-up hem) before debugging downstream.
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
  const id = process.argv[2];
  if (!id) { console.error('usage: inspect-wardrobe-bottom.ts <wardrobeId>'); process.exit(1); }

  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const doc = await db.collection('wardrobe').doc(id).get();
  if (!doc.exists) { console.error('not found'); process.exit(2); }
  const item = doc.data() as any;

  console.log(`name: ${item.name}`);
  console.log(`designNumber: ${item.designNumber}`);
  console.log(`description: ${item.description}`);
  console.log(`category: ${item.category}, gender: ${item.gender}`);
  console.log(`flatFront: ${item.flatFrontUrl || '(none)'}`);
  console.log(`flatBack: ${item.flatBackUrl || '(none)'}`);
  for (const k of ['front', 'front45Left', 'front45Right', 'back', 'back45Left', 'back45Right']) {
    console.log(`fitModels.${k}: ${item.fitModels?.[k] || '(none)'}`);
  }
  console.log(`silhouetteAnalyzedAt: ${item.silhouetteAnalyzedAt?.toDate?.() || item.silhouetteAnalyzedAt}`);
  if (item.silhouetteFront) {
    console.log(`\n--- silhouetteFront (${item.silhouetteFront.length} chars) ---`);
    console.log(item.silhouetteFront);
  }
  if (item.silhouetteBack) {
    console.log(`\n--- silhouetteBack (${item.silhouetteBack.length} chars) ---`);
    console.log(item.silhouetteBack);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
