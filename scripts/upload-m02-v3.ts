/**
 * Upload matrix-m02-seedream-v2.md to vault as rev 24, set isActive=true.
 * Deactivates rev 23 in the same batch.
 *
 * Run: npx tsx scripts/upload-m02-v2.ts
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

import { Firestore, FieldValue } from '@google-cloud/firestore';

const FILE_PATH = path.join(projectRoot, 'prompts/matrix/matrix-m02-seedream-v3.md');
const SHOT_TYPE = 'M02';
const PIPELINE = 'seedream';

function extractSection(md: string, sectionHeader: string): string | null {
  const headerIdx = md.indexOf(sectionHeader);
  if (headerIdx === -1) return null;
  const after = md.substring(headerIdx + sectionHeader.length);
  const fence = after.indexOf('```');
  if (fence === -1) return null;
  const afterFence = after.substring(fence + 3);
  const end = afterFence.indexOf('\n```');
  if (end === -1) return null;
  return afterFence.substring(0, end).trim();
}

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const content = fs.readFileSync(FILE_PATH, 'utf-8');
  console.log(`Loaded ${FILE_PATH}: ${content.length} chars`);

  const generationPrompt = extractSection(content, '## Step 2 Prompt');
  if (!generationPrompt) {
    console.error('Could not extract generation prompt from Step 2 Prompt section');
    process.exit(1);
  }
  console.log(`Generation prompt extracted: ${generationPrompt.length} chars`);

  // Find current max revision for M02 seedream
  const existing = await db.collection('promptVault')
    .where('shotType', '==', SHOT_TYPE)
    .where('pipeline', '==', PIPELINE)
    .get();

  const maxRev = existing.docs.reduce((max, d) => Math.max(max, (d.data() as any).revision || 0), 0);
  const newRev = maxRev + 1;
  console.log(`Current max ${SHOT_TYPE} ${PIPELINE} rev: ${maxRev} → uploading as rev ${newRev}`);

  // Deactivate all currently-active M02 seedream prompts
  const batch = db.batch();
  let deactivated = 0;
  for (const d of existing.docs) {
    if ((d.data() as any).isActive === true) {
      batch.update(d.ref, { isActive: false });
      console.log(`  Deactivating rev ${(d.data() as any).revision} (${d.id})`);
      deactivated++;
    }
  }

  // Insert new revision
  const newDoc = db.collection('promptVault').doc();
  batch.set(newDoc, {
    shotType: SHOT_TYPE,
    pipeline: PIPELINE,
    revision: newRev,
    content,
    generationPrompt,
    filename: path.basename(FILE_PATH),
    isActive: true,
    isAlternative: false,
    uploadedAt: FieldValue.serverTimestamp(),
    uploadedBy: 'claude-test-rerun',
  });

  await batch.commit();
  console.log(`\n✓ Uploaded rev ${newRev} (id=${newDoc.id}), deactivated ${deactivated} prior active rev(s)`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
