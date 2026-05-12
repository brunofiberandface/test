/**
 * QA: shoe × model proportion matrix.
 *
 * Pre-renders every (model, shoe) pair as a basics + shoes Seedream call so
 * reviewers can audit shoe scale/fit per combination before it hits a real job.
 * Bad combos (e.g. chunky platform shoes that consistently render oversized on
 * a particular model) are flagged via the `blocked` field; the new-job wizard
 * warns when the user picks a blocked pair.
 *
 * One Firestore doc per cell at `qaShoeMatrix/{shoeId}_{modelId}` so it's
 * idempotent — re-rendering replaces the GCS object and bumps `updatedAt`.
 *
 * GCS path: `gs://gstar-ai-studio-assets/output/qa-matrix/{shoeId}/{modelId}.png`.
 *
 * NOT auto-triggered in v0 — operator runs the renders manually from
 * `/qa/shoe-matrix`. Auto-trigger on shoe upload is a v1 follow-up.
 */
import { getModel, getWardrobeItem, qaShoeMatrixCol } from '@/lib/firestore';
import { generateSeedreamImage, type SeedreamReferenceImage } from '@/lib/pipeline/seedream-client';
import { ensureSeedreamSafeUrl } from '@/lib/pipeline/seedream-image-safe';
import { uploadGeneratedImage } from '@/lib/gcs';
import { FieldValue } from '@google-cloud/firestore';

const STUDIO_BACKDROP_URL =
  'https://storage.googleapis.com/gstar-ai-studio-assets/backdrops/clean-studio-grey.jpg';

// Mirror the unified MODEL CARD (FRONT) label from seedream-generate.ts so the
// matrix render uses the exact same identity scoping as a real job. If those
// canonical labels change, update here too.
const MODEL_CARD_FRONT_LABEL =
  'MODEL CARD (FRONT) — canonical, exclusive source of truth for the model\'s ' +
  'identity. Match the model shown in this card identically: every facial feature ' +
  '(eye shape, eye color, nose, mouth, brow shape), the natural facial expression ' +
  'and presence as captured here, skin tone with undertone, freckle pattern, hair ' +
  'color and texture, body proportions. The face and expression in this card are ' +
  'exactly correct — preserve them precisely when the model\'s face is rendered. ' +
  'Lighting on the rendered model is neutral — do not transfer warm key lighting ' +
  'from any other reference.';

const SHOE_REF_LABEL =
  'SHOE REFERENCE — visual reference for the focus footwear style, color, ' +
  'material, leather finish, sole construction, and silhouette. Use this image ' +
  'for the shoe\'s appearance and design details only. The product-photography ' +
  'perspective in this reference is not a guide for render scale. Render the ' +
  'shoe at correct anatomical foot proportions for the AI model — a normal ' +
  'adult female shoe footprint, scaled to match the body and stance shown in ' +
  'the model reference.';

const STUDIO_BACKDROP_LABEL =
  'STUDIO BACKDROP — exact appearance for the seamless backdrop and floor ' +
  'surface in this render. Smooth seamless light-grey sweep, no texture, no ' +
  'patterns. NOT a source of pose, garment, or model identity — only the ' +
  'studio set.';

const MATRIX_PROMPT = `Photorealistic studio e-commerce photograph, 3:4 portrait, FRONT VIEW. Full body head-to-toe in frame, model facing camera. Backdrop: neutral cool light-grey (#D9DAD2). Soft diffused studio lighting, white-balanced 5500K.

Female model with the body, face, hair, and complexion shown in MODEL CARD (FRONT) (Image 2). Bilaterally symmetric pose, both feet flat at natural shoulder-width stance, weight 50/50 across both feet, arms hanging straight at sides with a small natural gap from the torso, hands relaxed.

### Outfit — base undergarments + footwear ONLY
This is a QA matrix render to verify shoe scale and fit per model. The model wears ONLY:
- A simple black sports bra (front view: thin straps, plain band, no detail)
- Simple low-rise black briefs / underwear bottom (plain athletic style)
- The footwear shown in SHOE REFERENCE (Image 3)

NOT wearing: NO t-shirt, NO top, NO pants, NO jeans, NO leggings, NO socks. Bare arms, bare upper torso, bare midriff, bare upper thighs, bare lower legs visible — natural skin tone matching the model reference.

### Footwear
Match SHOE REFERENCE (Image 3) for shape, color, material, and sole construction. Render the shoe at the AI model's natural foot proportions — a normal adult female shoe footprint, sized to match the body and stance. The product-photography perspective in the shoe reference is not a guide for render scale.

Clean studio-product render. Plain bra + briefs + shoes only. Front view, full body.`;

