/**
 * v2 consistency check: run the v2 prompt 3× per shoe to validate
 * the low-profile cut is honored consistently (not a single-seed fluke).
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

const SOURCE = path.join(projectRoot, 'test_outputs/sole-mode/barefeet-single/contor_run4.png');
const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/low-profile-composite-v2-consistency');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SHOES = [
  { id: 'white', material: 'white leather',
    asset: path.join(projectRoot, 'test_outputs/sole-mode/low-profile-shoe-assets/white-sneaker.png') },
  { id: 'grey', material: 'grey suede',
    asset: path.join(projectRoot, 'test_outputs/sole-mode/low-profile-shoe-assets/grey-sneaker.png') },
  { id: 'brown', material: 'brown suede with brown stacked leather heel',
    asset: path.join(projectRoot, 'test_outputs/sole-mode/low-profile-shoe-assets/brown-suede-boot.png') },
];

const RUNS_PER_SHOE = 3;

function buildPrompt(material: string) {
  return `IMAGE 1 is a back-view photograph of a model in wide-leg jeans, currently barefoot. IMAGE 2 shows a pair of LOW-PROFILE BACKLESS FOOTWEAR in ${material} on a neutral studio floor — heels facing camera, toes pointing away. The footwear consists ONLY of the sole plus a roughly 1cm lip of material above the sole. There is no full upper, no tongue, no laces, no ankle collar, no heel cup — those parts have been cut away.

TASK: Place the EXACT pair of footwear from IMAGE 2 under the model's feet in IMAGE 1, at the same floor position where the bare feet currently are, oriented identically to IMAGE 2 (heels facing camera, toes pointing away).

Render the footwear with the SAME LOW-PROFILE CUT as IMAGE 2 — sole plus ~1cm lip only. Do NOT extend the upper. Do NOT fill in a tongue, laces, ankle collar, or heel cup. Do NOT render a full shoe. Whatever is missing in IMAGE 2 stays missing in the result.

Match material and colour from IMAGE 2 exactly: ${material}, with the sole construction visible in IMAGE 2. Do NOT invent branding or text.

PANT-OVER-FOOTWEAR OCCLUSION (BACK VIEW):
The pant length, cut, silhouette, construction, and hem position are defined by IMAGE 1. Follow IMAGE 1 exactly. Do not lengthen, shorten, or restyle the pant.

This rule applies ONLY at the region where the pant and the footwear overlap. If the pant ends above the footwear and there is no overlap, this rule does nothing.

WHERE PANT AND FOOTWEAR OVERLAP:
The pant fabric is the foreground layer. The footwear is behind it. The denim covers and hides whatever portion of the footwear is behind it. The pant fabric does NOT terminate at the footwear's outline. The pant fabric does NOT tuck behind, into, or under the footwear. The pant fabric does NOT trace the silhouette of the footwear.

Whatever portion of the footwear is below the pant hem stays fully visible — the back of the heel area, the midsole, and the sole touching the floor. Because the footwear is low-profile (sole + 1cm lip only), most of the footwear sits below the hem and remains visible as a thin layer at floor level.

PRESERVE everything else in IMAGE 1 exactly: model identity, body, pose, arms, upper torso, the pant silhouette and construction (panel seams, anatomical outseams, knee panels, washes, pockets, waistband), backdrop, lighting, framing.`;
}

async function main() {
  const srcBuf = fs.readFileSync(SOURCE);
  for (const shoe of SHOES) {
    const assetBuf = fs.readFileSync(shoe.asset);
    const prompt = buildPrompt(shoe.material);
    for (let i = 1; i <= RUNS_PER_SHOE; i++) {
      console.log(`\n=== ${shoe.id} run ${i}/${RUNS_PER_SHOE} ===`);
      const t0 = Date.now();
      try {
        const result = await generateImage({
          prompt,
          referenceImages: [
            { buffer: srcBuf, mimeType: 'image/png', label: 'IMAGE 1 — bare-feet target render with wide-leg jeans.' },
            { buffer: assetBuf, mimeType: 'image/png', label: `IMAGE 2 — low-profile backless ${shoe.material} footwear (sole + ~1cm lip only, no upper).` },
          ],
          aspectRatio: '1:1',
          imageSize: '4K',
          model: 'gemini-3-pro-image-preview',
        });
        const dt = ((Date.now() - t0) / 1000).toFixed(1);
        fs.writeFileSync(path.join(OUT_DIR, `${shoe.id}_run${i}.png`), result.imageData);
        console.log(`DONE in ${dt}s — ${(result.imageData.length / 1024).toFixed(0)}KB`);
      } catch (e) {
        console.error(`FAILED: ${(e as Error).message}`);
      }
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
