import { Firestore, FieldValue } from '@google-cloud/firestore';
import crypto from 'crypto';

// Initialize Firestore — always targets gstar-ai-studio (NOT the Gemini billing project)
export const db = new Firestore({
  projectId: process.env.FIRESTORE_PROJECT || 'gstar-ai-studio',
});

// ── Collections ──
export const usersCol = db.collection('users');
export const modelsCol = db.collection('models');
export const jobsCol = db.collection('jobs');
export const shotsCol = db.collection('shots');
export const modificationsCol = db.collection('modifications');
export const otpCol = db.collection('otpCodes');
export const wardrobeCol = db.collection('wardrobe');
export const commentsCol = db.collection('comments');
export const promptVaultCol = db.collection('promptVault');
export const labelTemplatesCol = db.collection('labelTemplates');
export const labelStylesCol = db.collection('labelStyles');
export const labelColorwaysCol = db.collection('labelColorways');
// Photo-based label asset library — separate from the three-tier
// labelTemplates/labelStyles/labelColorways pipeline. Contains canonical
// alpha-masked PNG renders of leather waistband patches and woven pocket
// patches that wardrobe items reference via {leather|pocket}LabelTemplateId.
export const labelAssetsCol = db.collection('labelAssets');

// QA: shoe × model proportion matrix. One doc per (shoeId, modelId) pair, doc
// id = `${shoeId}_${modelId}`. Used to pre-render every model wearing every shoe
// (basics + shoes only, no jeans) so reviewers can spot bad scale/fit combos
// (e.g. chunky platform loafer reads as oversized on tall slim models) and
// flag them as `blocked` so the new-job wizard warns when picking that combo.
export const qaShoeMatrixCol = db.collection('qaShoeMatrix');

// ── User operations ──
export async function getUser(email: string) {
  const doc = await usersCol.doc(email).get();
  return doc.exists ? { email, ...doc.data() } : null;
}

export async function createUser(email: string, data: {
  displayName: string;
  role: 'admin' | 'creator';
}) {
  await usersCol.doc(email).set({
    ...data,
    createdAt: new Date(),
    lastLogin: new Date(),
    trustedBrowsers: [],
    active: true,
  });
}

export async function updateLastLogin(email: string) {
  await usersCol.doc(email).update({ lastLogin: new Date() });
}

export async function addTrustedBrowser(email: string, browserHash: string) {
  await usersCol.doc(email).update({
    trustedBrowsers: FieldValue.arrayUnion(browserHash),
  });
}

export async function listUsers() {
  const snap = await usersCol.orderBy('createdAt', 'desc').get();
  return snap.docs.map(d => ({ email: d.id, ...d.data() }));
}

export async function updateUser(email: string, data: Partial<{
  displayName: string;
  role: 'admin' | 'creator';
  active: boolean;
}>) {
  await usersCol.doc(email).update(data);
}

// ── Password operations ──
function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      resolve(key.toString('hex'));
    });
  });
}

export async function setUserPassword(email: string, password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashPassword(password, salt);
  await usersCol.doc(email).update({
    passwordHash: hash,
    passwordSalt: salt,
    passwordSetAt: new Date(),
  });
}

export async function verifyUserPassword(email: string, password: string): Promise<boolean> {
  const doc = await usersCol.doc(email).get();
  if (!doc.exists) return false;
  const data = doc.data()!;
  if (!data.passwordHash || !data.passwordSalt) return false;
  const hash = await hashPassword(password, data.passwordSalt);
  return hash === data.passwordHash;
}

export async function userHasPassword(email: string): Promise<boolean> {
  const doc = await usersCol.doc(email).get();
  if (!doc.exists) return false;
  return !!doc.data()?.passwordHash;
}

