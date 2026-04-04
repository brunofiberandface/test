import { Firestore, FieldValue } from '@google-cloud/firestore';
import crypto from 'crypto';

// Initialize Firestore
export const db = new Firestore({
  projectId: process.env.GCP_PROJECT || 'gstar-ai-studio',
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
  active: boolean;
}>) {
  await modelsCol.doc(modelId).update({ ...data, updatedAt: new Date() });
}

// ── Job operations (v2: structured wardrobe + prompt revisions) ──
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
}) {
  const ref = jobsCol.doc();
  await ref.set({
    jobId: ref.id,
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

export async function listJobs(creatorEmail?: string) {
  let query = jobsCol.orderBy('createdAt', 'desc').limit(50);
  if (creatorEmail) query = query.where('creatorEmail', '==', creatorEmail);
  const snap = await query.get();
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
  const snap = await query.get();
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

  // Deactivate all previous active revisions for this shot type
  const activeSnap = await promptVaultCol
    .where('shotType', '==', data.shotType)
    .where('isActive', '==', true)
    .get();
  const batch = db.batch();
  activeSnap.docs.forEach(doc => {
    // Only deactivate matching category (or all if no category)
    const docData = doc.data();
    if (!data.category || docData.category === data.category) {
      batch.update(doc.ref, { isActive: false });
    }
  });

  // Create new revision
  const ref = promptVaultCol.doc();
  batch.set(ref, {
    id: ref.id,
    ...data,
    revision: newRevision,
    isActive: true,
    uploadedAt: new Date(),
  });

  await batch.commit();
  return { id: ref.id, revision: newRevision };
}

/**
 * Get the active prompt file for a shot type.
 */
export async function getActivePrompt(shotType: string, category?: string): Promise<any | null> {
  let query: FirebaseFirestore.Query = promptVaultCol
    .where('shotType', '==', shotType)
    .where('isActive', '==', true);
  if (category) {
    query = query.where('category', '==', category);
  }
  const snap = await query.limit(1).get();
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
const MAX_SLOTS = 2;

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

export default db;
