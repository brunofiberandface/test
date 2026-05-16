/**
 * Tier-2 cache: (model × shoe) 4-view 4K library.
 *
 * Pre-renders every (active shoe × active model with matching gender) as 4
 * 1:1 4K square views, each showing the model wearing the shoe with the
 * neutral matte-black placeholder outfit. These cells become the input
 * anchor for production jobs — Tier-1 (barefoot) → Tier-2 (model+shoe).
 *
 * Architecture (rewritten 2026-05-16):
 *   - Input: Tier-1 4K barefoot asset for the view + shoe flat photo
 *   - Renderer: Gemini-3-pro-image-preview at 1:1 4K
 *   - Prompt: "Paint the shoes onto the bare feet of IMAGE 1, preserve
 *     everything else." Narrow edit, not a full re-render.
 *   - Output: 4 views per (shoe × model) — fullBodyFront, fullBodyBack,
 *     legsFront, legsBack
 *
 * Why this design fixes the prior inconsistency:
 *   - Before: Seedream rendered from scratch using model card + shoe ref.
 *     Pose/outfit/identity drifted across renders (Shay vs Georgia mismatch).
 *   - After: Tier-1 barefoot pixel-locks pose/outfit/identity. Only the
 *     shoes change. Consistency guaranteed because the base image is shared.
 *
 * Firestore schema (per cell at `qaShoeMatrix/{shoeId}_{modelId}`):
 *   {
 *     id, shoeId, modelId, status, blocked, ...
 *     images: { fullBodyFront, fullBodyBack, legsFront, legsBack }   // 4K URLs
 *     thumbs: { fullBodyFront, fullBodyBack, legsFront, legsBack }   // 512px JPEG URLs
 *     viewsCompleted: ('fullBodyFront' | ...)[]   // which views are done
 *     imageUrl?: string  // LEGACY — old single-view URL, kept for safety
 *   }
 *
 * GCS paths:
 *   gs://gstar-ai-studio-assets/output/qa-matrix/{shoeId}/{modelId}/{view}.png       (4K)
 *   gs://gstar-ai-studio-assets/output/qa-matrix/{shoeId}/{modelId}/{view}_thumb.jpg (512px)
 *
 * Batch API (new 2026-05-16): see shoe-matrix-batch.ts for the async Pro
 * Batch API submission flow that costs 50% less for the same renders.
 */
import { getModel, getWardrobeItem, qaShoeMatrixCol, listModels, listWardrobeItems } from '@/lib/firestore';
import { generateImage, type ReferenceImage } from '@/lib/vertex';
import { uploadGeneratedImage } from '@/lib/gcs';
import { FieldValue } from '@google-cloud/firestore';

export type ViewKey = 'fullBodyFront' | 'fullBodyBack' | 'legsFront' | 'legsBack';
export const VIEWS: ViewKey[] = ['fullBodyFront', 'fullBodyBack', 'legsFront', 'legsBack'];

const TIER1_BASE_LABEL =
  'IMAGE 1 — TIER-1 BAREFOOT BASE. This is the canonical model asset. The ' +
  'output must look 95% IDENTICAL to this image: same person, same face, same ' +
  'skin tone, same outfit (matte-black sports bra + hot pants for female / ' +
  'bare chest + matte-black boxer briefs for male), same pose, same stance, ' +
  'same hand position, same arm position, same body angle, same backdrop, ' +
  'same lighting, same framing, same composition. PRESERVE EVERY PIXEL except ' +
  'the bare feet area at the bottom of the frame. The only allowed change is: ' +
  'paint the shoes from IMAGE 2 onto the bare feet of IMAGE 1.';

const SHOE_REF_LABEL =
  'IMAGE 2 — SHOE REFERENCE. Visual source of the footwear style: shape, ' +
  'colour, material, leather finish, sole construction, silhouette, lacing, ' +
  'hardware. Use this for the shoes\' appearance only. The product-photography ' +
  'perspective in this reference is NOT a guide for render scale — render the ' +
  'shoes at the correct anatomical foot proportions for the model in IMAGE 1.';