// ── OTP operations ──
export async function storeOTP(email: string, code: string) {
  await otpCol.doc(email).set({
    code,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
}

export async function verifyOTP(email: string, code: string): Promise<boolean> {
  const doc = await otpCol.doc(email).get();
  if (!doc.exists) return false;
  const data = doc.data()!;
  if (data.code !== code) return false;
  if (new Date() > data.expiresAt.toDate()) return false;
  await otpCol.doc(email).delete();
  return true;
}

// ── Model operations (v2: single reference image) ──
export async function listModels(activeOnly = true) {
  const snap = activeOnly
    ? await modelsCol.where('active', '==', true).get()
    : await modelsCol.get();
  const models = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return models.sort((a: any, b: any) => (a.modelId || a.id).localeCompare(b.modelId || b.id));
}

export async function getModel(modelId: string) {
  const doc = await modelsCol.doc(modelId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

export async function createModel(modelId: string, data: {
  name: string;
  description: string;
  referenceImageUrl: string;
  gender: 'male' | 'female';
  createdBy: string;
}) {
  await modelsCol.doc(modelId).set({
    modelId,
    ...data,
    active: true,
    createdAt: new Date(),
  });
}

export async function updateModel(modelId: string, data: Partial<{
  name: string;
  description: string;
  referenceImageUrl: string;
  backReferenceImageUrl: string;
  originalReferenceImageUrl: string;  // pre-matte original (rollback)
  active: boolean;
}>) {
  await modelsCol.doc(modelId).update({ ...data, updatedAt: new Date() });
}

// ── Job operations (v2: structured wardrobe + prompt revisions) ──

/**
 * Atomic counter for the sequential `jobNumber` (1, 2, 3, ...) shown in the
 * UI for human-readable references in screenshots / comms. Stored at
 * system/jobCounter.next — backfilled to 127 on 2026-05-12 (after the
 * existing 126 jobs got jobNumber=1..126 in createdAt order).
 *
 * Race-safe via Firestore transaction. New jobs always get a unique,
 * monotonically increasing number even if multiple are created concurrently.
 */
const JOB_COUNTER_DOC = db.collection('system').doc('jobCounter');

export async function getNextJobNumber(): Promise<number> {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(JOB_COUNTER_DOC);
    const next = doc.exists ? (doc.data()?.next as number) || 1 : 1;
    tx.set(JOB_COUNTER_DOC, { next: next + 1, updatedAt: new Date() }, { merge: true });
    return next;
  });
}

export async function createJob(data: {
  jobName: string;
  creatorEmail: string;
  modelId: string;
  wardrobe: {
    shoe: { itemId: string; isFocus: boolean };
    top: { itemId: string; isFocus: boolean };
    bottom: { itemId: string; isFocus: boolean };
  };
  promptRevisions: Record<string, number>;
  stylingNotes?: string;
  provider?: 'gemini' | 'seedream';
  m06PoseId?: string;  // optional — id from src/lib/m06-poses.ts
}) {
  const ref = jobsCol.doc();
  const jobNumber = await getNextJobNumber();
  await ref.set({
    jobId: ref.id,
    jobNumber,
    ...data,
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return ref.id;
}

export async function getJob(jobId: string) {
  const doc = await jobsCol.doc(jobId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt,
    updatedAt: data.updatedAt?.toDate?.() ? data.updatedAt.toDate().toISOString() : data.updatedAt,
  };
}

/**
 * List jobs, newest first, with cursor-based pagination.
 *
 * options.cursorMs — pass the createdAt-ms of the LAST job in the previous
 *   page to fetch the next page (uses Firestore .startAfter for efficient
 *   pagination; doesn't scan skipped docs the way offset does).
 * options.limit  — page size, default 50.
 *
 * Returns { jobs, hasMore, nextCursorMs } where nextCursorMs is the cursor
 * to pass on the next call (null when there's no more data).
 *
 * Backward compat: callers that don't care about pagination just destructure
 * .jobs — the 50-default is preserved.
 */
export interface ListJobsOptions {
  cursorMs?: number;
  limit?: number;
}

export interface ListJobsResult {
  jobs: any[];
  hasMore: boolean;
  nextCursorMs: number | null;
}

export async function listJobs(creatorEmail?: string, options: ListJobsOptions = {}): Promise<ListJobsResult> {
  // Default 50 (dashboard initial page). Cap at 5000 — keeps the /api/jobs
  // ?fetchAll=true path safe even if the collection grows; the dashboard
  // hits this when a search filter is active and needs to scan the full DB.
  const limit = Math.max(1, Math.min(5000, options.limit ?? 50));
  let query: FirebaseFirestore.Query = jobsCol.orderBy('createdAt', 'desc');
  if (creatorEmail) query = query.where('creatorEmail', '==', creatorEmail);
  if (options.cursorMs && Number.isFinite(options.cursorMs)) {
    const { Timestamp } = await import('@google-cloud/firestore');
    query = query.startAfter(Timestamp.fromMillis(options.cursorMs));
  }
  // Fetch limit + 1 so we can detect hasMore without an extra query.
  const snap = await query.limit(limit + 1).get();
  const docs = snap.docs.slice(0, limit);
  const hasMore = snap.docs.length > limit;
  const jobs = docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt,
      updatedAt: data.updatedAt?.toDate?.() ? data.updatedAt.toDate().toISOString() : data.updatedAt,
    };
  });
  const lastDoc = docs[docs.length - 1];
  const nextCursorMs = (hasMore && lastDoc)
    ? (lastDoc.data().createdAt?.toMillis?.() ?? null)
    : null;
  return { jobs, hasMore, nextCursorMs };
}

/**
 * Aggregate counts for the dashboard stats. Returns total active jobs +
 * per-status buckets. Uses Firestore .count() aggregations — much cheaper
 * than fetching all docs (no read of the full collection, returns a single
 * count per query).
 *
 * Status buckets match the dashboard filter chips:
 *   generating — generating | uploading | queued
 *   review     — review
 *   completed  — complete | completed
 *   archived   — archived === true (separate from active)
 *
 * "Active" = NOT archived. The total returned here is the active total.
 * Pre-2026-05-13 the dashboard counted from the currently-loaded page only,
 * which showed wrong numbers as soon as pagination was introduced.
 */
export async function getJobCounts(): Promise<{
  total: number;
  generating: number;
  review: number;
  completed: number;
  archived: number;
}> {
  // Single-pass scan: read all job docs once and bucket locally. Tried
  // parallel aggregate count() queries first but they over-counted —
  // archived docs retain their previous status (e.g. status='review'),
  // so a status-only aggregate double-counts them. A composite query
  // `where status==X AND archived!=true` would require a Firestore index
  // per status; not worth it at this collection size (~200 docs).
  //
  // We only fetch the two fields we need (`status`, `archived`) via
  // select() to keep transfer small. Total round-trip ~150-300ms.
  const snap = await jobsCol.select('status', 'archived').get();
  const counts = { total: 0, generating: 0, review: 0, completed: 0, archived: 0 };
  for (const d of snap.docs) {
    const data = d.data() as { status?: string; archived?: boolean };
    const isArchived = data.archived === true;
    if (isArchived) {
      counts.archived++;
      continue;  // archived jobs aren't counted in active buckets
    }
    const s = (data.status || '').toLowerCase();
    if (s === 'generating' || s === 'uploading' || s === 'queued') counts.generating++;
    else if (s === 'review') counts.review++;
    else if (s === 'complete' || s === 'completed') counts.completed++;
    // Active total = sum of all visible (non-archived) statuses. Status
    // values we don't recognize (e.g. 'failed', 'pending') still count
    // toward total because the dashboard's "All" view shows them.
    counts.total++;
  }
  return counts;
}

export async function updateJobStatus(jobId: string, status: string) {
  await jobsCol.doc(jobId).update({ status, updatedAt: new Date() });
}

export async function updateJob(jobId: string, data: Record<string, any>) {
  await jobsCol.doc(jobId).update({ ...data, updatedAt: new Date() });
}

export async function archiveJob(jobId: string, archived: boolean = true) {
  await jobsCol.doc(jobId).update({
    archived,
    ...(archived ? { archivedAt: new Date() } : {}),
    updatedAt: new Date(),
  });
}

export async function deleteJob(jobId: string) {
  const shotsSnap = await shotsCol.where('jobId', '==', jobId).get();
  const batch = db.batch();
  shotsSnap.docs.forEach(doc => batch.delete(doc.ref));
  const modsSnap = await modificationsCol.where('jobId', '==', jobId).get();
  modsSnap.docs.forEach(doc => batch.delete(doc.ref));
  batch.delete(jobsCol.doc(jobId));
  await batch.commit();
}

export async function deleteJobs(jobIds: string[]) {
  const allDeletes: Array<{ ref: FirebaseFirestore.DocumentReference }> = [];
  for (const jobId of jobIds) {
    allDeletes.push({ ref: jobsCol.doc(jobId) });
    const shotsSnap = await shotsCol.where('jobId', '==', jobId).get();
    shotsSnap.docs.forEach(doc => allDeletes.push({ ref: doc.ref }));
    const modsSnap = await modificationsCol.where('jobId', '==', jobId).get();
    modsSnap.docs.forEach(doc => allDeletes.push({ ref: doc.ref }));
  }
  for (let i = 0; i < allDeletes.length; i += 500) {
    const chunk = allDeletes.slice(i, i + 500);
    const batch = db.batch();
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

// ── Comment operations ──
export async function createComment(data: {
  jobId: string;
  shotId?: string;
  shotType?: string;
  authorEmail: string;
  authorName: string;
  text: string;
}) {
  const ref = commentsCol.doc();
  await ref.set({
    commentId: ref.id,
    ...data,
    createdAt: new Date(),
  });
  return { commentId: ref.id, ...data, createdAt: new Date() };
}

export async function listComments(jobId: string) {
  const snap = await commentsCol
    .where('jobId', '==', jobId)
    .orderBy('createdAt', 'asc')
    .get();
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt,
    };
  });
}

