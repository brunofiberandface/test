import sharp from 'sharp';
import fs from 'fs';
import { padLabelForSeedance } from './src/lib/label-padding';

async function main() {
  // Step 1: read TIF, ensure RGBA with full opaque alpha (rectangle-label format)
  const tif = fs.readFileSync('/sessions/gifted-kind-gates/mnt/uploads/BLACK:GREY.tif');
  const opaqueRgba = await sharp(tif).ensureAlpha().png().toBuffer();
  fs.writeFileSync('/sessions/gifted-kind-gates/mnt/gstar/_label_preview/BLACK_GREY_opaque.png', opaqueRgba);

  // Step 2: pad using same helper as existing labels
  const padded = await padLabelForSeedance(opaqueRgba);
  fs.writeFileSync('/sessions/gifted-kind-gates/mnt/gstar/_label_preview/BLACK_GREY_padded.png', padded);

  const m1 = await sharp(opaqueRgba).metadata();
  const m2 = await sharp(padded).metadata();
  console.log(`opaque: ${m1.width}x${m1.height} (${(opaqueRgba.length/1024).toFixed(0)}KB)`);
  console.log(`padded: ${m2.width}x${m2.height} (${(padded.length/1024).toFixed(0)}KB)`);
}
main().catch(e => { console.error(e); process.exit(1); });
