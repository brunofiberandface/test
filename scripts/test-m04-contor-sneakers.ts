/**
 * Test the production M04 rev49 prompt template on CONTOR back-view +
 * white sneaker / grey sneaker via Seedream. Substitute the CONTOR
 * silhouetteBack into {silhouette}, plug in shoe descriptions, send the
 * full ref bundle the production M04 uses.
 *
 * Goal: see if the production prompt + CONTOR PART B actually solves the
 * "hem stops at top of low sneaker" problem, or whether the prompt alone
 * isn't enough.
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
import { generateSeedreamImage } from '../src/lib/pipeline/seedream-client';

const SHOE_TESTS = [
  { id: 'white', wardrobeId: '3xKezovO6eef7SJfMioC', desc: 'white leather low-top sneaker' },
  { id: 'grey', wardrobeId: 'xaVs4I5KFQKq5AEq5m6I', desc: 'grey low-top sneaker' },
];

const CONTOR_ID = 'ZB2GMhoH1hQDjdJQbD6d';
const F_MODEL_ID = 'F3'; // F3 model is the one in our barefoot baseline
const RUNS_PER_SHOE = 3;
const TOP_DESC = 'plain white tucked-in cotton t-shirt, crew neck, short sleeves';

const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/m04-contor-sneakers');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Active M04 rev49 prompt body — Step 2 (post-changelog header)
const M04_REV49 = `Photorealistic studio e-commerce photograph, 3:4 portrait aspect ratio, full body back view. Model facing directly away from the camera. Full body fits in frame from the top of the head to below the shoes, with about 3% padding above the head and 3% padding below the lowest fabric edge of the garment. Sharp focus across the whole subject, high detail, color accurate, consistent proportions.

### Backdrop & Lighting
Backdrop is a single continuous smooth sweep of neutral cool light-grey (averaging hex #D9DAD2, with a subtle natural falloff from #DADBD3 at the top to #D7D8D0 at the floor), wrapping seamlessly from wall to floor. The tone is perfectly even edge to edge across the whole frame. Studio lighting is soft, fully diffused, and white-balanced to 5500K. Light comes from the front and slightly above eye level, producing even illumination across the model. A soft, subtle contact shadow sits naturally at the feet. The frame contains only the backdrop, the model, and the floor surface beneath the feet.

The studio set in this output is rendered from this prompt description only — a fresh, untouched studio sweep, smooth and pristine. The fit-model reference photos in the input may show studio marks, scuffs, or surface texture from the original shoot; those belong to the source photos and are not part of this render.

### Skin & Face Rendering — CRITICAL
This is a documentary product photograph, not a glamour or fashion editorial. The model's face is rendered as completely natural and unretouched. NO makeup, NO blush, NO rouge, NO contour, NO bronzer, NO cosmetic color anywhere on the face. NO color grading or color enhancement applied to skin areas. The face is rendered raw, plain, and bare.

The MODEL IDENTITY REFERENCE image shows the model exactly as she should appear in this render — her actual complexion, her actual skin tone, her actual cheek pigmentation. Render the face exactly as the MODEL IDENTITY REFERENCE shows it: same complexion depth, same undertone, same neutral cheek tone matching the rest of the face.

In the rendered output, the cheek apples are the SAME tone as the forehead and chin — no localized color shift, no makeup-style cheek accent, no rosy bloom on the cheekbones. The skin pigmentation is even and continuous across the entire face. The cheekbone area shows soft natural shadow modeling under even studio light, but the COLOR of the cheek is identical to the COLOR of the forehead.

The MODEL IDENTITY REFERENCE is the exclusive authority for: skin tone, skin pigmentation, complexion, hair color, eye color, facial features, and the model's overall coloration.

The FIT MODEL REFERENCE photographs are real studio photography with their own particular lighting and color rendering baked into the source pixels. Use the fit-model photographs ONLY for the garment's fit, drape, silhouette, pose geometry, fabric behavior, and construction details. The fit-model photographs are NOT a source for skin tone, complexion, hair color, lighting tint, color rendering, or any aspect of the model's appearance — those come exclusively from the MODEL IDENTITY REFERENCE.

The garment in the rendered output keeps its exact source colors — fabric color, contrast stitching color, hardware metal tone, and label colors are rendered exactly as shown in the garment flat and fit-model references. Skin-tone fidelity is achieved by anchoring skin to the model identity reference, NOT by shifting any garment color.

### Pose & Proportions
STRICT REQUIREMENT: Pose is strictly neutral, bilaterally symmetric, and geometrically aligned. NO CONTRAPPOSTO. NO WEIGHT SHIFT. NO HIP TILT. NO HIP POP. NO SHOULDER DROP. NO KNEE BEND. NO STAGGERED OR CROSSED FEET. NO ASYMMETRY OF ANY KIND. Do not apply default fashion-photography posing conventions or stylistic body positioning.

Core alignment: The model's body is perfectly mirrored across a vertical centerline running from the crown of the head, through the centre of the back of the head, the centre of the spine, the centre of the waistband, the midline between the legs, and straight down to the floor at the midpoint between both feet. Every visible feature on the left side of the body has its exact mirror equivalent on the right side — at identical height, identical distance from the centerline, and identical angle.

Weight distribution: Exactly 50/50 across both feet — neither leg carries more weight, neither leg acts as a primary support. Both feet are fully flat on the floor at the same forward depth (no foot in front of the other, no offset). Feet are perfectly parallel, toes pointing directly away from the camera, no inward or outward rotation.

Leg and hip alignment:
- Gap between inner feet is exactly equal to the total width of the pelvis.
- Each foot sits directly vertically beneath its corresponding hip joint — a straight vertical line can be drawn from each hip joint straight down to the foot below it, no lateral offset.
- Knees are perfectly level (same height) and both legs are equally straight and rigid in alignment — no bending, softening, locking, or relaxation of either knee.
- Hips are perfectly square and facing directly away from the camera; hip bones are aligned horizontally, belt line is perfectly horizontal across the entire frame with zero tilt or angle.

Torso and arm alignment:
- Shoulders perfectly level — left and right shoulder joints at identical height — and fully square to the camera with the back facing the lens.
- Arms hang straight down the sides with a small natural gap from the torso, equal on both sides, so the back waistband and back pockets stay fully visible. The left arm and right arm mirror each other exactly in angle, distance from body, and placement along the torso.
- Hands relaxed, fingers slightly separated, in a natural resting position. Both hands match each other in shape and orientation.

Reference rule: The Fit Model Back Angle photos in the input are the SOURCE OF TRUTH for body proportions, pose geometry, and garment SHAPE. Replicate every element of the pose exactly — flat feet, vertical hip-to-foot alignment, 50/50 weight, straight legs, level hips, level shoulders. The fit-model photos may show the garment on bare feet; the production render places the same garment over the actual shoes specified for this shot, with the hem behaving as the silhouette description specifies. Do not introduce posing elements common in fashion photography (including but not limited to: contrapposto, weight shift to one leg, hip pop, shoulder tilt, knee bend, crossed feet, staggered stance, or asymmetric limb positioning).

### Head
Head held upright, facing directly away from the camera.

### Garment
The model wears the {garment_type} as displayed in the fit-model back photographs. Use those photos as the EXCLUSIVE source of truth for the garment's identity — base color, fabric texture and finish, all back-panel seam lines, waistband and back-yoke construction (whatever shape and style the fit-model photos show — a curved jean yoke, a flat tailored waistband, or any other construction), belt-loop positioning and spacing, the actual back-detail construction (patch pockets, welt pockets, flap pockets, or no pockets — render only what the fit-model photos show), and overall silhouette shape.

STRICT REQUIREMENT — NO LAYERED BOTTOMS:
- The {garment_type} is the SOLE bottom garment in this render. NO SECOND PAIR OF PANTS, SHORTS, OR TROUSERS layered behind, beneath, or above the {garment_type}.
- NO SECOND WAISTBAND visible — only the {garment_type}'s own waistband appears in the frame.
- NO STYLING GARMENT PEEKING OUT from above, behind, or beside the {garment_type}.
- The space immediately above the {garment_type}'s waistband shows ONLY the tucked top fabric — no other garment, no contrast band, no exposed belt loop or fabric strip from a different layer.
- Apply this rule regardless of the {garment_type}'s material — whether denim, wool, twill, velvet, or any other fabric, the {garment_type} is the only bottom garment present. (For denim {garment_type}s: the visible waistband is the jean's own waistband, not a second layered one.)

{silhouette} description below specifies the per-garment particulars — fabric type, weave or wash, pocket construction, label position, and any other distinguishing features. Combine the fit-model photos and the silhouette text as the authoritative answer for what this specific garment looks like.

Do NOT invent pockets, yokes, hardware, washes, fades, layered waistbands, contrast bands, or any detail that is not present in either the fit-model photos OR the silhouette description. Do not carry over studio set, floor texture, or surface marks from the fit-model photos.

{silhouette}

### Top
{top_description}, fully tucked neatly into the garment waistband. The waistband line is clear and unobscured, with a clean visual separation between the top fabric and the {garment_type}.

The top reference photos provided as inputs may show the top styled with jeans or other garments in their original product photography (this is normal — brand product shots typically style the top with denim). Use those references EXCLUSIVELY for the top's color, fabric, weave, fit, neckline, sleeve, and silhouette. Do NOT carry over any other garments visible in those references — no jeans, no denim layer, no contrast waistband from another garment, no styling pieces, no second waistband stacked behind the {garment_type}'s waistband. The {garment_type} sits directly on the model's body and is the sole bottom garment from waist to hem; the only thing visible immediately above its waistband is the tucked top fabric of the {top_description}.

### Hem & Footwear
Render the garment hem exactly as the silhouette description specifies — its finished length (whether floor-length, cropped, cuffed, mid-calf, above-ankle, or otherwise), opening width, fabric drape behavior, and how the hem interacts with the footwear.

The silhouette's PART A describes what the garment looks like in the fit-model photos (typically on bare feet); the silhouette's PART B describes the production rendering with the actual shoes for this shot. Follow PART B exactly for length and shoe interaction. Where PART B describes drape over the shoe (full-length garments), fabric falls naturally over and around the shape of the shoes, draping softly to cover whatever the silhouette says it covers. Where PART B describes a cropped, cuffed, or above-ankle hem, render the hem at exactly that height with the corresponding portion of the foot or shoe visible below.

Footwear is the {shoes_description}, matching the shoes reference imagery exactly. Do NOT extend the hem beyond the length the silhouette specifies. Do NOT shorten the hem above the length the silhouette specifies. Do NOT invent stacking, breaking, pooling, or cuffing behavior that the silhouette does not describe.

UNIVERSAL HEM-OVER-SHOE LAYER ORDER (applies whenever the hem reaches or extends past the top of the shoe):
- The pant fabric is the OUTER layer; the shoe is the INNER layer beneath it. The hem fabric drapes over and on top of the shoe, layered ABOVE the shoe upper.
- For lace-up shoes (sneakers, oxfords, derbies, brogues): the laces and tongue area sit beneath the pant fabric, partially or fully covered by the fabric draped on top from above. The pant hem cascades onto the shoe vamp. The shoe sole, toe-box, and the front-most edge of the upper remain visible below the cascading hem.
- For boots (cowboy boots, ankle boots, chelsea boots, knee-high boots): the pant fabric falls OUTSIDE the boot shaft, draping down the exterior of the boot from above. The boot opening at the top of the shaft contains only the leg, never the pant fabric — the pant hem ends above the boot top and falls down the outside of the boot, not into it.
- For sandals, slides, mules, and any open footwear: the pant fabric drapes over the foot and any straps in the same OUTER-layer relationship.
- The pant hem always touches the shoe from above. There is no airborne gap between the bottom of the hem and the top of the shoe — fabric and shoe meet wherever the silhouette places that meeting point, with the fabric resting on or over the shoe.

The above layer-order rule is universal. The silhouette's PART B specifies WHERE on the shoe the hem rests (covering laces, mid-vamp, ankle bone, calf, boot shaft, etc.) and HOW the hem behaves there (clean break, soft cascade, stacking, gathering); the layer-order rule above specifies that wherever PART B places the meeting point, the fabric is positioned ABOVE the shoe and falls down the outside, never tucked inside, never floating in the air above the shoe.`;

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  // Pull CONTOR refs
  const contorDoc = await db.collection('wardrobe').doc(CONTOR_ID).get();
  const contor = contorDoc.data() as any;
  const contorFlatBack = contor.flatBackUrl;
  const contorFitBack = contor.fitModels?.back;
  const contorFitFront = contor.fitModels?.front;
  const silhouetteBack = contor.silhouetteBack;

  // Pull model identity ref (F3)
  const aiModelDoc = await db.collection('models').doc(F_MODEL_ID).get();
  const aiModel = aiModelDoc.data() as any;
  const modelRefUrl = aiModel?.referenceImageUrl || aiModel?.cardImageUrl;
  const modelBackRefUrl = aiModel?.backReferenceImageUrl;
  if (!modelRefUrl) throw new Error(`F3 model has no referenceImageUrl/cardImageUrl`);

  console.log(`CONTOR refs:`);
  console.log(`  flatBack: ${contorFlatBack ? '✓' : '✗'}`);
  console.log(`  fitBack: ${contorFitBack ? '✓' : '✗'}`);
  console.log(`  fitFront: ${contorFitFront ? '✓' : '✗'}`);
  console.log(`  silhouetteBack: ${silhouetteBack ? silhouetteBack.length + ' chars' : '✗'}`);
  console.log(`F3 modelRef: ${modelRefUrl ? '✓' : '✗'}`);

  for (const shoe of SHOE_TESTS) {
    const shoeDoc = await db.collection('wardrobe').doc(shoe.wardrobeId).get();
    const shoeData = shoeDoc.data() as any;
    const shoeBackUrl = shoeData.flatBackUrl;
    const shoeFrontUrl = shoeData.flatFrontUrl;
    console.log(`\n=== Shoe: ${shoe.desc} (${shoe.wardrobeId}) ===`);
    console.log(`  back: ${shoeBackUrl ? '✓' : '✗'} front: ${shoeFrontUrl ? '✓' : '✗'}`);

    const prompt = M04_REV49
      .replace(/{garment_type}/g, 'Contor 3D Wide jeans')
      .replace(/{silhouette}/g, silhouetteBack)
      .replace(/{top_description}/g, TOP_DESC)
      .replace(/{shoes_description}/g, shoe.desc);

    console.log(`Prompt length: ${prompt.length} chars`);

    for (let i = 1; i <= RUNS_PER_SHOE; i++) {
      console.log(`\n--- ${shoe.id} run ${i}/${RUNS_PER_SHOE} ---`);
      const refs = [
        { url: modelRefUrl, label: '1. MODEL IDENTITY REFERENCE' },
        { url: contorFitBack, label: '2. Fit Model Back' },
        { url: contorFlatBack, label: '3. Garment Flat Back' },
        { url: contorFitFront, label: '4. Fit Model Front (anchor)' },
        { url: shoeBackUrl || shoeFrontUrl, label: '5. Shoes Reference Back' },
      ].filter(r => r.url);

      const t0 = Date.now();
      try {
        const result = await generateSeedreamImage({
          prompt,
          referenceImages: refs,
          aspectRatio: '3:4',
          model: 'seedream-4-5-251128',
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