export type CellStatus = 'pending' | 'rendering' | 'done' | 'failed';

export interface ShoeMatrixCell {
  id: string; // `${shoeId}_${modelId}`
  shoeId: string;
  modelId: string;
  imageUrl?: string;
  status: CellStatus;
  blocked: boolean;
  blockedReason?: string;
  errorMessage?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

function cellId(shoeId: string, modelId: string): string {
  return `${shoeId}_${modelId}`;
}

/**
 * Render a single (shoe, model) cell. Synchronous — caller awaits ~40s for
 * the Seedream call. Writes the image to GCS at output/qa-matrix/{shoeId}/{modelId}.png
 * and upserts the Firestore doc.
 *
 * Throws on missing shoe/model/refs. Updates `status='failed'` + `errorMessage`
 * before throwing so the cell is visible in the UI as failed.
 */
export async function renderMatrixCell(
  shoeId: string,
  modelId: string,
): Promise<ShoeMatrixCell> {
  const id = cellId(shoeId, modelId);
  const docRef = qaShoeMatrixCol.doc(id);

  // Mark as rendering up front so the UI can show progress.
  await docRef.set(
    {
      shoeId,
      modelId,
      status: 'rendering' as CellStatus,
      blocked: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  try {
    const shoe = await getWardrobeItem(shoeId) as { flatFrontUrl?: string; name?: string } | null;
    if (!shoe) throw new Error(`Shoe ${shoeId} not found`);
    if (shoe.flatFrontUrl == null) throw new Error(`Shoe ${shoeId} has no flatFrontUrl`);

    const model = await getModel(modelId) as { referenceImageUrl?: string; cardImageUrl?: string } | null;
    if (!model) throw new Error(`Model ${modelId} not found`);
    const modelFrontUrl = model.referenceImageUrl || model.cardImageUrl;
    if (!modelFrontUrl) throw new Error(`Model ${modelId} has no card image`);

    const refs: SeedreamReferenceImage[] = [
      {
        url: await ensureSeedreamSafeUrl(STUDIO_BACKDROP_URL),
        label: STUDIO_BACKDROP_LABEL,
      },
      {
        url: await ensureSeedreamSafeUrl(modelFrontUrl.split('?')[0]),
        label: MODEL_CARD_FRONT_LABEL,
      },
      {
        url: await ensureSeedreamSafeUrl(shoe.flatFrontUrl.split('?')[0]),
        label: SHOE_REF_LABEL,
      },
    ];

    const result = await generateSeedreamImage({
      prompt: MATRIX_PROMPT,
      referenceImages: refs,
      aspectRatio: '3:4',
    });

    const imageUrl = await uploadGeneratedImage(
      `qa-matrix/${shoeId}`,
      `${modelId}.png`,
      result.imageData,
      result.mimeType,
    );

    const cell: ShoeMatrixCell = {
      id,
      shoeId,
      modelId,
      imageUrl,
      status: 'done',
      blocked: false,
    };

    await docRef.set(
      {
        ...cell,
        // Cache-bust query string so the UI re-fetches after a re-render.
        imageUrl: `${imageUrl}?v=${Date.now()}`,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { ...cell, imageUrl: `${imageUrl}?v=${Date.now()}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ShoeMatrix] render ${id} failed:`, err);
    await docRef.set(
      {
        status: 'failed' as CellStatus,
        errorMessage: msg,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    throw err;
  }
}

/**
 * List all cells for a given shoe (one row of the matrix). Returns whatever
 * has been rendered so far; missing (model, shoe) combos are absent from the
 * result and the UI fills them in as "not rendered" placeholders.
 */
export async function listCellsForShoe(shoeId: string): Promise<ShoeMatrixCell[]> {
  const snap = await qaShoeMatrixCol.where('shoeId', '==', shoeId).get();
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      shoeId: data.shoeId,
      modelId: data.modelId,
      imageUrl: data.imageUrl,
      status: data.status,
      blocked: data.blocked || false,
      blockedReason: data.blockedReason,
      errorMessage: data.errorMessage,
      createdAt: data.createdAt?.toDate?.(),
      updatedAt: data.updatedAt?.toDate?.(),
    };
  });
}

export async function setBlocked(
  shoeId: string,
  modelId: string,
  blocked: boolean,
  reason?: string,
): Promise<void> {
  const id = cellId(shoeId, modelId);
  await qaShoeMatrixCol.doc(id).set(
    {
      blocked,
      blockedReason: blocked ? (reason || 'flagged by reviewer') : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
