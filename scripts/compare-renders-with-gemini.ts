/**
 * For each of the requested poses, send Gemini-2.5-pro:
 *   IMAGE 1 — Original team reference (the pose intent)
 *   IMAGE 2 — Latest AI render (v6 Gemini output)
 * and ask: how do they compare on body orientation, hand placement, gaze.
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

const COMPARE_PROMPT = `You are reviewing whether an AI-generated fashion pose matches a reference photo.

IMAGE 1 = ORIGINAL REFERENCE (the intended pose, from the G-Star team)
IMAGE 2 = AI RENDER (the generated output to evaluate)

For each of the 5 dimensions below, answer:
  - REF: what IMAGE 1 shows
  - RENDER: what IMAGE 2 shows
  - MATCH: ✓ (matches) or ✗ (differs) and a 1-sentence explanation

Dimensions:
1. BODY ORIENTATION (front view / 3/4 turn / side profile / back view, and rotation direction)
2. LEFT HAND PLACEMENT (at side / front pocket / back pocket / on hip / behind back / hidden)
3. RIGHT HAND PLACEMENT (at side / front pocket / back pocket / on hip / behind back / hidden)
4. HEAD DIRECTION (toward camera / over shoulder / away)
5. GAZE (at camera / off-camera up / off-camera side / down / over shoulder)

Then give an OVERALL VERDICT: PASS, PARTIAL, or FAIL — and a 1-sentence summary of what's wrong if not PASS.

Be terse and specific. Do not pad with adjectives.`;

const POSE_FILES = [
  { id: 'p01', original: 'pose-002.png' },
  { id: 'p03', original: 'pose-004.png' },
  { id: 'p04', original: 'pose-005.png' },
  { id: 'p06', original: 'pose-007.png' },
  { id: 'p08', original: 'pose-009.png' },
  { id: 'p10', original: 'pose-011.png' },
  { id: 'p11', original: 'pose-012.png' },
];

async function compareImages(refPath: string, renderPath: string): Promise<string> {
  const refBuf = fs.readFileSync(refPath);
  const renderBuf = fs.readFileSync(renderPath);
  return analyzeWithFlashLite({
    prompt: COMPARE_PROMPT,
    images: [
      { buffer: refBuf, mimeType: 'image/png' },
      { buffer: renderBuf, mimeType: 'image/png' },
    ],
    model: 'gemini-2.5-pro',
    temperature: 0.0,
  });
}

async function main() {
  const outDir = '/tmp/m06_dryrun';
  fs.mkdirSync(outDir, { recursive: true });
  const summaryPath = path.join(outDir, 'render-comparisons.txt');
  let summary = '';

  for (const { id, original } of POSE_FILES) {
    const refPath = path.join('/tmp/poses-extracted', original);
    const renderPath = path.join('/tmp/m06_dryrun', `${id}_gemini.png`);
    if (!fs.existsSync(refPath) || !fs.existsSync(renderPath)) {
      console.warn(`skip ${id}: missing ${!fs.existsSync(refPath) ? refPath : renderPath}`);
      continue;
    }
    process.stdout.write(`Comparing ${id}... `);
    try {
      const result = await compareImages(refPath, renderPath);
      console.log('done');
      const block = `\n=== ${id.toUpperCase()} ===\nREF: ${original}\nRENDER: ${id}_gemini.png\n\n${result}\n`;
      summary += block;
      console.log(block);
    } catch (e: any) {
      console.error(`error: ${e.message}`);
      summary += `\n=== ${id.toUpperCase()} ===\nERROR: ${e.message}\n`;
    }
  }

  fs.writeFileSync(summaryPath, summary);
  console.log(`\n[wrote] ${summaryPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