export async function deleteComment(commentId: string) {
  await commentsCol.doc(commentId).delete();
}

// ── Shot operations ──
export async function createShot(data: {
  jobId: string;
  modelId: string;
  shotType: string;
  prompt: string;
  promptRevision: number;
  status?: string;
}) {
  const ref = shotsCol.doc();
  const { status: initialStatus, ...rest } = data;
  await ref.set({
    shotId: ref.id,
    ...rest,
    version: 1,
    status: initialStatus || 'pending',
    createdAt: new Date(),
  });
  return ref.id;
}

export async function listShots(jobId: string) {
  const snap = await shotsCol.where('jobId', '==', jobId).get();
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt,
      updatedAt: data.updatedAt?.toDate?.() ? data.updatedAt.toDate().toISOString() : data.updatedAt,
    };
  });
}

export async function updateShot(shotId: string, data: Partial<{
  status: string;
  imageUrl: string;
  version: number;
  progressStep: string;
  progressPct: number;
  prompt: string;
  provider: 'gemini' | 'seedream';
  alternativePromptId: string;
  alternativePromptLabel: string;
  usedDressedBase: boolean;
  previousVersions: Array<{ imageUrl: string; version: number; createdAt: Date; provider?: 'gemini' | 'seedream' }>;
}>) {
  await shotsCol.doc(shotId).update({ ...data, updatedAt: new Date() });
}

// ── Modification operations ──
export async function logModification(data: {
  shotId: string;
  jobId: string;
  instruction: string;
  originalPrompt: string;
  newPrompt: string;
}) {
  const ref = modificationsCol.doc();
  await ref.set({
    modificationId: ref.id,
    ...data,
    approved: false,
    createdAt: new Date(),
  });
  return ref.id;
}

