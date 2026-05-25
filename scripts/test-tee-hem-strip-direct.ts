/**
 * Variant of test-tee-hem-strip.ts that takes a direct image URL (instead
 * of a Tier-2 cell ID). Lets us test strip-paint on any image — e.g. a real
 * production M01/M02 with jeans already painted, to see if the tucking
 * succeeds on jeans (vs hot pants where the rev 1/2 test struggled).
 *
 * Usage:
 *   npx tsx scripts/test-tee-hem-strip-direct.ts <imageUrl> <topItemId> <front|back>
 */
import * as fs from 'fs';
import * as path from 'path';
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

import { Firestore } from '@google-cloud/firestore';
import { generateImage, type ReferenceImage } from '../src/lib/vertex';
import { normalizeWardrobeItem } from '../src/lib/wardrobe-compat';

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: npx tsx scripts/test-tee-hem-strip-direct.ts <imageUrl> <topItemId> <front|back>');
  process.exit(1);
}
const [imageUrl, topItemId, sideArg] = args;
const side = sideArg === 'back' ? 'back' : 'front';

const db = new Firestore({ projectId: 'gstar-ai-studio' });

async function fetchBuf(urlOrPath: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (urlOrPath.startsWith('/') || urlOrPath.startsWith('file://')) {
    const p = urlOrPath.replace(/^file:\/\//, '');
    return { buffer: fs.readFileSync(p), mimeType: p.endsWith('.png') ? 'image/png' : 'image/jpeg' };
  }
  const cleanUrl = urlOrPath.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  return {
    buffer: Buffer.from(await r.arrayBuffer()),
    mimeType: r.headers.get('content-type') || 'image/jpeg',
  };
}

function buildStripPaintPrompt(topDescription: string, s: 'front' | 'back'): string {
  return `This is a TIGHT WAIST-DOWN PRODUCT SHOT, 1:1 SQUARE, 4K resolution, ${s.toUpperCase()} VIEW. The frame shows the model's lower-back / hip / leg region wearing JEANS. The bottom of the frame is the floor with the shoes; the top of the frame is the model's lower torso / midriff / waist area. Above the jeans waistband there is currently a small slice of BARE SKIN (midriff).

═══ ABSOLUTELY CRITICAL: FRAMING LOCK ═══
DO NOT REFRAME. DO NOT ZOOM OUT. DO NOT change the camera angle. DO NOT extend the frame upward to show more of the body. The output frame MUST be byte-equivalent to the source image's framing:
- Camera height: same
- Camera angle: same
- Crop: same (waist-down, feet at bottom edge, mid-torso at top edge)
- Body pose, stance, foot position: same
- Background: same studio backdrop
- Model identity, skin tone, body shape, proportions: same
- JEANS (colour, wash, fabric, stitching, pockets, waistband, belt loops, fly, rivets): BYTE-IDENTICAL to the source image
- Shoes, floor, contact shadow: BYTE-IDENTICAL to the source image
- Arms / hands (if visible at the sides): same — preserve skin tone

═══ THE ONLY CHANGE — TUCKED-IN TEE FABRIC ═══
At the TOP of the frame, above the jeans waistband, there is currently a strip of BARE SKIN (the model's midriff). PAINT THAT STRIP as a slice of the BOTTOM of this TUCKED-IN top:

${topDescription}

═══ TUCKING — THE CRITICAL RULE ═══
The top is TUCKED INTO the jeans. This means:
- The tee fabric goes DOWN and DISAPPEARS UNDER the jeans waistband edge.
- The jeans waistband sits ON TOP OF the tee fabric — the waistband is the ABOVE layer.
- There is NO visible bottom hem of the tee. NO horizontal "fabric end line" at any height above the waistband. The tee continues smoothly DOWNWARD and the LAST visible pixel of tee fabric is the one that meets the TOP EDGE of the waistband (where the waistband starts).
- At the waistband, the visible boundary is the waistband edge itself (tee fabric above → jeans denim below). NOT an extra "tee hem resting above the waistband".

Picture how a real tucked-in t-shirt looks on jeans: tee fabric goes down, gets covered by the waistband (which is rigid denim with belt loops), pants continue below. ONE horizontal transition at the waistband, not two.

═══ WHAT THE OUTPUT LOOKS LIKE ═══
Top of frame: tee fabric (matching the COLOUR, FABRIC TEXTURE, and FINISH from the TOP REFERENCE image — Image 2). The fabric continues unbroken from the top edge of the frame DOWN to the jeans waistband. NO full tee visible. NO shoulders, NO chest, NO neckline, NO sleeves, NO head.

═══ FAILURE MODES — ABSOLUTELY WRONG ═══
- WRONG: a horizontal hem line / fabric edge visible ABOVE the jeans waistband.
- WRONG: tee hanging loose / draping OVER the waistband with its hem visible.
- WRONG: a "gap" of bare skin between the tee hem and the waistband.
- WRONG: tee bottom edge sitting just above the waistband (this is the untucked look — the tee must DISAPPEAR UNDER the waistband, NOT rest on top of it).
- WRONG: rendering a full back / front view of the model.
- WRONG: reframing to chest-height or eye-level camera.
- WRONG: changing the jeans, waistband, shoes, floor, or background.
- WRONG: leaving any bare skin in the strip above the waistband.

The correct rendering shows: jeans waistband intact (top edge of waistband unchanged from source), and ABOVE that waistband, tee fabric continuously filling the strip with NO visible hem line. The transition from tee → jeans happens at the waistband edge itself.

ONLY the bare-skin midriff strip at the TOP of the source image becomes a slice of TUCKED-IN tee fabric. Everything else is byte-equivalent.`;
}

async function main() {
  console.log(`Test direct: ${imageUrl.slice(-80)} × top ${topItemId} (${side})`);

  // 1. Fetch source image
  console.log(`Fetching source...`);
  const { buffer: srcBuf } = await fetchBuf(imageUrl);
  console.log(`Source ${(srcBuf.length / 1024).toFixed(0)}KB`);

  // 2. Fetch top item
  const topDoc = await db.collection('wardrobe').doc(topItemId).get();
  if (!topDoc.exists) throw new Error(`Top item ${topItemId} not found`);
  const topItem = topDoc.data() as Record<string, unknown>;
  const normalized = normalizeWardrobeItem(topItem);
  const topFlatUrl =
    side === 'back'
      ? (normalized?.flatBackUrl ||
         (topItem.flatBackUrl as string) ||
         (normalized?.fitModels?.back) ||
         normalized?.flatFrontUrl ||
         (topItem.flatFrontUrl as string))
      : (normalized?.flatFrontUrl ||
         (topItem.flatFrontUrl as string) ||
         (topItem.flatImageUrl as string) ||
         (normalized?.fitModels?.front));
  if (!topFlatUrl) throw new Error(`Top ${topItemId} has no usable flat for side=${side}`);
  const topDescription =
    (topItem.topDescription as string) ||
    (topItem.description as string) ||
    (topItem.name as string) ||
    'fitted top';
  console.log(`Top: "${topDescription.slice(0, 100)}..." flat=${topFlatUrl.slice(-60)}`);

  const { buffer: topBuf, mimeType: topMime } = await fetchBuf(topFlatUrl);

  const refs: ReferenceImage[] = [
    {
      buffer: srcBuf,
      mimeType: 'image/png',
      label: `SOURCE IMAGE — waist-down ${side} view of the model in jeans. PRESERVE every pixel except the bare-skin strip above the waistband.`,
    },
    {
      buffer: topBuf,
      mimeType: topMime,
      label: 'TOP REFERENCE — flat image of the top to paint as a tucked-in hem strip above the waistband.',
    },
  ];

  console.log(`Calling Gemini Pro Image Preview...`);
  const t0 = Date.now();
  const result = await generateImage({
    prompt: buildStripPaintPrompt(topDescription, side),
    referenceImages: refs,
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
    apiKey: process.env.GEMINI_API_KEY,
  });
  console.log(`Gemini done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${(result.imageData.length / 1024).toFixed(0)}KB`);

  const outPath = `/tmp/test-tee-hem-strip-direct-${side}.png`;
  fs.writeFileSync(outPath, result.imageData);
  console.log(`\n✓ Output: ${outPath}`);
  console.log(`Source: ${imageUrl}`);
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
