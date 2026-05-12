/**
 * Test: Gemini-3-pro shoe-edit pass on a Seedream M04 output.
 *
 * Premise: Seedream cannot reliably render the shoe correctly under cascading
 * pant hems. Gemini-3-pro does true image-edit (preserve subject + most of
 * scene, replace one element). Same pattern as seedream-tee-edit.ts.
 *
 * This test takes a Seedream M04 output (e.g., rev 53 replay) + the shoe
 * reference image, and asks Gemini to redraw the visible footwear UNDER the
 * existing pant hem so the boots are mostly hidden inside the outer fabric
 * tube.
 *
 * Usage:
 *   npx tsx scripts/test-gemini-shoe-edit.ts <jobId> <inputPng> [outName]
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

import { Firestore } from '@google-cloud/firestore';
import { execSync } from 'child_process';

const PROJECT = 'gstar-ai-studio';
const URL = `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models/gemini-3-pro-image-preview:generateContent`;

function getToken() {
  return execSync('/Users/bdheedene/google-cloud-sdk/bin/gcloud auth application-default print-access-token', { encoding: 'utf8' }).trim();
}

async function downloadFromGCS(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GCS download ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const PROMPT = `Edit this e-commerce studio photo. The model is wearing pants that drape down to the floor. The current rendering has the visible footwear positioned INCORRECTLY relative to the pant hem — the footwear is fully visible below a pant hem that stops short of the floor.

YOUR TASK:
Lower the pant hem to the floor with the hem opening maintaining its NATURAL fit-model drop and width. The wide-leg silhouette and hem opening width that the pant has at the knee / mid-leg continues UNCHANGED down to the floor — the hem opening width at floor level is the SAME as the leg opening width visible above (no narrowing, no tapering, no pinching, no cinching, no wrapping around the boot). The fabric falls straight down from the knee/mid-leg in soft natural folds, exactly as the fit-model reference would show the same garment hanging on bare feet — except the hem reaches the floor instead of stopping at the ankle, because the hem has been extended downward to compensate for the boot's height.

The footwear (matching the FOOTWEAR REFERENCE image — Image 2) sits BEHIND / UNDERNEATH the cascading pant fabric. The pant fabric is the OUTER LAYER and remains the SAME WIDTH at the floor as it is above. The footwear is enveloped behind the outer tube of fabric. Only a small portion of the footwear remains visible: the heel from behind (peeking out under the hem at floor level) and the lower portion of the sole. The bulk of the boot/shoe upper exterior, the opening, and the shaft are HIDDEN behind the pant fabric, not because the fabric wraps around the boot but because the cascading wide-leg hem covers it from above and the front.

CRITICAL — PRESERVE NATURAL HEM SILHOUETTE:
- The hem of the pant in the output retains the EXACT WIDTH and DROP it would have on bare feet according to the fit-model photos. If the fit-model shows a wide cylindrical leg cascading to the floor, the rendered hem is wide and cylindrical at the floor. If the fit-model shows a slightly tapered leg, the rendered hem keeps that same taper. The output should look like the fit-model garment, just hemmed slightly longer to reach the floor over the boot.
- The hem must NOT pinch, taper, narrow, wrap, cinch, gather, or shape itself around the boot at floor level.
- The hem must NOT bunch or stack at any single height (no "balloon at boot top", no "ankle-puddle around boot").
- The fabric falls in soft natural folds the way denim falls under gravity — the wide-leg silhouette is preserved at the bottom.

PRESERVE EVERYTHING ELSE EXACTLY:
- Same model identity, face, hair, body proportions, pose
- Same garment (pants): fabric, color, wash, seams, hardware, waistband, pocket placement, all construction details. Only the LENGTH is extended to reach the floor — the leg width, drape, and hem-opening shape stay matching the fit-model reference.
- Same top
- Same backdrop and lighting
- Same framing, composition, aspect ratio, resolution

Only changes: (a) extend the pant hem downward to reach the floor (preserving the natural wide-leg drop and hem width), (b) re-position the footwear behind the cascading hem (mostly hidden, only heel + sole visible at floor level).`;

async function callGeminiEdit(input: Buffer, shoeRef: Buffer, fitModelRef: Buffer | null): Promise<Buffer> {
  const reqParts: any[] = [
    { inlineData: { mimeType: 'image/jpeg', data: input.toString('base64') } },
    { text: 'Image 1 above: SOURCE — current rendering with footwear in wrong position.' },
    { inlineData: { mimeType: 'image/jpeg', data: shoeRef.toString('base64') } },
    { text: 'Image 2 above: FOOTWEAR REFERENCE — exact appearance of the footwear (style, color, material).' },
  ];
  if (fitModelRef) {
    reqParts.push({ inlineData: { mimeType: 'image/jpeg', data: fitModelRef.toString('base64') } });
    reqParts.push({ text: 'Image 3 above: FIT-MODEL HEM REFERENCE — the same garment on the fit model (back angle), showing the NATURAL drop, leg width progression, and hem-opening silhouette. The output\'s pant silhouette and hem shape must match this reference exactly, just extended downward to the floor over the boot.' });
  }
  reqParts.push({ text: PROMPT });
  const body = {
    contents: [{ role: 'user', parts: reqParts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '3:4', imageSize: '4K' },
    },
  };
  const token = getToken();
  console.log('[gemini-shoe-edit] calling 4K...');
  const t0 = Date.now();
  const resp = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) { console.error(`gemini ${resp.status}:`, text.slice(0, 800)); throw new Error(`gemini ${resp.status}`); }
  const json = JSON.parse(text);
  const parts = json.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imgPart) { throw new Error('no image in response'); }
  console.log(`[gemini-shoe-edit] ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return Buffer.from(imgPart.inlineData.data, 'base64');
}

async function main() {
  const jobId = process.argv[2];
  const inputPng = process.argv[3];
  const outName = process.argv[4] || `${path.basename(inputPng, '.png')}_shoeedit`;
  if (!jobId || !inputPng) {
    console.error('usage: npx tsx scripts/test-gemini-shoe-edit.ts <jobId> <inputPng> [outName]');
    process.exit(1);
  }

  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const jobDoc = await db.collection('jobs').doc(jobId).get();
  if (!jobDoc.exists) { console.error(`job ${jobId} not found`); process.exit(2); }
  const job = jobDoc.data() as any;
  const shoeId = job.wardrobe?.shoe?.itemId;
  if (!shoeId) { console.error('no shoe item on job'); process.exit(3); }
  const shoeDoc = await db.collection('wardrobe').doc(shoeId).get();
  const shoeItem = shoeDoc.data() as any;
  const shoeUrl = shoeItem.fitModels?.back || shoeItem.flatBackUrl || shoeItem.flatFrontUrl || shoeItem.thumbnailUrl;
  if (!shoeUrl) { console.error('no shoe ref url'); process.exit(4); }
  console.log(`shoe ref: ${shoeUrl}`);

  // v2 verdict (Bruno 2026-05-07): the prompt-only version (no fit-model anchor)
  // produces a more natural drop than v3 which copied the bare-feet hem shape too
  // literally and closed the hem around the boot. Stick with prompt-only.
  const inputBuf = await fs.promises.readFile(inputPng);
  const shoeBuf = await downloadFromGCS(shoeUrl);
  const result = await callGeminiEdit(inputBuf, shoeBuf, null);
  const outDir = '/tmp/m04_replay';
  await fs.promises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${outName}.png`);
  await fs.promises.writeFile(outPath, result);
  console.log(`[wrote] ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
