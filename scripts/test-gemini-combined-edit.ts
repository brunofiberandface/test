/**
 * Test: COMBINED tee + shoe edit in a single Gemini-3-pro call.
 *
 * Replaces the placeholder bra with the real top AND repositions the visible
 * footwear under the cascading hem — one Gemini call instead of two.
 *
 * Usage:
 *   npx tsx scripts/test-gemini-combined-edit.ts <jobId> <inputPng> [outName]
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

function buildPrompt(topDescription: string, view: 'front' | 'back') {
  return `Edit this e-commerce studio photo. The model is currently wearing a placeholder sports bra and the footwear is rendered in the wrong position relative to the pant hem. Make BOTH corrections in this single edit.

CHANGE 1 — REPLACE THE TOP:
The model currently wears a simple black sports bra. Replace it with the top described below.

TOP TO PAINT: ${topDescription}

The top covers the entire torso from shoulders to below the waistband. The bottom of the top is hidden UNDER the jeans — the denim waistband sits ON TOP of the shirt fabric. The shirt is completely tucked in with no fabric hanging over or bunching above the waistband. The waistband line is clean and unbroken.

LENGTH OVERRIDE: Regardless of any "cropped", "short", "boxy", "hits at hip", or similar fit descriptor in the TOP TO PAINT text, render the top at full tucked length with the bottom disappearing under the denim waistband. Fit descriptors in that text describe the garment's off-body silhouette, not how it is worn on this model.

VIEW: This is a ${view} view. Paint the top as it would appear from the ${view}.

The TOP REFERENCE image (one of the input images, labeled below) shows the exact top to paint — match its color, fabric, weave, neckline, sleeve, and any visible printed graphics, embroideries, or labels.

CHANGE 2 — REPOSITION THE FOOTWEAR UNDER THE HEM:
The model wears pants that are designed to drape down to the floor as an outer layer covering the footwear from above. The current rendering positions the footwear INCORRECTLY — either fully visible below a too-short hem, or stopping at the boot/shoe top.

Re-render the footwear (using the FOOTWEAR REFERENCE image for shape, color, material, style) so the footwear is UNDERNEATH the cascading pant fabric. The pant fabric is the OUTER LAYER hanging from the leg all the way to the FLOOR SURFACE. The footwear is INSIDE that outer tube of fabric and is mostly hidden by it.

Specifically: the upper portion of the footwear (boot shaft if any, sneaker tongue + laces if any, the boot opening, the upper exterior of the shoe) is HIDDEN behind the pant fabric draping over it from above. The pant hem reaches the floor surface (where the footwear sole rests on the ground). Only a SMALL VISIBLE PORTION of the footwear remains: the heel from behind, the sole at the bottom, and possibly the toe-tip peeking out at floor level. The visible footwear shape, color, and material match the FOOTWEAR REFERENCE image.

The pant fabric continues to fall in soft natural folds from the leg down to the floor. The hem MEETS the floor (or pools slightly on the floor if the silhouette is full-length). The footwear is enveloped inside the outer tube of fabric, mostly invisible, with only the lower fragment visible.

The garment goes ABOVE / OUTSIDE; the footwear goes UNDER / INSIDE. Memorize this layer principle.

PRESERVE EVERYTHING ELSE EXACTLY:
- Same face — features, structure, expression. Do not alter the head in any way.
- Same hair — color, length, cut, parting, styling
- Same skin tone, body pose, body proportions
- Same jeans (color, wash, fit, pockets, stitching, all garment construction details). The jeans hem is the only part of the jeans that may extend beyond what is currently shown — extend the hem downward to the floor as described in CHANGE 2. Do not alter the jeans' color, fabric, seams, pockets, hardware, or any other detail.
- Same backdrop and lighting
- Same overall framing, composition, aspect ratio, resolution

Only changes: (1) replace the sports bra with the described top tucked into the jeans, and (2) re-position the footwear under the cascading hem with the hem reaching the floor.`;
}

async function callCombined(input: Buffer, topRef: Buffer, shoeRef: Buffer, prompt: string): Promise<Buffer> {
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: input.toString('base64') } },
        { text: 'Image 1 above: SOURCE — current rendering with placeholder bra and footwear in wrong position.' },
        { inlineData: { mimeType: 'image/jpeg', data: topRef.toString('base64') } },
        { text: 'Image 2 above: TOP REFERENCE — exact appearance of the top to paint (replaces the bra).' },
        { inlineData: { mimeType: 'image/jpeg', data: shoeRef.toString('base64') } },
        { text: 'Image 3 above: FOOTWEAR REFERENCE — exact appearance of the footwear (style, color, material).' },
        { text: prompt },
      ],
    }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '3:4', imageSize: '4K' },
    },
  };
  const token = getToken();
  console.log('[gemini-combined] calling 4K...');
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
  console.log(`[gemini-combined] ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return Buffer.from(imgPart.inlineData.data, 'base64');
}

async function main() {
  const jobId = process.argv[2];
  const inputPng = process.argv[3];
  const outName = process.argv[4] || `${path.basename(inputPng, '.png')}_combined`;
  if (!jobId || !inputPng) { console.error('usage: <jobId> <inputPng> [outName]'); process.exit(1); }

  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const jobDoc = await db.collection('jobs').doc(jobId).get();
  if (!jobDoc.exists) { console.error(`job ${jobId} not found`); process.exit(2); }
  const job = jobDoc.data() as any;
  const w = job.wardrobe;
  const shoeId = w?.shoe?.itemId;
  const topId = w?.top?.itemId;
  if (!shoeId || !topId) { console.error('job missing shoe or top'); process.exit(3); }

  const [shoeDoc, topDoc] = await Promise.all([
    db.collection('wardrobe').doc(shoeId).get(),
    db.collection('wardrobe').doc(topId).get(),
  ]);
  const shoeItem = shoeDoc.data() as any;
  const topItem = topDoc.data() as any;

  const view: 'front' | 'back' = 'back'; // M04 is back view
  const shoeUrl = shoeItem.fitModels?.back || shoeItem.flatBackUrl || shoeItem.flatFrontUrl || shoeItem.thumbnailUrl;
  const topUrl = topItem.flatBackUrl || topItem.flatFrontUrl || topItem.thumbnailUrl;
  const topDescription = topItem.topDescription || topItem.description || topItem.name || 'fitted top';

  console.log(`top desc: ${topDescription.slice(0, 80)}...`);
  console.log(`top ref: ${topUrl}`);
  console.log(`shoe ref: ${shoeUrl}`);

  const inputBuf = await fs.promises.readFile(inputPng);
  const [topBuf, shoeBuf] = await Promise.all([downloadFromGCS(topUrl), downloadFromGCS(shoeUrl)]);
  const prompt = buildPrompt(topDescription, view);
  const result = await callCombined(inputBuf, topBuf, shoeBuf, prompt);
  const outDir = '/tmp/m04_replay';
  await fs.promises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${outName}.png`);
  await fs.promises.writeFile(outPath, result);
  console.log(`[wrote] ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
