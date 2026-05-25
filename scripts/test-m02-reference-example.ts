/**
 * M02 test with a NEW THIRD REFERENCE IMAGE — an example showing the
 * correct pant-over-shoe layering (cream wide-leg trousers cascading over
 * black sneakers). Goal: give Seedream a visual example of the layer order
 * instead of relying on text alone.
 *
 * CRITICAL: The example image's shoes and pants are FOR LAYERING REFERENCE
 * ONLY — they must not bleed into the output. The output must use the
 * trousers from IMAGE 2 (CONTOR fit-model) and the shoes from IMAGE 1
 * (matrix base — F3 model in white sneaker + placeholder pants).
 *
 * Test: CONTOR × white sneaker, 3 runs.
 */
import * as path from 'path';
import * as fs from 'fs';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { Firestore } from '@google-cloud/firestore';
import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';

const CONTOR_ID = 'ZB2GMhoH1hQDjdJQbD6d';
const WHITE_SHOE_ID = '3xKezovO6eef7SJfMioC';
const F_MODEL_ID = 'F3';
const RUNS = 3;
const REFERENCE_EXAMPLE_URL = 'https://storage.googleapis.com/gstar-ai-studio-assets/test/reference-pant-over-shoe.png';

const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/m02-reference-example');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROMPT = `Apply the fitmodel trousers onto the AI model with shoes. so merge the two images, but the trousers should be fully respected in form and fit. all details need to be preserved, IMPORTANT is the trousers run naturally down respecting the fitmodel lenght of the trousers. the model needs to stand equally on 2 feet, 50% on each foot, keeping the same position as the underwear model.

IMAGE 3 is an EXAMPLE showing how a wide-leg pant cascades over and on top of sneakers — the cream pant fabric drapes down over the back of the dark sneakers, and only the sole and the back rim of the shoe are visible below the cascading hem. Use IMAGE 3 ONLY as a layering reference — its specific pant color, pant material, shoe colour, and shoe shape are not relevant. The trousers in the OUTPUT are the ones from IMAGE 2; the shoes in the OUTPUT are the ones from IMAGE 1. IMAGE 3 only demonstrates the spatial relationship between pant and shoe.

UNIVERSAL HEM-OVER-SHOE LAYER ORDER (applies whenever the hem reaches or extends past the top of the shoe):
- The pant fabric is the OUTER layer; the shoe is the INNER layer beneath it. The hem fabric drapes over and on top of the shoe, layered ABOVE the shoe upper.
- For lace-up shoes (sneakers, oxfords, derbies, brogues): the laces and tongue area sit beneath the pant fabric, partially or fully covered by the fabric draped on top from above. The pant hem cascades onto the shoe vamp. The shoe sole, toe-box, and the front-most edge of the upper remain visible below the cascading hem.
- For boots: the pant fabric falls OUTSIDE the boot shaft, draping down the exterior of the boot. The boot opening contains only the leg, never the pant fabric — the pant hem ends above the boot top and falls down the outside.
- For sandals, slides, mules: the pant fabric drapes over the foot and any straps in the same OUTER-layer relationship.
- The pant hem always touches the shoe from above. There is no airborne gap between the bottom of the hem and the top of the shoe.

Do NOT shorten the hem above the length the fit-model shows. Do NOT terminate the hem at the top of the shoe.`;

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const contorDoc = await db.collection('wardrobe').doc(CONTOR_ID).get();
  const contorFitBack = (contorDoc.data() as any).fitModels?.back;

  const matrixDoc = await db.collection('qaShoeMatrix').doc(`${WHITE_SHOE_ID}_${F_MODEL_ID}`).get();
  const baseUrl = (matrixDoc.data() as any).images?.legsBack;

  console.log(`Refs:`);
  console.log(`  IMAGE 1 matrix base: ${baseUrl}`);
  console.log(`  IMAGE 2 CONTOR fit-back: ${contorFitBack}`);
  console.log(`  IMAGE 3 layering example: ${REFERENCE_EXAMPLE_URL}`);
  console.log(`Prompt length: ${PROMPT.length} chars`);

  for (let i = 1; i <= RUNS; i++) {
    console.log(`\n=== run ${i}/${RUNS} ===`);
    const refs = [
      { url: baseUrl, label: 'IMAGE 1: matrix base (model in white sneakers, placeholder pants)' },
      { url: contorFitBack, label: 'IMAGE 2: CONTOR fit-model straight back' },
      { url: REFERENCE_EXAMPLE_URL, label: 'IMAGE 3: layering example (pant cascades over sneaker)' },
    ];
    const t0 = Date.now();
    try {
      const result = await generateSeedreamImage({
        prompt: PROMPT,
        referenceImages: refs,
        aspectRatio: '9:16',
        model: 'seedream-4-5-251128',
      });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      fs.writeFileSync(path.join(OUT_DIR, `run${i}.png`), result.imageData);
      console.log(`DONE ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
    } catch (e) {
      console.error(`FAILED: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
