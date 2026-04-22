// Node smoke test — mimics what src/lib/label-hybrid.ts does:
//   1. Check python3 + cv2 availability (isPythonAvailable)
//   2. Spawn scripts/label_hybrid.py with an args.json via execFile
//   3. Parse JSON output and verify the output PNG was written
//
// This does NOT call Gemini (no corner detection) — it uses a hardcoded quad.
// Run: node tmp_label_node_smoke.mjs
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);
const ROOT = '/sessions/affectionate-sweet-franklin/mnt/gstar';
const SCRIPT = path.resolve(process.cwd(), 'scripts/label_hybrid.py');
const TARGET = `${ROOT}/label_POC/03_judee_full.png`;
const MATERIAL = `${ROOT}/label_POC/warp_experiment/gemini_with_ref.png`;
const TEMPLATE = `${ROOT}/label_POC/04_template_grey.png`;

async function isPythonAvailable() {
  try {
    const { stdout } = await execFileAsync(
      'python3',
      ['-c', 'import cv2, numpy; print(cv2.__version__)'],
      { timeout: 5000 },
    );
    return stdout.trim();
  } catch (e) {
    return null;
  }
}

async function runPython(argsPath) {
  const { stdout, stderr } = await execFileAsync(
    'python3',
    [SCRIPT, argsPath],
    { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
  );
  if (stderr) console.log('[py stderr]', stderr.trim().slice(-300));
  return JSON.parse(stdout.trim());
}

async function main() {
  console.log('--- Node subprocess smoke test ---');
  console.log('cwd:', process.cwd());
  console.log('SCRIPT:', SCRIPT);

  const cvVersion = await isPythonAvailable();
  if (!cvVersion) {
    console.error('FAIL: python3 + cv2 not available');
    process.exit(1);
  }
  console.log('python OK — cv2:', cvVersion);

  const tempDir = await mkdtemp(path.join(tmpdir(), 'label-hybrid-smoke-'));
  try {
    const outputPath = path.join(tempDir, 'out.png');
    const argsPath = path.join(tempDir, 'args.json');
    const args = {
      target_image: TARGET,
      material_tile: MATERIAL,
      template: TEMPLATE,
      quad: [
        { x: 1680, y: 1000 },
        { x: 2100, y: 1000 },
        { x: 2100, y: 1200 },
        { x: 1680, y: 1200 },
      ],
      base_color: '#A47840',
      stitch_color: '',
      emboss_strength: 0.85,
      output: outputPath,
    };
    await writeFile(argsPath, JSON.stringify(args));
    const result = await runPython(argsPath);
    console.log('python result:', result);
    if (!result.ok) {
      console.error('FAIL: python reported failure');
      process.exit(1);
    }
    const out = await readFile(outputPath);
    console.log(`output read: ${out.length} bytes`);
    if (out.length < 100000) {
      console.error('FAIL: output too small');
      process.exit(1);
    }
    console.log('\nNODE SUBPROCESS SMOKE: PASS');
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
