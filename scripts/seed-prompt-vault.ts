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
  // Dynamic import to pick up .env.local via dotenv
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

  // Import firestore after env is loaded
  const { uploadPromptFile } = await import('../src/lib/firestore');

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