// ── Wardrobe operations ──
// Accepts both v1 (fitModelUrls array) and v2 (fitModels labeled angles) formats.
// v2 format will be enforced once wardrobe UI is rebuilt.
export async function createWardrobeItem(data: Record<string, any> & {
  name: string;
  category: string;
  description: string;
}) {
  const ref = wardrobeCol.doc();
  await ref.set({
    wardrobeId: ref.id,
    ...data,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return ref.id;
}

export async function updateWardrobeItem(wardrobeId: string, data: Record<string, any>) {
  await wardrobeCol.doc(wardrobeId).update({ ...data, updatedAt: new Date() });
}

export async function listWardrobeItems(category?: string) {
  let query: FirebaseFirestore.Query = wardrobeCol;
  if (category) query = query.where('category', '==', category);
  // NOTE: NOT using `query.orderBy('createdAt', 'asc')` here — combining
  // where('category', '==', X) + orderBy('createdAt') would require a
  // Firestore composite index. Instead we sort client-side below. Wardrobe
  // is small enough (~66 items) that JS sort is trivial.
  const snap = await query.get();
  const items = snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt,
      updatedAt: data.updatedAt?.toDate?.() ? data.updatedAt.toDate().toISOString() : data.updatedAt,
    };
  });
  // Sort by createdAt ascending — oldest first, newest last. Items missing
  // createdAt sort to the end (won't happen in practice; verified all docs
  // have it, and new uploads always write it).
  items.sort((a, b) => {
    const aT = (a as { createdAt?: string }).createdAt || '';
    const bT = (b as { createdAt?: string }).createdAt || '';
    if (!aT && !bT) return 0;
    if (!aT) return 1;
    if (!bT) return -1;
    return aT < bT ? -1 : aT > bT ? 1 : 0;
  });
  return items;
}

export async function getWardrobeItem(wardrobeId: string) {
  const doc = await wardrobeCol.doc(wardrobeId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt,
    updatedAt: data.updatedAt?.toDate?.() ? data.updatedAt.toDate().toISOString() : data.updatedAt,
  };
}

export async function deleteWardrobeItem(wardrobeId: string) {
  await wardrobeCol.doc(wardrobeId).delete();
}

// ── Prompt Vault operations ──

/**
 * Upload a new prompt file revision.
 * Auto-increments revision number. Old revisions become inactive.
 */
export async function uploadPromptFile(data: {
  filename: string;
  shotType: string;
  category?: string;
  content: string;
  gcsUrl: string;
  uploadedBy: string;
  silhouettePrompt?: string;
  generationPrompt?: string;
  isAlternative?: boolean;
  label?: string;
  pipeline?: 'gemini' | 'seedream';
}): Promise<{ id: string; revision: number }> {
  // Find the latest revision for this shot type (and optional category)
  let query: FirebaseFirestore.Query = promptVaultCol
    .where('shotType', '==', data.shotType)
    .orderBy('revision', 'desc')
    .limit(1);
  if (data.category) {
    query = promptVaultCol
      .where('shotType', '==', data.shotType)
      .where('category', '==', data.category)
      .orderBy('revision', 'desc')
      .limit(1);
  }

  const snap = await query.get();
  const latestRevision = snap.empty ? 0 : (snap.docs[0].data().revision || 0);
  const newRevision = latestRevision + 1;

  const batch = db.batch();

  // Only deactivate previous active revisions for BASE prompts (not alternatives)
  // Scoped by pipeline — Seedream upload only deactivates other Seedream bases.
  if (!data.isAlternative) {
    let deactivateQuery: FirebaseFirestore.Query = promptVaultCol
      .where('shotType', '==', data.shotType)
      .where('isActive', '==', true);
    if (data.pipeline) {
      deactivateQuery = deactivateQuery.where('pipeline', '==', data.pipeline);
    }
    const activeSnap = await deactivateQuery.get();
    activeSnap.docs.forEach(doc => {
      const docData = doc.data();
      // Skip alternatives when deactivating
      if (docData.isAlternative) return;
      // If no pipeline on the upload, only deactivate docs without pipeline (legacy Gemini)
      if (!data.pipeline && docData.pipeline) return;
      if (!data.category || docData.category === data.category) {
        batch.update(doc.ref, { isActive: false });
      }
    });
  }

  // Create new revision — strip undefined values (Firestore rejects them)
  const ref = promptVaultCol.doc();
  const cleanData: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) cleanData[k] = v;
  }
  batch.set(ref, {
    id: ref.id,
    ...cleanData,
    revision: newRevision,
    isActive: !data.isAlternative,
    isAlternative: data.isAlternative || false,
    ...(data.label ? { label: data.label } : {}),
    uploadedAt: new Date(),
  });

  await batch.commit();
  return { id: ref.id, revision: newRevision };
}

/**
 * Get the active prompt file for a shot type.
 */
