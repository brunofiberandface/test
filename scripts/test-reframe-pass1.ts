#!/usr/bin/env tsx
/**
 * Validate reframePass1() against downloaded Pass 1 debug images.
 * Reads p1_*.png from a TMP dir, writes p1_*_reframed.png alongside.
 *
 * Run from project root:
 *   npx tsx scripts/test-reframe-pass1.ts /tmp/pass1-dir
 *
 * Then visually compare in Preview / Finder.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { reframePass1 } from '@/lib/pipeline/reframe-pass1';

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: tsx scripts/test-reframe-pass1.ts <dir-with-p1-pngs>');
    process.exit(1);
  }
  const files = (await readdir(dir)).filter(f => f.startsWith('p1_') && f.endsWith('.png') && !f.includes('_reframed'));
  console.log(`Found ${files.length} Pass 1 PNGs in ${dir}\n`);
  for (const f of files) {
    const path = join(dir, f);
    const buf = await readFile(path);
    const t0 = Date.now();
    const out = await reframePass1(buf);
    const dt = Date.now() - t0;
    const outPath = join(dir, f.replace('.png', '_reframed.png'));
    await writeFile(outPath, out.buffer);
    console.log(`  ${f}: changed=${out.changed} (${dt}ms) — ${out.reason}`);
    if (out.bbox) {
      console.log(`    bbox: ${out.bbox.width}x${out.bbox.height} @ (${out.bbox.left},${out.bbox.top})`);
    }
    console.log(`    → ${outPath}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
