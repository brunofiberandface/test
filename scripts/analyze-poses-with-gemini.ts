/**
 * Send each pose-NN image to Gemini-Vision and ask it to describe the pose
 * objectively. Used to bypass Claude's faulty image reading on these poses.
 * Output: a TXT file per pose with Gemini's structured description.
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

import { analyzeWithFlashLite } from '../src/lib/vertex';

const ANALYSIS_PROMPT = `Look at this fashion-photography reference image and describe the pose objectively. Answer EACH question with a single short sentence:

1. BODY ORIENTATION: Is the model facing the camera (front view), facing away from camera (back view), in profile (side view), or at a three-quarter angle? If three-quarter, which way is the body rotated (left or right)? Be specific.

2. WHAT WE SEE OF THE MODEL: Do we see her face, the back of her head, her side profile, or some combination?

3. LEFT HAND: Where is the model's LEFT hand? (Hanging at side, in left front pocket, in left BACK pocket, on left hip, behind the back, somewhere else?) Be specific about FRONT vs BACK pocket.

4. RIGHT HAND: Where is the model's RIGHT hand? (Hanging at side, in right front pocket, in right BACK pocket, on right hip, behind the back, somewhere else?) Be specific about FRONT vs BACK pocket.

5. HEAD DIRECTION: Where does the head point? (Toward camera, away from camera, turned over which shoulder?)

6. GAZE: Where do the eyes look? (At camera, off-camera up, off-camera down, off-camera to the side?)

7. WEIGHT / STANCE: Symmetric or asymmetric? Weight on which leg?

Answer ONLY with the 7 numbered sentences. No preamble, no summary.`;

async function analyzeImage(imagePath: string): Promise<string> {
  const buffer = fs.readFileSync(imagePath);
  return analyzeWithFlashLite({
    prompt: ANALYSIS_PROMPT,
    images: [{ buffer, mimeType: 'image/png' }],
    model: 'gemini-2.5-pro',  // upgraded from flash-lite for spatial accuracy
    temperature: 0.0,
  });
}

async function main() {
  const POSE_FILES = [
    { id: 'p01', file: 'pose-002.png' },
    { id: 'p02', file: 'pose-003.png' },
    { id: 'p03', file: 'pose-004.png' },
    { id: 'p04', file: 'pose-005.png' },
    { id: 'p05', file: 'pose-006.png' },
    { id: 'p06', file: 'pose-007.png' },
    { id: 'p07', file: 'pose-008.png' },
    { id: 'p08', file: 'pose-009.png' },
    { id: 'p09', file: 'pose-010.png' },
    { id: 'p10', file: 'pose-011.png' },
    { id: 'p11', file: 'pose-012.png' },
  ];

  const outDir = '/tmp/m06_dryrun';
  fs.mkdirSync(outDir, { recursive: true });
  const summaryPath = path.join(outDir, 'pose-analyses.txt');
  let summary = '';

  for (const { id, file } of POSE_FILES) {
    const imgPath = path.join('/tmp/poses-extracted', file);
    if (!fs.existsSync(imgPath)) {
      console.warn(`skip: ${imgPath} not found`);
      continue;
    }
    process.stdout.write(`Analyzing ${id} (${file})... `);
    try {
      const desc = await analyzeImage(imgPath);
      console.log('done');
      const block = `\n=== ${id.toUpperCase()} (${file}) ===\n${desc}\n`;
      summary += block;
      console.log(block);
    } catch (e: any) {
      console.error(`error: ${e.message}`);
      summary += `\n=== ${id.toUpperCase()} (${file}) ===\nERROR: ${e.message}\n`;
    }
  }

  fs.writeFileSync(summaryPath, summary);
  console.log(`\n[wrote] ${summaryPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