export async function getActivePrompt(shotType: string, category?: string, pipeline?: 'gemini' | 'seedream'): Promise<any | null> {
  let query: FirebaseFirestore.Query = promptVaultCol
    .where('shotType', '==', shotType)
    .where('isActive', '==', true);
  if (category) {
    query = query.where('category', '==', category);
  }
  if (pipeline) {
    query = query.where('pipeline', '==', pipeline);
  }
  const snap = await query.limit(1).get();

  // Fallback: if pipeline-specific prompt not found, try without pipeline filter
  // (backward compat — existing gemini prompts don't have the pipeline field)
  if (snap.empty && pipeline) {
    let fallbackQuery: FirebaseFirestore.Query = promptVaultCol
      .where('shotType', '==', shotType)
      .where('isActive', '==', true);
    if (category) {
      fallbackQuery = fallbackQuery.where('category', '==', category);
    }
    const fallbackSnap = await fallbackQuery.limit(1).get();
    if (!fallbackSnap.empty) {
      const data = fallbackSnap.docs[0].data();
      console.log(`[PromptVault] No ${pipeline} prompt for ${shotType} — falling back to untagged prompt`);
      return { id: fallbackSnap.docs[0].id, ...data };
    }
  }

  if (snap.empty) return null;
  const data = snap.docs[0].data();
  return { id: snap.docs[0].id, ...data };
}

/**
 * List all prompt files (optionally filtered by shot type).
 */
export async function listPromptFiles(shotType?: string) {
  let query: FirebaseFirestore.Query = promptVaultCol.orderBy('uploadedAt', 'desc');
  if (shotType) {
    query = promptVaultCol
      .where('shotType', '==', shotType)
      .orderBy('uploadedAt', 'desc');
  }
  const snap = await query.get();
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      uploadedAt: data.uploadedAt?.toDate?.() ? data.uploadedAt.toDate().toISOString() : data.uploadedAt,
    };
  });
}

/**
 * List alternative prompts for a shot type (rerun-only prompts).
 * When pipeline is specified, only returns alternatives matching that pipeline.
 */
export async function listAlternativePrompts(shotType: string, pipeline?: 'gemini' | 'seedream') {
  let query: FirebaseFirestore.Query = promptVaultCol
    .where('shotType', '==', shotType)
    .where('isAlternative', '==', true);
  if (pipeline) {
    query = query.where('pipeline', '==', pipeline);
  }
  const snap = await query.get();
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      label: data.label || data.filename,
      shotType: data.shotType,
      pipeline: data.pipeline || null,
      revision: data.revision,
      uploadedAt: data.uploadedAt?.toDate?.() ? data.uploadedAt.toDate().toISOString() : data.uploadedAt,
    };
  });
}

/**
 * Get a specific prompt file by ID.
 */
export async function getPromptFile(id: string) {
  const doc = await promptVaultCol.doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return { id: doc.id, ...data };
}

/**
 * Set a specific revision as active (revert).
 */
export async function setActivePromptRevision(id: string): Promise<void> {
  const doc = await promptVaultCol.doc(id).get();
  if (!doc.exists) throw new Error('Prompt file not found');
  const data = doc.data()!;

  // Deactivate current active for this shot type + category
  const activeSnap = await promptVaultCol
    .where('shotType', '==', data.shotType)
    .where('isActive', '==', true)
    .get();
  const batch = db.batch();
  activeSnap.docs.forEach(d => {
    if (!data.category || d.data().category === data.category) {
      batch.update(d.ref, { isActive: false });
    }
  });

  // Activate the target revision
  batch.update(doc.ref, { isActive: true });
  await batch.commit();
}

// ── Generation Queue v2 ──

const QUEUE_DOC = db.collection('system').doc('generationQueue');
// 2026-05-11: bumped 2 → 6 to better utilize the 9-Gemini / 10-BytePlus key pool.
// Each shot uses 1 of each key. With MAX_SLOTS=6, up to ~6 concurrent shots can
// run (still capped by key pool at 9). Bruno's complaint: 20-shot rerun "takes
// forever" with MAX_SLOTS=2. 6 should ~3x throughput.
// 2026-05-12: bumped 6 → 10. Key pool grew to 15 Gemini × 15 BytePlus, but
// inflight was capping around 4-6 shots because 6 active jobs × ~1-2
// eligible shots each (after dep-chain filter) wasn't enough to saturate
// the 15-key ceiling. 10 active jobs × ~1-2 eligible = 10-20 candidates,
// still capped at 15 → expect ~10-12 in flight steady-state.
const MAX_SLOTS = 10;

export interface QueueEntry {
  jobId: string;
  jobName: string;
  queuedAt: string;
}

export interface SlotState {
  jobId: string;
  jobName: string;
  startedAt: string;
  currentShot: string | null;
  retryPass: number;
}

export interface QueueStateV2 {
  slots: (SlotState | null)[];
  queue: QueueEntry[];
  workerHeartbeat: string | null;
  workerActive: boolean;
  updatedAt: string;
}

export type QueueState = QueueStateV2;

function emptyState(): QueueStateV2 {
  return {
    slots: [null, null],
    queue: [],
    workerHeartbeat: null,
    workerActive: false,
    updatedAt: new Date().toISOString(),
  };
}

