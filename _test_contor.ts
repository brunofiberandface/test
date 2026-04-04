import sharp from 'sharp';
import { generatePanoramicStrips } from './src/lib/zone-grids';
import { readFileSync, writeFileSync } from 'fs';

async function main() {
  const dir = '/sessions/focused-nifty-faraday/mnt/gstar/new ai shoot 01042026/D27690-D315-001 CONTOR 3D EXTREME LOOSE WMN';

  // Check dimensions of fit model images
  const fitFiles = [
    'G-Star AI test jeans 4.png', 'G-Star AI test jeans 5.png',
    'G-Star AI test jeans 6.png', 'G-Star AI test jeans 7.png',
    'G-Star AI test jeans 8.png', 'G-Star AI test jeans 9.png',
    'G-Star AI test jeans 10.png', 'G-Star AI test jeans 11.png',
  ];

  console.log('=== Image dimensions ===');
  const fitModelImages: Array<{ buffer: Buffer; index: number }> = [];
  for (let i = 0; i < fitFiles.length; i++) {
    const buf = readFileSync(`${dir}/${fitFiles[i]}`);
    const m = await sharp(buf).metadata();
    console.log(`  ${fitFiles[i]}: ${m.width}x${m.height} (${m.format})`);
    fitModelImages.push({ buffer: buf, index: i });
  }

  // Load flats
  const flatFront = readFileSync(`${dir}/G-Star AI test jeans flat front.png`);
  const flatBack = readFileSync(`${dir}/G-Star AI test jeans flat back.png`);
  const ffMeta = await sharp(flatFront).metadata();
  const fbMeta = await sharp(flatBack).metadata();
  console.log(`  flat front: ${ffMeta.width}x${ffMeta.height} (${ffMeta.format})`);
  console.log(`  flat back: ${fbMeta.width}x${fbMeta.height} (${fbMeta.format})`);

  // Generate back-focused strips (M02)
  console.log('\n=== Generating BACK-focused strips (M02) ===');
  const backStrips = await generatePanoramicStrips(
    fitModelImages, flatFront, flatBack, 'M02', 'pants'
  );

  for (const strip of backStrips) {
    const outPath = `/sessions/focused-nifty-faraday/mnt/gstar/contor_${strip.zoneName}_back.jpg`;
    writeFileSync(outPath, strip.buffer);
    const meta = await sharp(strip.buffer).metadata();
    console.log(`  ${strip.zoneName}: ${strip.panelCount} panels, ${meta.width}x${meta.height}, ${(strip.buffer.length / 1024).toFixed(0)}KB → ${outPath}`);
  }

  console.log('\nDone!');
}

main().catch(console.error);
