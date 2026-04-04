/**
 * Seed the Prompt Vault with the 5 validated generation guides (M01-M05).
 * Run: npx tsx scripts/seed-prompt-vault.ts
 *
 * Requires: .env.local with GCP credentials available.
 * Must be run from the gstar-studio project root.
 */

import * as fs from 'fs';
import * as path from 'path';

const GUIDES_DIR = path.resolve(__dirname, '../../test111/generation guides');

const GUIDES = [
  { file: 'M01_CROPPED_FRONT_GENERATION_GUIDE.md', shotType: 'M01' },
  { file: 'M02_CROPPED_BACK_GENERATION_GUIDE.md', shotType: 'M02' },
  { file: 'M03_GENERATION_GUIDE.md', shotType: 'M03' },
  { file: 'M04_GENERATION_GUIDE.md', shotType: 'M04' },
  { file: 'M05_DETAIL_GENERATION_GUIDE.md', shotType: 'M05' },
];

async function seed() {
  // Load sa_key.json directly and init Firestore with explicit credentials
  const projectRoot = path.resolve(__dirname, '..');
  const saKeyPath = path.join(projectRoot, 'sa_key.json');

  if (!fs.existsSync(saKeyPath)) {
    console.error('sa_key.json not found at', saKeyPath);
    process.exit(1);
  }

  const { Firestore } = await import('@google-cloud/firestore');
  const saKey = JSON.parse(fs.readFileSync(saKeyPath, 'utf-8'));

  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: {
      client_email: saKey.client_email,
      private_key: saKey.private_key,
    },
  });

  const promptVaultCol = db.collection('promptVault');

  // Inline uploadPromptFile — avoids needing the full firestore module import
  async function uploadPromptFile(data: {
    filename: string;
    shotType: string;
    content: string;
    gcsUrl: string;
    uploadedBy: string;
    silhouettePrompt?: string;
    generationPrompt?: string;
  }): Promise<{ id: string; revision: number }> {
    const snap = await promptVaultCol
      .where('shotType', '==', data.shotType)
      .orderBy('revision', 'desc')
      .limit(1)
      .get();
    const latestRevision = snap.empty ? 0 : (snap.docs[0].data().revision || 0);
    const newRevision = latestRevision + 1;

    // Deactivate previous active
    const activeSnap = await promptVaultCol
      .where('shotType', '==', data.shotType)
      .where('isActive', '==', true)
      .get();
    const batch = db.batch();
    activeSnap.docs.forEach(doc => batch.update(doc.ref, { isActive: false }));

    const ref = promptVaultCol.doc();
    // Strip undefined values — Firestore rejects them
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined)
    );
    batch.set(ref, {
      id: ref.id,
      ...cleanData,
      revision: newRevision,
      isActive: true,
      uploadedAt: new Date(),
    });
    await batch.commit();
    return { id: ref.id, revision: newRevision };
  }

  console.log('Seeding Prompt Vault...\n');

  for (const guide of GUIDES) {
    const filePath = path.join(GUIDES_DIR, guide.file);

    if (!fs.existsSync(filePath)) {
      console.log(`  SKIP  ${guide.shotType} — file not found: ${filePath}`);
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    // Extract prompts
    const silhouettePrompt = extractPromptSection(content, '## Step 1 Prompt');
    const generationPrompt = extractPromptSection(content, '## Step 2 Prompt')
      || extractPromptSection(content, '## Prompt');

    try {
      const result = await uploadPromptFile({
        filename: guide.file,
        shotType: guide.shotType,
        content,
        gcsUrl: '', // No GCS backup for seed — can be uploaded later
        uploadedBy: 'system-seed',
        silhouettePrompt: silhouettePrompt || undefined,
        generationPrompt: generationPrompt || undefined,
      });

      console.log(`  OK    ${guide.shotType} — revision ${result.revision} (id: ${result.id})`);
    } catch (err) {
      console.error(`  FAIL  ${guide.shotType} — ${err}`);
    }
  }

  console.log('\nDone.');
  process.exit(0);
}

function extractPromptSection(content: string, header: string): string | null {
  const idx = content.indexOf(header);
  if (idx === -1) return null;
  const after = content.substring(idx);
  const codeStart = after.indexOf('```\n');
  if (codeStart === -1) return null;
  const rest = after.substring(codeStart + 4);
  const codeEnd = rest.indexOf('\n```');
  if (codeEnd === -1) return null;
  return rest.substring(0, codeEnd).trim();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
