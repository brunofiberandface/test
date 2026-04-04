
import { generatePanoramicStrips } from './src/lib/zone-grids';
import { readFileSync, writeFileSync } from 'fs';

async function main() {
  // Load 8 fit model images from AI Test Mannequin/5 Female
  const imgDir = '/sessions/focused-nifty-faraday/mnt/gstar/AI Test Mannequin/5 Female';
  const files = [
    '_DSC4236.jpg', '_DSC4237.jpg', '_DSC4238.jpg', '_DSC4239.jpg',
    '_DSC4240.jpg', '_DSC4241.jpg', '_DSC4242.jpg', '_DSC4243.jpg'
  ];

  const fitModelImages = files.map((f, i) => ({
    buffer: readFileSync(`${imgDir}/${f}`),
    index: i,
  }));
  console.log(`Loaded ${fitModelImages.length} fit model images`);

  // Load flat images
  const flatDir = '/sessions/focused-nifty-faraday/mnt/gstar/Mannequin AI test - Mannequin + flat images-1/Flat images';
  let flatFront = null;
  let flatBack = null;
  try {
    // Use first available flat as "back" (they're M04 = back view)
    flatBack = readFileSync(`${flatDir}/D27463-D945-001-M04.jpg`);
    console.log('Loaded flat back image');
  } catch (e) {
    console.warn('No flat back found');
  }
  try {
    // Use ottolinger flat as front stand-in
    flatFront = readFileSync('/sessions/focused-nifty-faraday/mnt/gstar/ottolinger/flat.jpg');
    console.log('Loaded flat front image');
  } catch (e) {
    console.warn('No flat front found');
  }

  // Generate panoramic strips for back shot (M02)
  console.log('\nGenerating BACK-focused strips (M02)...');
  const backStrips = await generatePanoramicStrips(
    fitModelImages, flatFront, flatBack, 'M02', 'pants'
  );

  for (const strip of backStrips) {
    const outPath = `/sessions/focused-nifty-faraday/mnt/gstar/panoramic_${strip.zoneName}_back.jpg`;
    writeFileSync(outPath, strip.buffer);
    console.log(`  ${strip.zoneName}: ${strip.panelCount} panels → ${outPath}`);
  }

  // Generate panoramic strips for front shot (M03)
  console.log('\nGenerating FRONT-focused strips (M03)...');
  const frontStrips = await generatePanoramicStrips(
    fitModelImages, flatFront, flatBack, 'M03', 'pants'
  );

  for (const strip of frontStrips) {
    const outPath = `/sessions/focused-nifty-faraday/mnt/gstar/panoramic_${strip.zoneName}_front.jpg`;
    writeFileSync(outPath, strip.buffer);
    console.log(`  ${strip.zoneName}: ${strip.panelCount} panels → ${outPath}`);
  }

  console.log('\nDone! Check /sessions/focused-nifty-faraday/mnt/gstar/ for panoramic_*.jpg');
}

main().catch(console.error);
