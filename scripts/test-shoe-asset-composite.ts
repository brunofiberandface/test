/**
 * Composite each pre-rendered shoe asset under the bare-feet CONTOR result.
 * The asset is a clean back-view of the pair of shoes on neutral floor —
 * different from the wardrobe flat which was a product shot. Gemini's job:
 * place those exact shoes under the model's feet, hem of jeans cascades
 * over the top of each shoe in occlusion.
 */
import * as fs from 'fs';
import * as path from 'path';
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');
import { generateImage } from '../src/lib/vertex';

// Source: a known long-hem bare-feet CONTOR (run4 from the SINGLE-anchor batch — confirmed by Bruno earlier)
const SOURCE = path.join(projectRoot, 'test_outputs/sole-mode/barefeet-single/contor_run4.png');
const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/asset-composite');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SHOES = [
  { id: 'white-sneaker', name: 'white leather low-top sneaker',
    asset: path.join(projectRoot, 'test_outputs/sole-mode/shoe-assets/white-sneaker.png') },
  { id: 'grey-sneaker', name: 'grey low-top sneaker',
    asset: path.join(projectRoot, 'test_outputs/sole-mode/shoe-assets/grey-sneaker.png') },
  { id: 'brown-suede-boot', name: 'brown suede ankle boot',
    asset: path.join(projectRoot, 'test_outputs/sole-mode/shoe-assets/brown-suede-boot.png') },
];

const LAYERING = `
PANT-OVER-SHOE OCCLUSION (BACK VIEW)

The pant length, cut, silhouette, construction, and hem position are defined by IMAGE 1. Follow IMAGE 1 exactly. Do not lengthen, shorten, or restyle the pant.

This rule applies ONLY at the region where the pant and the shoe overlap. If the pant ends above the shoe and there is no overlap, this rule does nothing.

WHERE PANT AND SHOE OVERLAP:
The pant fabric is the foreground layer. The shoe is behind it. The denim covers and hides the portion of the shoe behind it — the shoe's upper, tongue, laces, or ankle collar are obscured wherever pant fabric is in front of them.

The pant fabric does NOT terminate at the shoe's outline. The pant fabric does NOT tuck behind, into, or under the shoe. The pant fabric does NOT trace the silhouette of the shoe.

Whatever portion of the shoe is below the pant hem remains fully visible — the back of the heel, the midsole, and the sole touching the floor.
`.trim();

async function main() {
  const srcBuf = fs.readFileSync(SOURCE);
  for (const shoe of SHOES) {
    console.log(`\n=== ${shoe.name} (${shoe.id}) ===`);
    const assetBuf = fs.readFileSync(shoe.asset);

    const prompt = `IMAGE 1 is a back-view photograph of a model in wide-leg jeans, currently barefoot. IMAGE 2 is a clean back-view of a pair of ${shoe.name} on a neutral studio floor — heels facing camera, toes pointing away.

Place the EXACT pair of shoes from IMAGE 2 under the model's feet in IMAGE 1. The shoes appear at the same floor position as the model's feet, oriented identically to IMAGE 2 (heels facing camera, toes pointing away from camera).

Match the shoes from IMAGE 2 exactly: same material, same colour, same heel construction, same sole, same upper details, same proportions. Do NOT invent branding or text that does not appear in IMAGE 2.

${LAYERING}

PRESERVE everything else in IMAGE 1 exactly: model identity, body, pose, arms, upper torso, the pant silhouette and construction (panel seams, anatomical outseams, knee panels, washes, pockets, waistband), backdrop, lighting, framing.`;

    const t0 = Date.now();
    try {
      const result = await generateImage({
        prompt,
        referenceImages: [
          { buffer: srcBuf, mimeType: 'image/png', label: 'IMAGE 1 — bare-feet target render with wide-leg jeans. Preserve everything except add shoes from IMAGE 2 per the OCCLUSION rule.' },
          { buffer: assetBuf, mimeType: 'image/png', label: `IMAGE 2 — clean back-view of the pair of ${shoe.name}. Place exactly this pair under the model's feet.` },
        ],
        aspectRatio: '1:1',
        imageSize: '4K',
        model: 'gemini-3-pro-image-preview',
      });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      fs.writeFileSync(path.join(OUT_DIR, `${shoe.id}.png`), result.imageData);
      console.log(`DONE in ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
    } catch (e) {
      console.error(`FAILED: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
