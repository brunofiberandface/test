/**
 * v7 — keep v6 prompt + reorder/repeat refs to anchor the matrix base
 * at both slot 0 (dominant scene reference per SKILL.md) AND at the
 * last slot (final anchor for framing/identity).
 *
 * 5 refs:
 *   0: matrix base (Tier-1 F9 barefoot legsBack) — slot 0 dominant
 *   1: Judee fit-back canonical
 *   2: Judee fit-back45 left
 *   3: Judee fit-back45 right
 *   4: matrix base again — closing anchor to lock framing
 *
 * Hypothesis: in v5/v6 the 3 fit-model refs (slots 2-4) overwhelmed the
 * single matrix base (slot 1) — Seedream picked up the fit-model's full-
 * body composition. Anchoring matrix at both ends should hold the
 * waist-down crop.
 *
 * 3 runs.
 */
import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';

const F9_TIER1_LEGSBACK = 'https://storage.googleapis.com/gstar-ai-studio-assets/output/model-assets/F9/legsBack.png';
const JUDEE_FITBACK_4K  = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/4nyMHh7ICQLrpxBX8zmP/fitmodel_05.jpg';
const JUDEE_FIT_BACK45L = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/4nyMHh7ICQLrpxBX8zmP/fitmodel_01.jpg';
const JUDEE_FIT_BACK45R = 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/4nyMHh7ICQLrpxBX8zmP/fitmodel_02.jpg';

const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/m02-lean-prompt-audit-v7');
fs.mkdirSync(OUT_DIR, { recursive: true });

const LEAN_PROMPT = `Merge IMAGE 1 (barefoot AI model in black placeholder underwear, waist-down) with IMAGES 2-4 (fitmodel wearing the target trousers, viewed from 3 back angles: straight back, back 45° left, back 45° right). Output = IMAGE 1 with the placeholder replaced by the trousers from IMAGES 2-4. IMAGE 5 is IMAGE 1 repeated as the closing anchor — its framing, model identity, and bare-feet pose are the final ground truth for the output. Preserve the trousers' wash, color, fit, length, drape, hem behavior, width progression, and back-pocket construction exactly as in IMAGES 2-4 — use the 3 angles to triangulate the true garment silhouette. Preserve IMAGE 1's exact crop: the top edge of the output frame is at the waistband level (exactly matching IMAGE 1's top edge), model centered horizontally, bottom edge just below the feet. Frame above the waistband is not rendered. Preserve model identity, anatomical body orientation (entire back of body facing the camera as in IMAGE 1), and bare feet. Render exactly ONE model.`;

async function runOne(runIdx: number): Promise<void> {
  console.log(`\n=== run ${runIdx}/3 ===`);
  const t0 = Date.now();
  const result = await generateSeedreamImage({
    prompt: LEAN_PROMPT,
    referenceImages: [
      { url: F9_TIER1_LEGSBACK, label: '' },
      { url: JUDEE_FITBACK_4K, label: '' },
      { url: JUDEE_FIT_BACK45L, label: '' },
      { url: JUDEE_FIT_BACK45R, label: '' },
      { url: F9_TIER1_LEGSBACK, label: '' }, // anchor repeat
    ],
    aspectRatio: '1:1',
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const outPath = path.join(OUT_DIR, `run${runIdx}.png`);
  fs.writeFileSync(outPath, result.imageData);
  console.log(`DONE ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
}

async function main() {
  console.log(`Prompt length: ${LEAN_PROMPT.length} chars`);
  console.log(`5 refs: matrix base (slot 0) + 3 fit-back angles + matrix base (slot 4 anchor)`);
  for (let i = 1; i <= 3; i++) {
    try {
      await runOne(i);
    } catch (e) {
      console.error(`run ${i} FAILED: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
