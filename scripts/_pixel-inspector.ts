/**
 * Pixel-based image inspector. Use this before making claims about image
 * content. Outputs:
 *   - dimensions
 *   - color samples at 9 points (corners, edges, center)
 *   - subject mass count (pixels significantly different from corner color)
 *   - vertical band counts (how much subject mass in each horizontal slice)
 *
 * Usage: npx tsx scripts/_pixel-inspector.ts <file1> [file2] ...
 */
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

async function inspect(filepath: string) {
  console.log(`\n=== ${path.basename(filepath)} ===`);
  const img = sharp(filepath);
  const meta = await img.metadata();
  console.log(`Dimensions: ${meta.width}×${meta.height}, channels: ${meta.channels}, format: ${meta.format}`);

  // Downsize to ~512px for fast analysis
  const W = 512;
  const H = Math.round((meta.height! / meta.width!) * W);
  const { data, info } = await img.resize(W, H).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => {
    const i = (y * info.width + x) * 3;
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
  };

  // 9-point grid sample
  const pts = [
    { name: 'TL', x: 5, y: 5 },
    { name: 'TM', x: Math.round(W / 2), y: 5 },
    { name: 'TR', x: W - 6, y: 5 },
    { name: 'ML', x: 5, y: Math.round(H / 2) },
    { name: 'CC', x: Math.round(W / 2), y: Math.round(H / 2) },
    { name: 'MR', x: W - 6, y: Math.round(H / 2) },
    { name: 'BL', x: 5, y: H - 6 },
    { name: 'BM', x: Math.round(W / 2), y: H - 6 },
    { name: 'BR', x: W - 6, y: H - 6 },
  ];
  console.log('9-pt colour grid (R,G,B):');
  for (const p of pts) {
    const px = pixel(p.x, p.y);
    console.log(`  ${p.name}: (${px.r}, ${px.g}, ${px.b})`);
  }

  // Backdrop estimate = average of 4 corners
  const corners = [pixel(5, 5), pixel(W - 6, 5), pixel(5, H - 6), pixel(W - 6, H - 6)];
  const bg = {
    r: Math.round(corners.reduce((s, c) => s + c.r, 0) / 4),
    g: Math.round(corners.reduce((s, c) => s + c.g, 0) / 4),
    b: Math.round(corners.reduce((s, c) => s + c.b, 0) / 4),
  };
  console.log(`Backdrop estimate (4-corner avg): (${bg.r}, ${bg.g}, ${bg.b})`);

  // Subject = pixels where euclidean distance from backdrop > threshold (30)
  const threshold = 30;
  // Count subject pixels per horizontal band (10 bands top-to-bottom)
  const bandCount = 10;
  const bands = new Array(bandCount).fill(0);
  const bandTotal = new Array(bandCount).fill(0);
  let subjectTotal = 0;
  for (let y = 0; y < H; y++) {
    const band = Math.floor((y / H) * bandCount);
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 3;
      const dr = data[idx] - bg.r;
      const dg = data[idx + 1] - bg.g;
      const db = data[idx + 2] - bg.b;
      const dist2 = dr * dr + dg * dg + db * db;
      bandTotal[band]++;
      if (dist2 > threshold * threshold) {
        bands[band]++;
        subjectTotal++;
      }
    }
  }
  console.log(`Subject pixels (distance > ${threshold} from backdrop): ${subjectTotal} / ${W * H} = ${(100 * subjectTotal / (W * H)).toFixed(1)}%`);
  console.log('Subject mass per vertical band (top → bottom, % of band):');
  for (let i = 0; i < bandCount; i++) {
    const pct = (100 * bands[i] / bandTotal[i]).toFixed(1);
    const bar = '█'.repeat(Math.round(parseFloat(pct) / 2));
    console.log(`  Band ${i} (y ${(i / bandCount * 100).toFixed(0)}%–${((i + 1) / bandCount * 100).toFixed(0)}%): ${pct.padStart(5)}% ${bar}`);
  }

  // Detect horizontal "bottom edge" of subject — last band with significant subject
  for (let i = bandCount - 1; i >= 0; i--) {
    if (bands[i] / bandTotal[i] > 0.05) {
      console.log(`Subject extends down to band ${i} (y ≈ ${((i + 1) / bandCount * 100).toFixed(0)}% of frame)`);
      break;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) { console.error('Usage: pixel-inspector <file> [...]'); process.exit(1); }
  for (const f of args) await inspect(f);
}
main().catch(e=>{console.error(e); process.exit(1)});
