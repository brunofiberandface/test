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
 * Auto-sync (added 2026-05-13): `syncMatrix()` reconciles the matrix against
 * the current set of active shoes × active models, archives stale cells, and
 * renders missing/failed cells within a time budget. Models younger than the
 * `newModelBufferMs` (default 1h) are skipped so a misclicked model creation
 * doesn't trigger compute — gives the operator a window to delete it.
 */
import { getModel, getWardrobeItem, qaShoeMatrixCol, listModels, listWardrobeItems } from '@/lib/firestore';
import { generateSeedreamImage, type SeedreamReferenceImage } from '@/lib/pipeline/seedream-client';
import { ensureSeedreamSafeUrl } from '@/lib/pipeline/seedream-image-safe';
import { uploadGeneratedImage } from '@/lib/gcs';
import { FieldValue } from '@google-cloud/firestore';

const STUDIO_BACKDROP_URL =
  'https://storage.googleapis.com/gstar-ai-studio-assets/backdrops/clean-studio-grey.jpg';

// Mirror the unified MODEL CARD (FRONT) label from seedream-generate.ts so the
// matrix render uses the exact same identity scoping as a real job. The QA
// matrix is even stricter than production: the SAME model is rendered against
// every shoe and the operator visually cross-compares — any face drift defeats
// the matrix's purpose. So we lean harder on "identical, do not modify" here.
const MODEL_CARD_FRONT_LABEL =
  'MODEL CARD (FRONT) — canonical, exclusive, LOCKED source of truth for the ' +
  'model\'s face and identity. Reproduce this card identically in the rendered ' +
  'output: every facial feature (eye shape, eye color, nose, mouth, brow shape ' +
  'and thickness), the exact natural facial expression captured here, skin tone ' +
  'with undertone, freckle pattern, hair color and texture and length, body ' +
  'proportions and height. The face in this card is the only allowable face — ' +
  'do NOT invent new features, do NOT alter any feature, do NOT change ' +
  'expression. This QA matrix renders the same model across many shoes and the ' +
  'face must look identical across every render. Lighting on the rendered model ' +
  'is neutral 5500K — do not transfer warm key lighting from any other reference.';

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

### Identity lock — face is fixed, do not vary
The model's face, hair, eyes (shape AND color), brow shape, nose, mouth, skin tone with undertone, freckle pattern, and body proportions must be IDENTICAL to MODEL CARD (FRONT) (Image 2). Treat the face in Image 2 as a locked reference — do NOT modify any facial feature, do NOT change hair length or color, do NOT add or remove freckles, do NOT alter the expression. Match Image 2 face-for-face. This QA matrix renders the same model across many shoes; the face must look identical across every render for cross-comparison to work.

Bilaterally symmetric pose: both feet flat at natural shoulder-width stance, weight 50/50 across both feet, arms hanging straight at sides with a small natural gap from the torso, hands relaxed. The pose is identical for every render so only the shoes and proportions vary.

### Outfit — fixed base undergarments + footwear ONLY
This is a QA matrix render to verify shoe scale and fit per model. The model wears EXACTLY this outfit on every render — no stylistic variation, no color variation, no fit variation:

- TOP: plain matte-black racerback sports bra. Thin spaghetti straps over the shoulders. Scoop neckline at the front. A flat 2cm band at the bottom hem sitting just under the bust. NO logos, NO patterns, NO mesh panels, NO piping, NO stitching detail visible, NO color or accent other than matte black, NO sheen.
- BOTTOM: plain matte-black low-rise hipster briefs sitting at the hip bone (well below the navel). Plain flat waistband, plain leg openings. NO logos, NO piping, NO mesh, NO waistband contrast or text, NO color other than matte black, NO sheen.
- FOOTWEAR: as shown in SHOE REFERENCE (Image 3).

Bare arms, bare upper torso, bare midriff, bare upper thighs, bare lower legs — natural skin tone matching MODEL CARD (FRONT).

NOT wearing: NO t-shirt, NO top, NO blouse, NO jacket, NO pants, NO jeans, NO leggings, NO shorts, NO skirt, NO socks, NO accessories, NO jewellery.

### Footwear
Match SHOE REFERENCE (Image 3) for shape, color, material, and sole construction. Render the shoe at the AI model's natural foot proportions — a normal adult female shoe footprint, sized to match the body and stance. The product-photography perspective in the shoe reference is not a guide for render scale.

