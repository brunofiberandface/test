/**
 * Test 3 camera angle options for top-focus M05:
 *   A — Side profile shoulder hero (camera ~90° side)
 *   B — 3/4 rear-side shoulder (camera ~135° over-the-shoulder behind)
 *   C — 3/4 front-side shoulder (camera ~45°)
 *
 * Same fixture, same refs, same model. Different camera angle prompt.
 * Outputs 3 PNGs to /tmp/m05_replay/.
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

import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';
import { ensureSeedreamSafeUrl } from '../src/lib/pipeline/seedream-image-safe';
import { Firestore } from '@google-cloud/firestore';

const JOB_ID = '7mBFaFsSXvkmtAhZSb4D';  // Raw denim kick jacket / F16

function buildPrompt(option: 'A' | 'B' | 'C'): string {
  const base = (cameraSection: string) => `Tight product-photography close-up framing on the model's shoulder area to showcase the {garment_type}. Photorealistic, sharp focus, ultra-high detail, color accurate, neutral white-balanced, commercial studio quality.

${cameraSection}

═══ FRAME — TIGHT ON SHOULDER ═══
The frame is bounded anatomically:
- TOP edge: just above the shoulder line, with the very top of the head visible only as a small slice OR cropped above the ear.
- BOTTOM edge: at mid-chest / upper-rib area.
- The shoulder (with shoulder seam, sleeve cap, side of neckline) is the hero of the composition and fills ~40-50% of the frame.
- The face is partially visible but NOT the main subject — the GARMENT around the shoulder is the hero.
- NO waist, NO hips, NO arms below the elbow, NO hands.

═══ HERO — the top garment's shoulder construction ═══
The visual hero is the back/side of the model's shoulder showing:
- Shoulder seam stitching
- Sleeve cap fit
- Top fabric texture and color at the shoulder
- Neckline edge (side view, from the side)
- Any visible collar / lapel / hood
- For jackets: the upper sleeve construction and how the shoulder seam falls

═══ Studio set & Lighting ═══
Clean light-grey studio backdrop (#D9DAD2). Soft diffused 5500K lighting, even illumination. No backdrop variation, scuffs, or marks.

═══ Outfit ═══
The model wears the {top_description} (FOCUS) as shown in the FIT MODEL angles / FLAT references. Color, fabric, fit match exactly. The bottom (jeans) may be visible as a small slice at the very bottom of the frame, or not at all.

═══ Identity ═══
Skin tone and complexion match the MODEL CARD references. Hair color/texture as shown.

{silhouette}
`;

  if (option === 'A') {
    // Side profile, shoulder dominant
    return base(`═══ CAMERA POSITION — SIDE PROFILE (90°) ═══

The camera is positioned at the model's SIDE — approximately 90° from a front-facing position. The model's body faces left or right (perpendicular to the camera). We see the model's profile silhouette.

Camera height: at shoulder level. Lens horizontal, no upward or downward tilt.

The composition shows the SIDE PROFILE of the shoulder: shoulder seam in clear profile, sleeve cap visible in profile, neckline edge in profile, side of the face partially visible.

Lens: 85-100mm equivalent, no wide-angle distortion.

This is a SIDE PROFILE shoulder shot — like a pure left-side or right-side view, head-and-shoulders height crop.`);
  }
  if (option === 'B') {
    // 3/4 rear-side
    return base(`═══ CAMERA POSITION — 3/4 REAR-SIDE OVER-THE-SHOULDER (135°) ═══

The camera is positioned BEHIND-AND-TO-THE-SIDE of the model — approximately 135° from a front-facing position (i.e. 45° past pure side, toward the back). We see the model from over-the-shoulder, behind: the back of the shoulder, upper back, side of the shoulder, with a sliver of the side of the face visible.

Camera height: at shoulder level. Lens horizontal, no upward or downward tilt.

The composition shows the BACK + SIDE of the shoulder: shoulder yoke seam, back-side of the sleeve cap, upper back, side of neckline going around.

Lens: 85-100mm equivalent, no wide-angle distortion.

This is an OVER-THE-SHOULDER FROM BEHIND shoulder shot — like a 3/4 rear angle with the camera roughly behind the model's left or right shoulder.`);
  }
  // C — 3/4 front-side
  return base(`═══ CAMERA POSITION — 3/4 FRONT-SIDE (45°) ═══

The camera is positioned to the FRONT-AND-SIDE of the model — approximately 45° from a pure front-facing position. The model's body is mostly facing the camera with a soft 45° rotation. We see the front-side of the shoulder: collar / neckline visible from a soft diagonal, front-side of the sleeve cap, side of the face partially visible.

Camera height: at shoulder level. Lens horizontal, no upward or downward tilt.

The composition shows the FRONT + SIDE of the shoulder: front collar/neckline, shoulder seam from a 45° angle, front-side of the sleeve cap.

Lens: 85-100mm equivalent, no wide-angle distortion.

This is a 3/4 FRONT angle shoulder shot — like a soft 45° from the front, head-and-shoulders height crop.`);
}

async function main() {
  const option = (process.argv[2] || 'A') as 'A' | 'B' | 'C';
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({ projectId: saKey.project_id || 'gstar-ai-studio', credentials: { client_email: saKey.client_email, private_key: saKey.private_key } });

  const jobDoc = await db.collection('jobs').doc(JOB_ID).get();
  const job = jobDoc.data() as any;
  console.log(`Job: ${job.jobName}  model=${job.modelId}`);

  const modelDoc = await db.collection('models').doc(job.modelId).get();
  const model = modelDoc.data() as any;
  const topDoc = await db.collection('wardrobe').doc(job.wardrobe.top.itemId).get();
  const top = topDoc.data() as any;

  const refs: { url: string; label: string }[] = [];
  if (top.flatFrontUrl) refs.push({ url: top.flatFrontUrl.split('?')[0], label: 'TOP FLAT FRONT — exclusive source for the top garment color, fabric, hardware, closure, sleeves, neckline.' });
  if (top.flatBackUrl) refs.push({ url: top.flatBackUrl.split('?')[0], label: 'TOP FLAT BACK — back-panel construction for the top: yoke, back-shoulder seam, any back labels.' });
  const fm = top.fitModels || {};
  for (const k of ['front', 'front45Right', 'front45Left', 'back45Right', 'back45Left']) {
    if (fm[k]) refs.push({ url: fm[k].split('?')[0], label: `FIT MODEL ${k.toUpperCase()} — top garment on a fit model. Use ONLY for the top's fit, drape, shoulder fit, sleeve cap.` });
    if (refs.length >= 7) break;
  }
  if (model?.referenceImageUrl) refs.push({ url: model.referenceImageUrl.split('?')[0], label: 'MODEL CARD FRONT — exclusive identity reference (skin tone, hair, facial features).' });

  // Mirror cleanUrl through safe-url wrapper
  const safeRefs = await Promise.all(refs.map(async r => ({ url: await ensureSeedreamSafeUrl(r.url), label: r.label })));

  const prompt = buildPrompt(option)
    .replace(/{garment_type}/g, top.name || 'top garment')
    .replace(/{top_description}/g, top.topDescription || top.description || top.name || 'top garment')
    .replace(/{silhouette}/g, '');

  console.log(`Option ${option}: ${safeRefs.length} refs, prompt ${prompt.length} chars`);

  const t0 = Date.now();
  const result = await generateSeedreamImage({
    prompt,
    referenceImages: safeRefs,
    aspectRatio: '1:1',
  });
  console.log(`Done in ${((Date.now()-t0)/1000).toFixed(1)}s — ${result.imageData.length} bytes`);

  const outPath = `/tmp/m05_replay/topfocus_option_${option}.png`;
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, result.imageData);
  console.log(`[wrote] ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