function cleanV2State(raw: any): QueueStateV2 {
  return {
    slots: raw.slots || [null, null],
    queue: raw.queue || [],
    workerHeartbeat: raw.workerHeartbeat || null,
    workerActive: raw.workerActive || false,
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

export async function getQueueState(): Promise<QueueStateV2> {
  const doc = await QUEUE_DOC.get();
  if (!doc.exists) return emptyState();
  const data = doc.data() as QueueStateV2;
  if (!data.slots) {
    const migrated = emptyState();
    try {
      await QUEUE_DOC.set(migrated);
    } catch (e) {
      console.warn('[Queue] Migration persist failed:', e);
    }
    return migrated;
  }
  while (data.slots.length < MAX_SLOTS) data.slots.push(null);
  return data;
}

export async function resetQueueState(): Promise<void> {
  await QUEUE_DOC.set(emptyState());
}

export async function updateWorkerHeartbeat(): Promise<void> {
  try {
    await QUEUE_DOC.update({
      workerHeartbeat: new Date().toISOString(),
      workerActive: true,
    });
  } catch (e) {
    console.warn('[Queue] Worker heartbeat update failed:', e);
  }
}

export async function claimWorker(): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(QUEUE_DOC);
    const state: QueueStateV2 = doc.exists ? (doc.data() as QueueStateV2) : emptyState();
    if (!state.slots) Object.assign(state, emptyState());

    const now = Date.now();
    const STALE_MS = 5 * 60 * 1000;

    if (state.workerActive && state.workerHeartbeat) {
      const age = now - new Date(state.workerHeartbeat).getTime();
      if (age < STALE_MS) return false;
      console.log(`[Queue] Stale worker detected (${Math.round(age / 60000)}min) — claiming`);
    }

    state.workerActive = true;
    state.workerHeartbeat = new Date().toISOString();
    state.updatedAt = new Date().toISOString();
    tx.set(QUEUE_DOC, state);
    return true;
  });
}

export async function releaseWorker(): Promise<void> {
  try {
    await QUEUE_DOC.update({
      workerActive: false,
      workerHeartbeat: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[Queue] Worker release failed:', e);
  }
}

export async function enqueueJob(jobId: string, jobName: string): Promise<{ slot: number | null; position: number }> {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(QUEUE_DOC);
    const state: QueueStateV2 = doc.exists ? cleanV2State(doc.data()) : emptyState();
    while (state.slots.length < MAX_SLOTS) state.slots.push(null);

    const existingSlot = state.slots.findIndex(s => s && s.jobId === jobId);
    if (existingSlot !== -1) return { slot: existingSlot, position: 0 };

    const existingQueue = state.queue.findIndex(e => e.jobId === jobId);
    if (existingQueue !== -1) return { slot: null, position: existingQueue + 1 };

    const freeSlot = state.slots.findIndex(s => s === null);
    if (freeSlot !== -1) {
      state.slots[freeSlot] = {
        jobId,
        jobName,
        startedAt: new Date().toISOString(),
        currentShot: null,
        retryPass: 0,
      };
      state.updatedAt = new Date().toISOString();
      tx.set(QUEUE_DOC, state);
      return { slot: freeSlot, position: 0 };
    }

    state.queue.push({ jobId, jobName, queuedAt: new Date().toISOString() });
    state.updatedAt = new Date().toISOString();
    tx.set(QUEUE_DOC, state);
    return { slot: null, position: state.queue.length };
  });
}

export async function releaseSlot(jobId: string): Promise<QueueEntry | null> {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(QUEUE_DOC);
    if (!doc.exists) return null;
    const state = cleanV2State(doc.data());
    if (!state.slots) return null;

    const slotIdx = state.slots.findIndex(s => s && s.jobId === jobId);
    if (slotIdx === -1) return null;

    const next = state.queue.shift() || null;
    if (next) {
      state.slots[slotIdx] = {
        jobId: next.jobId,
        jobName: next.jobName,
        startedAt: new Date().toISOString(),
        currentShot: null,
        retryPass: 0,
      };
    } else {
      state.slots[slotIdx] = null;
    }
    state.updatedAt = new Date().toISOString();
    tx.set(QUEUE_DOC, state);
    return next;
  });
}

export async function updateSlotProgress(jobId: string, currentShot: string): Promise<void> {
  try {
    const doc = await QUEUE_DOC.get();
    if (!doc.exists) return;
    const state = doc.data() as QueueStateV2;
    if (!state.slots) return;
    const slotIdx = state.slots.findIndex(s => s && s.jobId === jobId);
    if (slotIdx === -1) return;
    state.slots[slotIdx]!.currentShot = currentShot;
    state.updatedAt = new Date().toISOString();
    await QUEUE_DOC.update({ slots: state.slots, updatedAt: state.updatedAt });
  } catch { /* non-blocking */ }
}

export async function incrementRetryPass(jobId: string): Promise<number> {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(QUEUE_DOC);
    if (!doc.exists) return -1;
    const state = doc.data() as QueueStateV2;
    if (!state.slots) return -1;
    const slotIdx = state.slots.findIndex(s => s && s.jobId === jobId);
    if (slotIdx === -1) return -1;
    const newPass = (state.slots[slotIdx]!.retryPass || 0) + 1;
    state.slots[slotIdx]!.retryPass = newPass;
    state.updatedAt = new Date().toISOString();
    tx.set(QUEUE_DOC, state);
    return newPass;
  });
}

