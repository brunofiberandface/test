/**
 * Replay M06 generation for a given job + selected pose ID.
 *
 * Runs the EXACT production code path: seedreamM06() → buildPrompt() →
 * generateSeedreamImage(). The pose block is dynamically swapped into
 * the active M06 promptVault content based on the selected pose ID
 * from src/lib/m06-poses.ts.
 *
 * Usage:
 *   npx tsx scripts/replay-m06.ts <jobId> <poseId> [outFilename]
 *
 * Example:
 *   npx tsx scripts/replay-m06.ts H6IsIQxs9n6yVTR1pbR0 p07 H6Is_M06_p07_hands_behind_back
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

import { generateSeedreamShot } from '../src/lib/pipeline/seedream-generate';
import { Firestore } from '@google-cloud/firestore';
import { M06_POSES, getM06Pose } from '../src/lib/m06-poses';

/**
 * Replace the existing "### Pose Archetype …" section of the M06 prompt
 * with a freshly-formatted block driven by the selected pose's description.
 * The pose section runs from "### Pose Archetype" to the next "###" header.
 */
function swapPoseBlock(promptContent: string, poseLabel: string, poseDescription: string): string {
  // Match production swap — references the POSE REFERENCE visual ref injected at slot 1.
  const block = `### Pose Archetype — ${poseLabel}\nThe model's pose MUST match the POSE REFERENCE image (labeled "POSE REFERENCE") exactly. The pose in that reference image is the canonical target — body angle, arm placement, hand position, hip tilt, head turn, and gaze direction all come from it. The text below describes the same pose for clarity.\n\n${poseDescription}\n\nReminder: the pose comes from the POSE REFERENCE image. Do NOT default to a generic frontal arms-at-sides stance. Do NOT copy the pose from the model card or fit-model photographs — those references show neutral default poses. The pose for this render is the one shown in the POSE REFERENCE image.\n`;
  const idx = promptContent.indexOf('### Pose Archetype');
  if (idx < 0) {
    return promptContent + `\n\n${block}`;
  }
  const after = promptContent.substring(idx);
  const nextHeaderRel = after.substring(20).search(/\n### /);
  const endIdx = nextHeaderRel >= 0 ? idx + 20 + nextHeaderRel : promptContent.length;
  return promptContent.substring(0, idx) + block + promptContent.substring(endIdx);
}

async function main() {
  const jobId = process.argv[2];
  const poseId = process.argv[3];
  const outName = process.argv[4] || `${jobId}_M06_${poseId}`;
  if (!jobId || !poseId) {
    console.error('usage: npx tsx scripts/replay-m06.ts <jobId> <poseId> [outFilename]');
    console.error('available poseIds:', M06_POSES.map(p => p.id).join(', '));
    process.exit(1);
  }

  const pose = getM06Pose(poseId);
  console.log(`pose: ${pose.id} — ${pose.label}`);

  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const jobDoc = await db.collection('jobs').doc(jobId).get();
  if (!jobDoc.exists) { console.error(`job ${jobId} not found`); process.exit(2); }
  const job = jobDoc.data() as any;
  console.log(`job: ${job.jobName || jobId}`);

  const wardrobe = job.wardrobe;
  if (!wardrobe?.bottom?.itemId) { console.error('job has no bottom — required'); process.exit(3); }
  const modelId = job.modelId || (job.modelIds && job.modelIds[0]);
  if (!modelId) { console.error('no modelId on job'); process.exit(4); }

  // Pull silhouette from focus item (M06 typically uses focus garment)
  const focusEntry = [wardrobe.shoe, wardrobe.top, wardrobe.bottom].find((s: any) => s?.isFocus) || wardrobe.bottom;
  const focusDoc = await db.collection('wardrobe').doc(focusEntry.itemId).get();
  const focusItem = focusDoc.data() as any;
  const silhouetteFront: string = focusItem?.silhouetteFront || '';
  const silhouetteBack: string = focusItem?.silhouetteBack || '';

  // Pull active M06 prompt + swap the pose block
  const promptSnap = await db.collection('promptVault')
    .where('shotType', '==', 'M06')
    .where('isActive', '==', true)
    .where('pipeline', '==', 'seedream')
    .limit(1).get();
  const promptDoc = promptSnap.docs[0]?.data() as any;
  if (!promptDoc) { console.error('no active M06 seedream prompt'); process.exit(5); }
  const content = promptDoc.content as string;

  // Extract Step 2 Prompt body
  let basePrompt = '';
  const step2Idx = content.indexOf('## Step 2 Prompt');
  if (step2Idx >= 0) {
    const after = content.substring(step2Idx);
    const codeStart = after.indexOf('```\n');
    if (codeStart >= 0) {
      const body = after.substring(codeStart + 4);
      const codeEnd = body.indexOf('\n```');
      basePrompt = codeEnd >= 0 ? body.substring(0, codeEnd) : body;
    }
  }
  if (!basePrompt) { console.error('failed to extract Step 2 prompt body'); process.exit(6); }

  const generationPrompt = swapPoseBlock(basePrompt, pose.label, pose.description);

  if (process.env.DRY_RUN) {
    console.log('[DRY_RUN] generated prompt preview (first 1200 chars):');
    console.log(generationPrompt.substring(0, 1200));
    return;
  }

  const ctx: any = {
    wardrobe,
    modelId,
    silhouette: { front: silhouetteFront, back: silhouetteBack },
    m03AnchorUrl: job.m03AnchorUrl,
    m04AnchorUrl: job.m04AnchorUrl,
  };

  const prompt = {
    generationPrompt,
    silhouettePrompt: null,
    revision: 999,
    shotType: 'M06' as const,
  };

  console.log(`[replay] calling seedreamM06...`);
  const t0 = Date.now();
  const result = await generateSeedreamShot('M06', ctx, prompt as any);
  console.log(`[replay] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.imageData.length} bytes`);

  const outDir = '/tmp/m06_dryrun';
  await fs.promises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${outName}.png`);
  await fs.promises.writeFile(outPath, result.imageData);
  console.log(`[wrote] ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