function buildMatrixPrompt(view: ViewKey): string {
  const isBack = view === 'fullBodyBack' || view === 'legsBack';
  const isLegsOnly = view === 'legsFront' || view === 'legsBack';

  return `Photorealistic studio reference photo, 1:1 SQUARE crop, 4K resolution, ${isBack ? 'BACK' : 'FRONT'} VIEW, ${isLegsOnly ? 'waist-down (legs + feet)' : 'full body head-to-toe'}.

═══ THIS IS A NARROW EDIT — IMAGE 1 IS YOUR BLUEPRINT ═══
The output is IMAGE 1 with shoes added. Every pixel of IMAGE 1 outside the bare-feet area MUST be preserved exactly:
- Identity (face, hair, skin tone, body proportions): preserved from IMAGE 1.
- Outfit (top + bottom): preserved from IMAGE 1.
- Pose (stance, foot placement on the floor, hip/shoulder angle, arm position, hand position, head tilt): preserved from IMAGE 1.
- Background (light-grey studio sweep #D9DAD2): preserved from IMAGE 1.
- Lighting, framing, composition, camera angle: preserved from IMAGE 1.

═══ THE EDIT — REPLACE BARE FEET WITH THE SHOES IN IMAGE 2 ═══
The model in IMAGE 1 is barefoot. Replace ONLY the bare-feet area with the shoes shown in IMAGE 2:
- Shoe style: match IMAGE 2 exactly — same shape, colour, material, finish, sole, hardware, laces, straps.
- Shoe scale: rendered at correct anatomical proportions for the model's feet in IMAGE 1. The shoes fit the model's existing foot positions — same stance, same foot orientation, same gap between feet.
- Position: each shoe sits on the floor at exactly the same spot the corresponding bare foot was standing in IMAGE 1. ${isBack ? 'Heels visible to the camera.' : 'Toes/tops of shoes visible to the camera.'}
- Both shoes fully visible — neither shoe is occluded, hidden behind the other foot, or cropped. The same shoe-width gap between the inner edges of the two shoes as IMAGE 1 had between the feet.
- The floor shadow under each shoe is faint and soft, matching the studio lighting in IMAGE 1.

═══ ABSOLUTELY FORBIDDEN ═══
- DO NOT modify the model's face, hair, skin tone, or body — those are 100% locked to IMAGE 1.
- DO NOT modify the outfit (top, bottom) — preserved from IMAGE 1.
- DO NOT modify the pose, stance, or foot placement — the shoes go on the EXACT feet positions IMAGE 1 has.
- DO NOT change the background, lighting, or framing.
- DO NOT show only one shoe — both shoes are fully visible at correct anatomical proportions.
- DO NOT add socks, ankle accessories, or anything not in IMAGE 2.`;
}

export type CellStatus = 'pending' | 'rendering' | 'done' | 'failed' | 'partial' | 'batch-pending';

export type ViewImageMap = Partial<Record<ViewKey, string>>;

export interface ShoeMatrixCell {
  id: string; // `${shoeId}_${modelId}`
  shoeId: string;
  modelId: string;

  /**
   * 4-view 4K image URLs. Cell is 'done' only when all 4 are populated.
   * Falls back to `imageUrl` (legacy) if absent on old cells.
   */
  images?: ViewImageMap;
  /** 512px JPEG thumbnail URLs for fast UI grid loading. */
  thumbs?: ViewImageMap;
  /** Which views have completed (mirrors `Object.keys(images)`). */
  viewsCompleted?: ViewKey[];