Clean studio-product render. Same locked identity, same locked pose, same locked base layer, only the shoes vary across renders.`;

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
  /**
   * True when the underlying model is no longer active OR the shoe was deleted.
   * Archived cells are hidden from the matrix UI; the doc is kept so we have
   * an audit trail (and can resurrect if the model is re-activated).
   */
  archived?: boolean;
  archivedAt?: Date;
  archivedReason?: string;
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
 *
 * Archived cells (model deactivated or shoe removed) are excluded by default
 * — pass `includeArchived: true` to surface them for debugging.
 */
export async function listCellsForShoe(
  shoeId: string,
  options: { includeArchived?: boolean } = {},
): Promise<ShoeMatrixCell[]> {
  const snap = await qaShoeMatrixCol.where('shoeId', '==', shoeId).get();
  return snap.docs
    .map(d => {
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
        archived: data.archived || false,
        archivedAt: data.archivedAt?.toDate?.(),
        archivedReason: data.archivedReason,
        createdAt: data.createdAt?.toDate?.(),
        updatedAt: data.updatedAt?.toDate?.(),
      };
    })
    .filter(c => options.includeArchived || !c.archived);
}

/** List ALL cells across all shoes (used by the sync endpoint to reconcile). */
export async function listAllCells(): Promise<ShoeMatrixCell[]> {
  const snap = await qaShoeMatrixCol.get();
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
      archived: data.archived || false,
      archivedAt: data.archivedAt?.toDate?.(),
      archivedReason: data.archivedReason,
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

export interface SyncMatrixOptions {
  /**
   * Models younger than this many milliseconds are skipped during render-queue
   * population (gives a buffer for misclicked model creates). Default: 1 hour.
   */
  newModelBufferMs?: number;
  /**
   * Stop rendering and return once this many ms have elapsed since the sync
   * started. Cells past the budget stay as 'pending' and will be picked up by
   * the next sync call. Default: 800,000ms (~13min, leaves headroom under Cloud
   * Run's 900s request timeout).
   */
  renderBudgetMs?: number;
  /**
   * If true, skip the render phase entirely — only reconcile state (archive
   * stale cells, create pending docs for new pairs). Useful for fast
   * housekeeping calls that shouldn't burn compute.
   */
  reconcileOnly?: boolean;
  /**
   * If true, flip every non-archived `done` cell back to `pending` before the
   * render phase, so the next pass re-renders them. Used when the underlying
   * prompt or pipeline changes and you want the whole matrix re-baselined.
   * Large backlogs need several sync calls (renderBudgetMs cap); each call
   * picks up where the previous one stopped.
   */
  forceRerender?: boolean;
}

export interface SyncMatrixResult {
  reconciled: {
    archivedCells: number;     // model became inactive / shoe was deleted
    unarchivedCells: number;   // model was re-activated — surfaced cell back
    createdPending: number;    // new (active shoe × active model) pair added
    skippedNewModels: number;  // active models still inside 1h buffer
  };
  rendered: {
    attempted: number;
    succeeded: number;
    failed: number;
    skippedOverBudget: number; // pending cells we didn't get to in this call
  };
  durationMs: number;
}

interface ShoeLite {
  id: string;
  category?: string;
  gender?: 'male' | 'female' | 'unisex';
}

interface ModelLite {
  id: string;
  active?: boolean;
  gender?: 'male' | 'female';
  createdAt?: Date | { toDate?: () => Date } | string;
}

function modelCreatedAt(m: ModelLite): Date | null {
  if (!m.createdAt) return null;
  if (m.createdAt instanceof Date) return m.createdAt;
  if (typeof m.createdAt === 'string') return new Date(m.createdAt);
  if (typeof (m.createdAt as { toDate?: () => Date }).toDate === 'function') {
    return (m.createdAt as { toDate: () => Date }).toDate();
  }
  return null;
}

function shoeMatchesModel(shoe: ShoeLite, model: ModelLite): boolean {
  // Unisex shoes match any model gender; gendered shoes match same-gender models only.
  if (!shoe.gender || shoe.gender === 'unisex') return true;
  if (!model.gender) return true; // legacy models without gender — be permissive
  return shoe.gender === model.gender;
}

/**
 * Reconcile the matrix against the current set of active shoes × active models,
 * then render any pending/failed cells within a time budget.
 *
 * Reconciliation logic:
 *   1. For each existing cell:
 *      - If the model is no longer active OR the shoe was deleted → set
 *        archived=true (cell is kept for audit, hidden from UI).
 *      - If a previously archived cell now has its model re-activated → set
 *        archived=false (resurrect the existing render rather than re-rendering
 *        unless it failed).
 *   2. For each (active shoe × active model > newModelBufferMs old) pair that
 *      has NO cell yet AND matches gender → create a pending cell.
 *   3. Render phase: iterate cells where status ∈ {pending, failed} and
 *      !archived, calling renderMatrixCell sequentially until renderBudgetMs
 *      elapses. Any unprocessed cells stay pending for the next sync.
 *
 * This function is idempotent — running it twice in a row with no shoe/model
 * changes is a no-op after the first call (assuming all renders succeed).
 */
export async function syncMatrix(options: SyncMatrixOptions = {}): Promise<SyncMatrixResult> {
  const start = Date.now();
  const newModelBufferMs = options.newModelBufferMs ?? 60 * 60 * 1000; // 1h
  const renderBudgetMs = options.renderBudgetMs ?? 800_000;             // ~13min

  // ── Pull current state ─────────────────────────────────────────────────────
  const [allShoesRaw, allModelsActiveRaw, allCells] = await Promise.all([
    listWardrobeItems('shoes'),
    listModels(true),   // active=true only
    listAllCells(),
  ]);
  const allShoes = allShoesRaw as unknown as ShoeLite[];
  const allModelsActive = allModelsActiveRaw as unknown as ModelLite[];
  const shoesById = new Map(allShoes.map(s => [s.id, s]));
  const modelsById = new Map(allModelsActive.map(m => [m.id, m]));

  const result: SyncMatrixResult = {
    reconciled: { archivedCells: 0, unarchivedCells: 0, createdPending: 0, skippedNewModels: 0 },
    rendered: { attempted: 0, succeeded: 0, failed: 0, skippedOverBudget: 0 },
    durationMs: 0,
  };

  // ── 1. Reconcile existing cells (archive stale, unarchive resurrected) ────
  for (const cell of allCells) {
    const shoe = shoesById.get(cell.shoeId);
    const model = modelsById.get(cell.modelId);
    const shouldBeArchived = !shoe || !model;

    if (shouldBeArchived && !cell.archived) {
      const reason = !shoe ? `shoe ${cell.shoeId} deleted` : `model ${cell.modelId} archived`;
      await qaShoeMatrixCol.doc(cell.id).set(
        {
          archived: true,
          archivedAt: FieldValue.serverTimestamp(),
          archivedReason: reason,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      result.reconciled.archivedCells++;
    } else if (!shouldBeArchived && cell.archived) {
      // Model re-activated (or shoe re-added with same id — unlikely). Surface back.
      await qaShoeMatrixCol.doc(cell.id).set(
        {
          archived: false,
          archivedAt: FieldValue.delete(),
          archivedReason: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      result.reconciled.unarchivedCells++;
    }
  }

  // ── 2. Create pending cells for new (shoe, model) pairs ────────────────────
  const existingCellIds = new Set(allCells.map(c => c.id));
  const now = Date.now();
  for (const shoe of allShoes) {
    for (const model of allModelsActive) {
      if (!shoeMatchesModel(shoe, model)) continue;

      const id = cellId(shoe.id, model.id);
      if (existingCellIds.has(id)) continue;

      // 1h buffer for new models — gives operator time to delete misclicks
      // without triggering Seedream compute.
      const created = modelCreatedAt(model);
      if (created && now - created.getTime() < newModelBufferMs) {
        result.reconciled.skippedNewModels++;
        continue;
      }

      await qaShoeMatrixCol.doc(id).set({
        shoeId: shoe.id,
        modelId: model.id,
        status: 'pending' as CellStatus,
        blocked: false,
        archived: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      result.reconciled.createdPending++;
    }
  }

  if (options.reconcileOnly) {
    result.durationMs = Date.now() - start;
    return result;
  }

  // ── 2.5. forceRerender: flip done cells back to pending ───────────────────
  // Used when the underlying prompt or pipeline changes and we want every cell
  // re-baselined. Only touches cells whose shoe + model are still active.
  if (options.forceRerender) {
    const refreshed = await listAllCells();
    for (const cell of refreshed) {
      if (cell.archived) continue;
      if (cell.status !== 'done') continue;
      if (!shoesById.has(cell.shoeId) || !modelsById.has(cell.modelId)) continue;
      await qaShoeMatrixCol.doc(cell.id).set(
        {
          status: 'pending' as CellStatus,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  }

  // ── 3. Render pending + failed cells within budget ────────────────────────
  // Re-fetch the cell list so we include the ones we just created (and the
  // ones forceRerender just flipped back to pending).
  const cellsToRender = (await listAllCells())
    .filter(c => !c.archived && (c.status === 'pending' || c.status === 'failed'))
    // Skip cells whose shoe or model have disappeared (shouldn't happen given
    // the reconcile loop above, but defensive).
    .filter(c => shoesById.has(c.shoeId) && modelsById.has(c.modelId));

  for (const cell of cellsToRender) {
    if (Date.now() - start > renderBudgetMs) {
      result.rendered.skippedOverBudget = cellsToRender.length - result.rendered.attempted;
      break;
    }
    result.rendered.attempted++;
    try {
      await renderMatrixCell(cell.shoeId, cell.modelId);
      result.rendered.succeeded++;
    } catch (err) {
      // renderMatrixCell already wrote status='failed' + errorMessage; just count it.
      console.error(`[ShoeMatrix sync] render ${cell.id} failed:`, err);
      result.rendered.failed++;
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}