export async function removeFromQueue(jobId: string): Promise<void> {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(QUEUE_DOC);
    if (!doc.exists) return;
    const state = cleanV2State(doc.data());
    if (!state.slots) return;

    const slotIdx = state.slots.findIndex(s => s && s.jobId === jobId);
    if (slotIdx !== -1) {
      const next = state.queue.shift() || null;
      if (next) {
        state.slots[slotIdx] = {
          jobId: next.jobId,
          jobName: next.jobName,
          startedAt: new Date().toISOString(),
          currentShot: null,
          retryPass: 0,
        };
      } else {
        state.slots[slotIdx] = null;
      }
    }

    state.queue = state.queue.filter(e => e.jobId !== jobId);
    state.updatedAt = new Date().toISOString();
    tx.set(QUEUE_DOC, state);
  });
}

// Legacy exports (backwards compat)
export async function acquireGenerationLock(jobId: string, jobName: string) {
  const result = await enqueueJob(jobId, jobName);
  return { acquired: result.slot !== null, position: result.position };
}
export async function releaseGenerationLock(jobId: string) {
  return releaseSlot(jobId);
}
export async function forceReleaseGenerationLock() {
  const state = await getQueueState();
  for (const slot of state.slots) {
    if (slot) {
      const next = await releaseSlot(slot.jobId);
      return { released: slot.jobId, next };
    }
  }
  return { released: null, next: null };
}
export async function updateQueueHeartbeat() {
  await updateWorkerHeartbeat();
}

// ══════════════════════════════════════════════════════════════════════════
// Leather label — three-tier schema CRUD (ADR-001 Option B, v1)
// ══════════════════════════════════════════════════════════════════════════

import type {
  LabelTemplate,
  LabelStyle,
  LabelColorway,
  LabelRenderConfig,
  Point2D,
} from '@/types';

// ── Tier 1: labelTemplates ────────────────────────────────────────────────

