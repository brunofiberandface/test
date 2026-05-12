/**
 * Test: stronger M05-specific tee-edit prompt that locks framing.
 *
 * Production tee-edit (in seedream-tee-edit.ts) lets Gemini reframe to
 * standard back view. For M05 we need to preserve the low-angle tight
 * crop. This script writes an M05-specific prompt that aggressively
 * locks framing while painting only the visible top strip.
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

import { generateImage } from '../src/lib/vertex';
import { Firestore } from '@google-cloud/firestore';

const JOB_ID = 'H6IsIQxs9n6yVTR1pbR0';
const SEEDREAM_OUTPUT = '/tmp/m05_replay/H6Is_M05_trackA_dryrun.png';

async function fetchBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  return { buffer: Buffer.from(await r.arrayBuffer()), mimeType: r.headers.get('content-type') || 'image/jpeg' };
}

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const jobDoc = await db.collection('jobs').doc(JOB_ID).get();
  const job = jobDoc.data() as any;

  // Get top item
  const topDoc = await db.collection('wardrobe').doc(job.wardrobe.top.itemId).get();
  const topItem = topDoc.data() as any;
  const flatUrl = topItem.flatBackUrl || topItem.flatFrontUrl;
  const topDescription = topItem.topDescription || topItem.description || topItem.name;
  console.log(`Top: ${topDescription.slice(0, 80)}`);
  console.log(`Flat: ${flatUrl}`);

  const sourceImage = fs.readFileSync(SEEDREAM_OUTPUT);
  const flat = await fetchBuffer(flatUrl);

  // M05-SPECIFIC strict prompt — lock framing aggressively
  const prompt = `This is a TIGHT M05 PRODUCT CLOSE-UP. The SOURCE IMAGE shows a low-angle close-up of a model's back-hip / buttock area, with the camera positioned BELOW the buttock looking UPWARD. The framing is intentionally tight — buttock dominates the central composition, top of frame shows a sliver of bare back/skin above the waistband, bottom of frame is mid-thigh.

═══ ABSOLUTELY CRITICAL: FRAMING LOCK ═══
DO NOT REFRAME. DO NOT ZOOM OUT. DO NOT change the camera angle. DO NOT render a standard back view. The output frame MUST be byte-equivalent to the source image's framing:
- Camera height: same (low, below buttock)
- Camera angle: same (tilted upward looking at buttock)
- Crop: same (waist-to-mid-thigh, buttock-central)
- Body pose: same (three-quarter rotation, right hip forward)
- Body orientation: same
- Background: same studio backdrop
- Model identity: same skin tone, same body shape, same proportions
- Jeans: same color, wash, fit, pocket geometry, hem position
- Everything below the waistband: BYTE-IDENTICAL to the source image

═══ THE ONLY CHANGE ═══
At the TOP of the frame (above the jeans waistband), there is currently a small slice of bare back skin visible. PAINT THAT BARE SKIN STRIP with the bottom edge of this top: ${topDescription}

The top is tucked into the jeans. Only the BOTTOM EDGE of the top is visible in this tight crop — the bottom hem of the tee disappears under the waistband. From the camera's view, we see the tee fabric going from the top edge of the frame down to where the jeans waistband begins. That's it. NO full tee visible. NO shoulders visible. NO arms visible. NO head visible. NO neckline visible.

The visible portion of the tee is roughly the top 15-25% of the frame, from the top edge down to the jeans waistband. Match the tee's color, fabric, and texture from the TOP REFERENCE.

═══ WHAT NOT TO DO ═══
- DO NOT render a full back view of the model wearing the tee.
- DO NOT reframe to chest-height or eye-level camera.
- DO NOT make the model stand straight up.
- DO NOT change the buttock-central composition.
- DO NOT add shoulders, arms, head, or neck.
- DO NOT change the jeans or the buttock area.

ONLY the bare-skin slice at the TOP of the source image becomes a slice of tee fabric. Everything else is preserved byte-equivalent.`;

  const t0 = Date.now();
  const result = await generateImage({
    prompt,
    referenceImages: [
      { buffer: sourceImage, mimeType: 'image/png', label: 'SOURCE IMAGE — preserve this framing/composition exactly. Only the bare-skin slice above the waistband changes.' },
      { buffer: flat.buffer, mimeType: flat.mimeType, label: 'TOP REFERENCE — flat image of the tee. Take color/fabric/texture from here for the strip above the waistband.' },
    ],
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
  });
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.imageData.length} bytes`);

  const outPath = '/tmp/m05_replay/H6Is_M05_trackA_FINAL_v2.png';
  fs.writeFileSync(outPath, result.imageData);
  console.log(`[wrote] ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
