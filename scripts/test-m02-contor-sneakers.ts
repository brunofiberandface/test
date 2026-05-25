/**
 * M02 (cropped back) test on CONTOR × white/grey sneakers.
 *
 * Setup matches production matrix-paint M02:
 *  IMAGE 1 = matrix base (model in target shoes + placeholder pants) — use legsBack view (cropped back)
 *  IMAGE 2 = CONTOR fit-model straight back
 *
 * Two prompt variants:
 *  A) lean (current production, rev28 verbatim)
 *  B) lean + UNIVERSAL HEM-OVER-SHOE LAYER ORDER block from M04 rev49
 *
 * 3 runs each = 12 total renders.
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
const SHOES = [
  { id: 'white', wardrobeId: '3xKezovO6eef7SJfMioC' },
  { id: 'grey',  wardrobeId: 'xaVs4I5KFQKq5AEq5m6I' },
];
const F_MODEL_ID = 'F3';
const RUNS = 3;

const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/m02-contor-sneakers');
fs.mkdirSync(OUT_DIR, { recursive: true });

const LEAN = `Apply the fitmodel trousers onto the AI model with shoes. so merge the two images, but the trousers should be fully respected in form and fit. all details need to be preserved, IMPORTANT is the trousers run naturally down respecting the fitmodel lenght of the trousers. the model needs to stand equally on 2 feet, 50% on each foot, keeping the same position as the underwear model.`;

const LAYER_ORDER = `

UNIVERSAL HEM-OVER-SHOE LAYER ORDER (applies whenever the hem reaches or extends past the top of the shoe):
- The pant fabric is the OUTER layer; the shoe is the INNER layer beneath it. The hem fabric drapes over and on top of the shoe, layered ABOVE the shoe upper.
- For lace-up shoes (sneakers, oxfords, derbies, brogues): the laces and tongue area sit beneath the pant fabric, partially or fully covered by the fabric draped on top from above. The pant hem cascades onto the shoe vamp. The shoe sole, toe-box, and the front-most edge of the upper remain visible below the cascading hem.
- For boots (cowboy boots, ankle boots, chelsea boots, knee-high boots): the pant fabric falls OUTSIDE the boot shaft, draping down the exterior of the boot from above. The boot opening at the top of the shaft contains only the leg, never the pant fabric — the pant hem ends above the boot top and falls down the outside of the boot, not into it.
- For sandals, slides, mules, and any open footwear: the pant fabric drapes over the foot and any straps in the same OUTER-layer relationship.
- The pant hem always touches the shoe from above. There is no airborne gap between the bottom of the hem and the top of the shoe — fabric and shoe meet wherever the silhouette places that meeting point, with the fabric resting on or over the shoe.

Do NOT shorten the hem above the length the fit-model shows. Do NOT terminate the hem at the top of the shoe.`;

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const contorDoc = await db.collection('wardrobe').doc(CONTOR_ID).get();
  const contor = contorDoc.data() as any;
  const contorFitBack = contor.fitModels?.back;
  if (!contorFitBack) throw new Error('CONTOR has no fit-model back');
  console.log(`CONTOR fit-model back: ${contorFitBack}`);

  for (const shoe of SHOES) {
    const matrixDoc = await db.collection('qaShoeMatrix').doc(`${shoe.wardrobeId}_${F_MODEL_ID}`).get();
    const matrix = matrixDoc.data() as any;
    const matrixBaseUrl = matrix?.images?.legsBack;
    if (!matrixBaseUrl) {
      console.error(`No legsBack for ${shoe.id}`);
      continue;
    }
    console.log(`\n=== ${shoe.id} sneaker — base: ${matrixBaseUrl} ===`);

    for (const variant of ['A_lean', 'B_lean_plus_layerorder'] as const) {
      const prompt = variant === 'A_lean' ? LEAN : LEAN + LAYER_ORDER;
      console.log(`\n  variant ${variant} (${prompt.length} chars)`);
      for (let i = 1; i <= RUNS; i++) {
        console.log(`    run ${i}/${RUNS}`);
        const refs = [
          { url: matrixBaseUrl, label: 'IMAGE 1: matrix base (model in target shoes, placeholder pants)' },
          { url: contorFitBack, label: 'IMAGE 2: CONTOR fit-model straight back' },
        ];
        const t0 = Date.now();
        try {
          const result = await generateSeedreamImage({
            prompt,
            referenceImages: refs,
            aspectRatio: '9:16',
            model: 'seedream-4-5-251128',
          });
          const dt = ((Date.now() - t0) / 1000).toFixed(1);
          fs.writeFileSync(path.join(OUT_DIR, `${shoe.id}_${variant}_run${i}.png`), result.imageData);
          console.log(`    DONE ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
        } catch (e) {
          console.error(`    FAILED: ${(e as Error).message}`);
        }
      }
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