export async function getLabelTemplate(
  templateId: string,
): Promise<LabelTemplate | null> {
  const doc = await labelTemplatesCol.doc(templateId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return {
    templateId,
    name: data.name,
    artworkUrl: data.artworkUrl,
    materialTileUrls: data.materialTileUrls || {},
    aspectRatio: data.aspectRatio,
    createdAt: (data.createdAt as { toDate?: () => Date })?.toDate?.() || new Date(),
    updatedAt: (data.updatedAt as { toDate?: () => Date })?.toDate?.() || new Date(),
  };
}

export async function upsertLabelTemplate(
  t: Omit<LabelTemplate, 'createdAt' | 'updatedAt'>,
): Promise<void> {
  const ref = labelTemplatesCol.doc(t.templateId);
  const existing = await ref.get();
  const now = new Date();
  if (existing.exists) {
    await ref.update({
      name: t.name || null,
      artworkUrl: t.artworkUrl,
      materialTileUrls: t.materialTileUrls,
      aspectRatio: t.aspectRatio,
      updatedAt: now,
    });
  } else {
    await ref.set({
      name: t.name || null,
      artworkUrl: t.artworkUrl,
      materialTileUrls: t.materialTileUrls,
      aspectRatio: t.aspectRatio,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function listLabelTemplates(): Promise<LabelTemplate[]> {
  const snap = await labelTemplatesCol.orderBy('updatedAt', 'desc').get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      templateId: d.id,
      name: data.name,
      artworkUrl: data.artworkUrl,
      materialTileUrls: data.materialTileUrls || {},
      aspectRatio: data.aspectRatio,
      createdAt: (data.createdAt as { toDate?: () => Date })?.toDate?.() || new Date(),
      updatedAt: (data.updatedAt as { toDate?: () => Date })?.toDate?.() || new Date(),
    };
  });
}

// ── Tier 2: labelStyles ────────────────────────────────────────────────────

export async function getLabelStyle(
  styleCode: string,
): Promise<LabelStyle | null> {
  const doc = await labelStylesCol.doc(styleCode).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return {
    styleCode,
    templateId: data.templateId,
    anchorPhoto: data.anchorPhoto,
    labelCorners: data.labelCorners as [Point2D, Point2D, Point2D, Point2D],
    pocketCorners: data.pocketCorners as [Point2D, Point2D, Point2D, Point2D],
    updatedBy: data.updatedBy,
    updatedAt: (data.updatedAt as { toDate?: () => Date })?.toDate?.() || new Date(),
  };
}

export async function upsertLabelStyle(
  s: Omit<LabelStyle, 'updatedAt'>,
): Promise<void> {
  await labelStylesCol.doc(s.styleCode).set(
    {
      templateId: s.templateId,
      anchorPhoto: s.anchorPhoto,
      labelCorners: s.labelCorners,
      pocketCorners: s.pocketCorners,
      updatedBy: s.updatedBy,
      updatedAt: new Date(),
    },
    { merge: true },
  );
}

// ── Tier 3: labelColorways ─────────────────────────────────────────────────

export function colorwayDocId(styleCode: string, colorwayCode: string): string {
  return `${styleCode}_${colorwayCode}`;
}

export async function getLabelColorway(
  styleCode: string,
  colorwayCode: string,
): Promise<LabelColorway | null> {
  const doc = await labelColorwaysCol
    .doc(colorwayDocId(styleCode, colorwayCode))
    .get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return {
    styleCode,
    colorwayCode,
    colorwayName: data.colorwayName,
    baseColor: data.baseColor,
    stitchColor: data.stitchColor,
    embossStrength: data.embossStrength,
    grainVariant: data.grainVariant,
    sampledFromPhoto: data.sampledFromPhoto,
    updatedBy: data.updatedBy,
    updatedAt: (data.updatedAt as { toDate?: () => Date })?.toDate?.() || new Date(),
  };
}

export async function upsertLabelColorway(
  c: Omit<LabelColorway, 'updatedAt'>,
): Promise<void> {
  await labelColorwaysCol.doc(colorwayDocId(c.styleCode, c.colorwayCode)).set(
    {
      styleCode: c.styleCode,
      colorwayCode: c.colorwayCode,
      colorwayName: c.colorwayName || null,
      baseColor: c.baseColor,
      stitchColor: c.stitchColor || null,
      embossStrength: c.embossStrength,
      grainVariant: c.grainVariant,
      sampledFromPhoto: c.sampledFromPhoto || null,
      updatedBy: c.updatedBy,
      updatedAt: new Date(),
    },
    { merge: true },
  );
}

// ── Resolve: merge all three tiers into a single render config ─────────────

/**
 * Read template + style + colorway, merge into a single LabelRenderConfig
 * ready for the hybrid-label shader. Returns null if any tier is missing —
 * caller should log and skip the composite in that case.
 */
export async function resolveLabelRenderConfig(
  styleCode: string,
  colorwayCode: string,
): Promise<LabelRenderConfig | null> {
  const style = await getLabelStyle(styleCode);
  if (!style) return null;
  const colorway = await getLabelColorway(styleCode, colorwayCode);
  if (!colorway) return null;
  const template = await getLabelTemplate(style.templateId);
  if (!template) return null;
  const materialTileUrl = template.materialTileUrls[colorway.grainVariant];
  if (!materialTileUrl) return null;
  return {
    templateId: template.templateId,
    artworkUrl: template.artworkUrl,
    materialTileUrl,
    baseColor: colorway.baseColor,
    stitchColor: colorway.stitchColor,
    embossStrength: colorway.embossStrength,
    grainVariant: colorway.grainVariant,
    labelCorners: style.labelCorners,
    pocketCorners: style.pocketCorners,
    anchorPhotoWidth: style.anchorPhoto.width,
    anchorPhotoHeight: style.anchorPhoto.height,
  };
}

// ── Label asset library ──
// Photo-based label templates (alpha-masked PNGs in GCS). Wardrobe items
// reference these via leatherLabelTemplateId / pocketLabelTemplateId.
// One doc per template: { templateId, name, type: 'leather'|'pocket',
// imageUrl, sourceTiffPath?, updatedAt }.

export interface LabelAsset {
  templateId: string;
  name: string;
  type: 'leather' | 'pocket';
  imageUrl: string;
  sourceTiffPath?: string;
  updatedAt?: Date;
}

export async function getLabelAsset(
  templateId: string | undefined | null,
): Promise<LabelAsset | null> {
  if (!templateId) return null;
  const doc = await labelAssetsCol.doc(templateId).get();
  if (!doc.exists) return null;
  const data = doc.data() as LabelAsset;
  if (!data?.imageUrl) return null;
  return data;
}

/**
 * Resolve the leather + pocket label image URLs for a focus wardrobe item.
 *
 * Lookup order for leather:
 *   1. leatherLabelTemplateId → labelAssets/{id}.imageUrl  (canonical, alpha-masked PNG)
 *   2. leatherLabelImageUrl                                (legacy direct URL — typically a JPEG)
 * Pocket has no legacy field, so it's purely templateId.
 *
 * Returns { leatherUrl: null, pocketUrl: null } when nothing is available.
 * This is the single source of truth used by Seedream gen, the manual warp
 * preview, and the apply-label endpoint, so there's no drift between paths.
 */
export interface ResolvedLabelUrls {
  leatherUrl: string | null;
  pocketUrl: string | null;
}

export async function resolveLabelAssetUrls(focusItem: {
  leatherLabelTemplateId?: string | null;
  pocketLabelTemplateId?: string | null;
  leatherLabelImageUrl?: string | null;
}): Promise<ResolvedLabelUrls> {
  let leatherUrl: string | null = null;
  let pocketUrl: string | null = null;

  if (focusItem.leatherLabelTemplateId) {
    const asset = await getLabelAsset(focusItem.leatherLabelTemplateId);
    if (asset?.imageUrl) leatherUrl = asset.imageUrl;
  }
  // Fall back to the legacy direct-URL field if templateId is unset OR the
  // doc lookup miss-fired (asset deleted, typo, etc). Keeps older wardrobe
  // items working without forcing a migration.
  if (!leatherUrl && focusItem.leatherLabelImageUrl) {
    leatherUrl = focusItem.leatherLabelImageUrl;
  }

  if (focusItem.pocketLabelTemplateId) {
    const asset = await getLabelAsset(focusItem.pocketLabelTemplateId);
    if (asset?.imageUrl) pocketUrl = asset.imageUrl;
  }

  return { leatherUrl, pocketUrl };
}

export default db;
