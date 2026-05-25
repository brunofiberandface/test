/**
 * Pre-deploy validation: can Gemini paint a tucked-tee hem strip above the
 * waistband of a Tier-2 legsFront/legsBack image WITHOUT reframing or touching
 * the jeans / shoes / background?
 *
 * If yes → we keep using legsFront/legsBack as the M01/M02 matrix base AND
 * the 4K resolution they have, and just add a Gemini "strip-paint" step at
 * the end (much cheaper than fullBody + full tee-edit + crop).
 *
 * If no  → fall back to the fullBody → paint → tee-edit → crop path.
 *
 * Usage:
 *   npx tsx scripts/test-tee-hem-strip.ts <shoeId> <modelId> <topItemId>
 *
 * Outputs to /tmp/test-tee-hem-strip-{cellId}-{front|back}.png
 *
 * What this DOESN'T do: it runs the strip-paint on the raw Tier-2 legs view
 * (hot-pants placeholder still in place, no jeans yet). The strip-paint logic
 * is independent of what's below the waistband — if it works on hot pants, it
 * works on jeans. To save Seedream API cost during iteration, we skip the
 * jeans paint and just validate the strip-paint behaviour.
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
  console.error('Usage: npx tsx scripts/test-tee-hem-strip.ts <shoeId> <modelId> <topItemId>');
  console.error('Example: npx tsx scripts/test-tee-hem-strip.ts 3xKezovO6eef7SJfMioC <F9-modelId> <some-top-id>');
  process.exit(1);
}
const [shoeId, modelId, topItemId] = args;

const db = new Firestore({ projectId: 'gstar-ai-studio' });

async function fetchBuf(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  return {
    buffer: Buffer.from(await r.arrayBuffer()),
    mimeType: r.headers.get('content-type') || 'image/jpeg',
  };
}

function buildStripPaintPrompt(topDescription: string, side: 'front' | 'back'): string {
  return `This is a TIGHT WAIST-DOWN PRODUCT SHOT, 1:1 SQUARE, 4K resolution, ${side.toUpperCase()} VIEW. The frame shows the model's lower-back / hip / leg region: the bottom of the frame is the floor with the shoes, the top of the frame is the model's lower torso / midriff / waist area. Above the waistband there is currently a small slice of BARE SKIN (midriff).

═══ ABSOLUTELY CRITICAL: FRAMING LOCK ═══
DO NOT REFRAME. DO NOT ZOOM OUT. DO NOT change the camera angle. DO NOT extend the frame upward to show more of the body. The output frame MUST be byte-equivalent to the source image's framing:
- Camera height: same
- Camera angle: same
- Crop: same (waist-down, feet at bottom edge, mid-torso at top edge)
- Body pose, stance, foot position: same
- Background: same studio backdrop (light-grey #D9DAD2)
- Model identity, skin tone, body shape, proportions: same
- Waistband, pants (whatever colour they are), shoes, floor, contact shadow: BYTE-IDENTICAL to the source image
- Arms / hands (if visible at the sides): same — preserve skin tone

═══ THE ONLY CHANGE — TUCKED-IN TEE FABRIC ═══
At the TOP of the frame, above the pants waistband, there is currently a strip of BARE SKIN (the model's midriff). PAINT THAT STRIP as a slice of the BOTTOM of this TUCKED-IN top:

${topDescription}

═══ TUCKING — THE CRITICAL RULE ═══
The top is TUCKED INTO the pants. This means:
- The tee fabric goes DOWN and DISAPPEARS UNDER the waistband edge.
- The pants waistband sits ON TOP OF the tee fabric — the waistband is the ABOVE layer.
- There is NO visible bottom hem of the tee. NO horizontal "fabric end line" at any height above the waistband. The tee continues smoothly DOWNWARD and the LAST visible pixel of tee fabric is the one that meets the TOP EDGE of the waistband.
- At the waistband, the visible boundary is the waistband edge itself (pants colour above → pants colour below). NOT an extra "hem of the tee resting above the waistband".

Picture how a real tucked-in t-shirt looks from this angle: you see tee fabric going down, then the waistband cuts across, then pants below. ONE horizontal transition, not two.

═══ WHAT THE OUTPUT LOOKS LIKE ═══
Top of frame: tee fabric (matching the COLOUR, FABRIC TEXTURE, and FINISH from the TOP REFERENCE image — Image 2). The fabric continues unbroken from the top edge of the frame DOWN to the pants waistband. NO full tee visible. NO shoulders, NO chest, NO neckline, NO sleeves, NO head.

═══ FAILURE MODES — ABSOLUTELY WRONG ═══
- WRONG: a horizontal hem line / fabric edge visible ABOVE the pants waistband.
- WRONG: tee hanging loose / draping OVER the waistband with its hem visible.
- WRONG: a "gap" of bare skin between the tee hem and the waistband.
- WRONG: tee bottom edge sitting just above the waistband (this is the untucked look — the tee must DISAPPEAR UNDER the waistband, NOT rest on top of it).
- WRONG: rendering a full back / front view of the model.
- WRONG: reframing to chest-height or eye-level camera.
- WRONG: changing the pants, waistband, shoes, floor, or background.
- WRONG: leaving any bare skin in the strip above the waistband.

The correct rendering shows: pants waistband intact (top edge of waistband unchanged from source), and ABOVE that waistband, tee fabric continuously filling the strip with NO visible hem line. The transition from tee → pants happens at the waistband edge itself.

ONLY the bare-skin midriff strip at the TOP of the source image becomes a slice of TUCKED-IN tee fabric. Everything else is byte-equivalent.`;
}

async function paintStripOnView(
  legsViewUrl: string,
  topFlatUrl: string,
  topDescription: string,
  side: 'front' | 'back',
): Promise<Buffer> {
  console.log(`\n[${side}] Fetching legs view: ${legsViewUrl.slice(-80)}`);
  const { buffer: legsBuf } = await fetchBuf(legsViewUrl);
  console.log(`[${side}] Legs view ${(legsBuf.length / 1024).toFixed(0)}KB`);

  console.log(`[${side}] Fetching top flat: ${topFlatUrl.slice(-80)}`);
  const { buffer: topBuf, mimeType: topMime } = await fetchBuf(topFlatUrl);
  console.log(`[${side}] Top flat ${(topBuf.length / 1024).toFixed(0)}KB, ${topMime}`);

  const refs: ReferenceImage[] = [
    {
      buffer: legsBuf,
      mimeType: 'image/png',
      label: `SOURCE IMAGE — waist-down ${side} view of the model. PRESERVE every pixel except the bare-skin strip above the waistband.`,
    },
    {
      buffer: topBuf,
      mimeType: topMime,
      label: 'TOP REFERENCE — flat image of the top to paint as a tucked-in hem strip above the waistband.',
    },
  ];

  console.log(`[${side}] Calling Gemini Pro Image Preview for strip-paint...`);
  const t0 = Date.now();
  const result = await generateImage({
    prompt: buildStripPaintPrompt(topDescription, side),
    referenceImages: refs,
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
    apiKey: process.env.GEMINI_API_KEY,
  });
  console.log(`[${side}] Gemini done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${(result.imageData.length / 1024).toFixed(0)}KB`);
  return result.imageData;
}

async function main() {
  const cellId = `${shoeId}_${modelId}`;
  console.log(`Test cell: ${cellId} × top ${topItemId}`);

  // 1. Fetch matrix cell
  const cellDoc = await db.collection('qaShoeMatrix').doc(cellId).get();
  if (!cellDoc.exists) throw new Error(`Cell ${cellId} not found in qaShoeMatrix`);
  const cell = cellDoc.data()!;
  const legsFrontUrl = cell.images?.legsFront;
  const legsBackUrl = cell.images?.legsBack;
  if (!legsFrontUrl || !legsBackUrl) {
    throw new Error(`Cell ${cellId} missing legsFront or legsBack: ${JSON.stringify(Object.keys(cell.images || {}))}`);
  }

  // 2. Fetch top item
  const topDoc = await db.collection('wardrobe').doc(topItemId).get();
  if (!topDoc.exists) throw new Error(`Top item ${topItemId} not found`);
  const topItem = topDoc.data() as Record<string, unknown>;
  const normalized = normalizeWardrobeItem(topItem);
  const topFlatFrontUrl =
    (normalized?.flatFrontUrl) ||
    (topItem.flatFrontUrl as string) ||
    (topItem.flatImageUrl as string) ||
    (normalized?.fitModels?.front) ||
    ((topItem as { fitModels?: { front?: string } }).fitModels?.front);
  const topFlatBackUrl =
    (normalized?.flatBackUrl) ||
    (topItem.flatBackUrl as string) ||
    (normalized?.fitModels?.back) ||
    ((topItem as { fitModels?: { back?: string } }).fitModels?.back) ||
    topFlatFrontUrl;
  if (!topFlatFrontUrl) throw new Error(`Top ${topItemId} has no front flat or fit-model image`);

  const topDescription =
    (topItem.topDescription as string) ||
    (topItem.description as string) ||
    (topItem.name as string) ||
    'fitted top';
  console.log(`Top: "${topDescription.slice(0, 100)}..." (front=${topFlatFrontUrl.slice(-60)}, back=${topFlatBackUrl?.slice(-60)})`);

  // 3. Strip-paint both sides in parallel
  const [frontOut, backOut] = await Promise.all([
    paintStripOnView(legsFrontUrl, topFlatFrontUrl, topDescription, 'front'),
    paintStripOnView(legsBackUrl, topFlatBackUrl!, topDescription, 'back'),
  ]);

  // 4. Save outputs to /tmp
  const outDir = '/tmp';
  const frontPath = path.join(outDir, `test-tee-hem-strip-${cellId}-front.png`);
  const backPath = path.join(outDir, `test-tee-hem-strip-${cellId}-back.png`);
  fs.writeFileSync(frontPath, frontOut);
  fs.writeFileSync(backPath, backOut);

  console.log(`\n✓ Done. Inspect:`);
  console.log(`  ${frontPath}`);
  console.log(`  ${backPath}`);
  console.log(`\nAlso check the originals for comparison:`);
  console.log(`  Front: ${legsFrontUrl}`);
  console.log(`  Back:  ${legsBackUrl}`);
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
