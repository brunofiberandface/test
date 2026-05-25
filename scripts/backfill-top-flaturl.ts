/**
 * B1: Backfill top item kP9CgnGLwOaJiUrFdJFE (F6 Kate Boyfriend job's "boxy
 * black tee") with a flatFrontUrl derived from its fitmodel_front.jpg.
 *
 * The strip-paint step (paintTeeHemStrip) skips silently when top.flatUrl is
 * missing. F6's tee uploaded with empty flatFrontUrl, so M02 reruns came out
 * with bare midriff. Backfilling here so the existing code path finds a URL
 * to fetch. (B2 in the same change set adds a code-level fitModels fallback
 * for any future cases.)
 */
import * as fs from 'fs';
import * as path from 'path';

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

const ITEM_ID = 'kP9CgnGLwOaJiUrFdJFE';

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const ref = db.collection('wardrobe').doc(ITEM_ID);
  const snap = await ref.get();
  const d = snap.data() as any;
  if (!d) { console.error(`Item ${ITEM_ID} not found`); process.exit(1); }

  console.log(`Item: ${d.name} (${d.category})`);
  console.log(`Current flatFrontUrl: ${JSON.stringify(d.flatFrontUrl)}`);
  console.log(`Current fitModels.front: ${d.fitModels?.front || '(none)'}`);

  const fitFront = d.fitModels?.front;
  if (!fitFront) { console.error(`No fitModels.front to backfill from`); process.exit(1); }

  if (d.flatFrontUrl && d.flatFrontUrl.length > 0) {
    console.log(`flatFrontUrl already set — no backfill needed`);
    process.exit(0);
  }

  // Backfill flatFrontUrl with the fit-model image. Not a true flat, but a
  // useful reference for the strip-paint step (Gemini gets visual of the tee).
  await ref.update({
    flatFrontUrl: fitFront,
    backfilledFlatUrlFromFitModel: true,  // audit flag
    updatedAt: new Date(),
  });
  console.log(`✓ Backfilled flatFrontUrl = ${fitFront}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