  /** Legacy single-view URL from the old Seedream 3:4 pipeline. Kept so old
   *  cells still display until the Tier-1-based re-render replaces them. */
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

export function cellId(shoeId: string, modelId: string): string {
  return `${shoeId}_${modelId}`;
}

interface ModelWithAssets {
  referenceImageUrl?: string;
  cardImageUrl?: string;
  assets4K_fullBodyFront?: string;
  assets4K_fullBodyBack?: string;
  assets4K_legsFront?: string;
  assets4K_legsBack?: string;
}

interface ShoeRefs {
  flatFrontUrl?: string;
  flatBackUrl?: string;
  name?: string;
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const r = await fetch(url.split('?')[0]);
  if (!r.ok) throw new Error(`fetch ${url.slice(0, 60)} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/**
 * Render a SINGLE view of a (shoe, model) cell using Gemini Pro Image
 * Preview at 1:1 4K. Uses the Tier-1 barefoot asset as the base image and
 * the shoe flat as the secondary reference.
 *
 * Returns { imageUrl, thumbUrl }. Throws on failure.
 *
 * This is the building block both renderMatrixCell (sync, all 4 views in
 * parallel) and the Batch API path (one JSONL request per view) use.
 */
export async function renderMatrixCellView(
  shoeId: string,
  modelId: string,
  view: ViewKey,
  apiKey?: string,
): Promise<{ imageUrl: string; thumbUrl: string }> {
  const shoe = await getWardrobeItem(shoeId) as ShoeRefs | null;
  if (!shoe) throw new Error(`Shoe ${shoeId} not found`);
  // For back views, prefer flatBackUrl if available; fall back to front.
  const isBack = view === 'fullBodyBack' || view === 'legsBack';
  const shoeUrl = isBack ? (shoe.flatBackUrl || shoe.flatFrontUrl) : shoe.flatFrontUrl;
  if (!shoeUrl) throw new Error(`Shoe ${shoeId} has no flat image`);

  const model = await getModel(modelId) as ModelWithAssets | null;
  if (!model) throw new Error(`Model ${modelId} not found`);
  const tier1Url = (model as Record<string, string | undefined>)[`assets4K_${view}`];
  if (!tier1Url) {
    throw new Error(
      `Model ${modelId} missing Tier-1 asset assets4K_${view}. ` +
      `Run scripts/generate-model-assets.ts ${modelId} first.`,
    );
  }

  // Pull both refs as buffers (Gemini Generative Language API accepts buffers).
  const [tier1Buf, shoeBuf] = await Promise.all([
    fetchBuffer(tier1Url),
    fetchBuffer(shoeUrl),
  ]);

  const refs: ReferenceImage[] = [
    { buffer: tier1Buf, mimeType: 'image/png', label: TIER1_BASE_LABEL },
    { buffer: shoeBuf, mimeType: 'image/jpeg', label: SHOE_REF_LABEL },
  ];

  const result = await generateImage({
    prompt: buildMatrixPrompt(view),
    referenceImages: refs,
    aspectRatio: '1:1',
    imageSize: '4K',
    model: 'gemini-3-pro-image-preview',
    apiKey,
  });

  // Upload 4K master.
  const imageUrl = await uploadGeneratedImage(
    `qa-matrix/${shoeId}/${modelId}`,
    `${view}.png`,
    result.imageData,
    result.mimeType,
  );

  // Generate + upload 512px JPEG thumbnail.
  const sharp = (await import('sharp')).default;
  const thumbBuf = await sharp(result.imageData)
    .resize(512, 512, { fit: 'cover', kernel: 'lanczos3' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const thumbUrl = await uploadGeneratedImage(
    `qa-matrix/${shoeId}/${modelId}`,
    `${view}_thumb.jpg`,
    thumbBuf,
    'image/jpeg',
  );

  return { imageUrl, thumbUrl };
}

/**
 * Render all 4 views of a (shoe, model) cell in parallel. Synchronous —
 * caller awaits ~2-3 min for the 4 parallel Gemini Pro calls.
 *
 * Writes images to GCS at output/qa-matrix/{shoeId}/{modelId}/{view}.{png,jpg}
 * and upserts the Firestore doc. Updates `status='partial'` if some views
 * succeed, `'done'` only when all 4 land, `'failed'` if none.
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

  // Read existing cell so we can merge prior-succeeded views into the
  // final result. Without this, retries that lose a transient view would
  // also lose the previously-succeeded views (image map gets overwritten).
  const existingSnap = await docRef.get();
  const existingData = existingSnap.exists ? existingSnap.data() : {};
  const existingImages = (existingData?.images || {}) as ViewImageMap;
  const existingThumbs = (existingData?.thumbs || {}) as ViewImageMap;
  const existingViewsCompleted = (existingData?.viewsCompleted || []) as ViewKey[];

  // Run all 4 views in parallel. Each view is independent — partial
  // success is fine, we accumulate succeeded views over multiple runs.
  const results = await Promise.allSettled(VIEWS.map(async (view) => {
    const { imageUrl, thumbUrl } = await renderMatrixCellView(shoeId, modelId, view);
    return { view, imageUrl, thumbUrl };
  }));

  const newSucceeded: ViewKey[] = [];
  const failures: string[] = [];

  // Use Firestore field-path notation so each view writes independently —
  // failed views don't touch their slot, so a previously-succeeded view's
  // URL stays put on a retry that fails that view.
  const update: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const { view, imageUrl, thumbUrl } = r.value;
      update[`images.${view}`] = `${imageUrl}?v=${Date.now()}`;
      update[`thumbs.${view}`] = `${thumbUrl}?v=${Date.now()}`;
      newSucceeded.push(view);
    } else {
      failures.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
  }

  // Final viewsCompleted = union of previously-completed + this-run-succeeded.
  // Build the union as a Set so duplicates collapse.
  const finalViewsCompleted = Array.from(
    new Set<ViewKey>([...existingViewsCompleted, ...newSucceeded]),
  );

  let status: CellStatus;
  if (finalViewsCompleted.length === VIEWS.length) status = 'done';
  else if (finalViewsCompleted.length === 0) status = 'failed';
  else status = 'partial';

  update.status = status;
  update.viewsCompleted = finalViewsCompleted;
  if (failures.length > 0) {
    update.errorMessage = failures.join(' | ').slice(0, 1000);
  } else if (status === 'done') {
    // Clear stale error from previous partial runs.
    update.errorMessage = FieldValue.delete();
  }

  // IMPORTANT: use update() not set({merge:true}) — Firestore's set+merge
  // treats dot-notation field paths as literal top-level keys with a dot
  // in them, not as nested-field references. Verified the hard way in
  // batch-check (which had the same bug). update() interprets dot-notation
  // correctly as field paths into nested maps.
  await docRef.update(update);
  if (status === 'failed') {
    console.error(`[ShoeMatrix] render ${id} ALL views failed:`, failures);
  } else if (status === 'partial') {
    console.warn(`[ShoeMatrix] render ${id} PARTIAL ${finalViewsCompleted.length}/${VIEWS.length} total (this run ${newSucceeded.length}):`, failures);
  }

  // Build response with the merged map for the caller.
  const finalImages: ViewImageMap = { ...existingImages };
  const finalThumbs: ViewImageMap = { ...existingThumbs };
  for (const r of results) {
    if (r.status === 'fulfilled') {
      finalImages[r.value.view] = update[`images.${r.value.view}`] as string;
      finalThumbs[r.value.view] = update[`thumbs.${r.value.view}`] as string;
    }
  }
  return {
    id, shoeId, modelId,
    images: finalImages,
    thumbs: finalThumbs,
    viewsCompleted: finalViewsCompleted,
    status, blocked: false,
    errorMessage: typeof update.errorMessage === 'string' ? update.errorMessage : undefined,
  };
}

/**
 * List all cells for a given shoe (one row of the matrix). Returns whatever
 * has been rendered so far; missing (model, shoe) combos are absent from the
 * result and the UI fills them in as "not rendered" placeholders.
 *
 * Archived cells (model deactivated or shoe removed) are excluded by default
 * — pass `includeArchived: true` to surface them for debugging.
 */
function snapToCell(d: FirebaseFirestore.QueryDocumentSnapshot): ShoeMatrixCell {
  const data = d.data();
  return {
    id: d.id,
    shoeId: data.shoeId,
    modelId: data.modelId,
    // New 4-view schema fields.
    images: data.images as ViewImageMap | undefined,
    thumbs: data.thumbs as ViewImageMap | undefined,
    viewsCompleted: data.viewsCompleted as ViewKey[] | undefined,
    // Legacy single-view field — kept so old cells render until re-rendered.
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
}

export async function listCellsForShoe(
  shoeId: string,
  options: { includeArchived?: boolean } = {},
): Promise<ShoeMatrixCell[]> {
  const snap = await qaShoeMatrixCol.where('shoeId', '==', shoeId).get();
  return snap.docs
    .map(snapToCell)
    .filter(c => options.includeArchived || !c.archived);
}

/** List ALL cells across all shoes (used by the sync endpoint to reconcile). */
export async function listAllCells(): Promise<ShoeMatrixCell[]> {
  const snap = await qaShoeMatrixCol.get();
  return snap.docs.map(snapToCell);
}

/** Get a single cell by composite ID (used by the cell detail page). */
export async function getCellById(id: string): Promise<ShoeMatrixCell | null> {
  const doc = await qaShoeMatrixCol.doc(id).get();
  if (!doc.exists) return null;
  return snapToCell(doc as FirebaseFirestore.QueryDocumentSnapshot);
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

  // ── 3. Render pending + failed + partial cells within budget ────────────
  // Re-fetch the cell list so we include the ones we just created (and the
  // ones forceRerender just flipped back to pending). Partial cells are
  // included so failed views get a retry.
  const cellsToRender = (await listAllCells())
    .filter(c => !c.archived && (c.status === 'pending' || c.status === 'failed' || c.status === 'partial'))
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
