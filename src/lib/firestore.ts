import { Firestore, FieldValue } from '@google-cloud/firestore';
import crypto from 'crypto';

// Initialize Firestore — uses Application Default Credentials on Cloud Run
// For local dev, set GOOGLE_APPLICATION_CREDENTIALS env var
export const db = new Firestore({
  projectId: process.env.FIRESTORE_PROJECT_ID || process.env.GCP_PROJECT_ID,
});

// ── Collections ──
export const usersCol = db.collection('users');
export const modelsCol = db.collection('models');
export const jobsCol = db.collection('jobs');
export const shotsCol = db.collection('shots');
export const modificationsCol = db.collection('modifications');
export const promptAdjustmentsCol = db.collection('promptAdjustments');
export const otpCol = db.collection('otpCodes');
export const wardrobeCol = db.collection('wardrobe');
export const commentsCol = db.collection('comments');

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
    expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
  });
}

export async function verifyOTP(email: string, code: string): Promise<boolean> {
  const doc = await otpCol.doc(email).get();
  if (!doc.exists) return false;
  const data = doc.data()!;
  if (data.code !== code) return false;
  if (new Date() > data.expiresAt.toDate()) return false;
  // Delete after successful verification
  await otpCol.doc(email).delete();
  return true;
}

// ── Model operations ──
export async function listModels(activeOnly = true) {
  const snap = activeOnly
    ? await modelsCol.where('active', '==', true).get()
    : await modelsCol.get();
  const models = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Sort by modelId in memory to avoid composite index requirement
  return models.sort((a: any, b: any) => (a.modelId || a.id).localeCompare(b.modelId || b.id));
}

export async function getModel(modelId: string) {
  const doc = await modelsCol.doc(modelId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

export async function createModel(modelId: string, data: {
  name: string;
  description: string;
  cardImageUrl: string;
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

// ── Job operations ──
export async function createJob(data: {
  designNumber: string;
  jobName?: string;
  creatorEmail: string;
  garmentCategory: string;
  description: string;
  metadata: Record<string, string>;
  modelIds: string[];
}) {
  const ref = jobsCol.doc();
  await ref.set({
    jobId: ref.id,
    ...data,
    status: 'uploading',
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
      // Convert Firestore Timestamps to ISO strings for JSON serialization
      createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt,
      updatedAt: data.updatedAt?.toDate?.() ? data.updatedAt.toDate().toISOString() : data.updatedAt,
    };
  });
}

export async function updateJobStatus(jobId: string, status: string) {
  await jobsCol.doc(jobId).update({ status, updatedAt: new Date() });
}

export async function archiveJob(jobId: string, archived: boolean = true) {
  await jobsCol.doc(jobId).update({
    archived,
    ...(archived ? { archivedAt: new Date() } : {}),
    updatedAt: new Date(),
  });
}

export async function deleteJob(jobId: string) {
  // Delete all shots for this job
  const shotsSnap = await shotsCol.where('jobId', '==', jobId).get();
  const batch = db.batch();
  shotsSnap.docs.forEach(doc => batch.delete(doc.ref));
  // Delete all modifications for shots in this job
  const modsSnap = await modificationsCol.where('jobId', '==', jobId).get();
  modsSnap.docs.forEach(doc => batch.delete(doc.ref));
  // Delete the job itself
  batch.delete(jobsCol.doc(jobId));
  await batch.commit();
}

export async function deleteJobs(jobIds: string[]) {
  // Firestore batch limit is 500 — chunk if needed
  const allDeletes: Array<{ ref: FirebaseFirestore.DocumentReference }> = [];
  for (const jobId of jobIds) {
    allDeletes.push({ ref: jobsCol.doc(jobId) });
    const shotsSnap = await shotsCol.where('jobId', '==', jobId).get();
    shotsSnap.docs.forEach(doc => allDeletes.push({ ref: doc.ref }));
    const modsSnap = await modificationsCol.where('jobId', '==', jobId).get();
    modsSnap.docs.forEach(doc => allDeletes.push({ ref: doc.ref }));
  }
  // Execute in chunks of 500
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
  shotId?: string;       // optional — null = job-level comment
  shotType?: string;     // e.g. 'M01', for display
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
  variant: string;
  prompt: string;
}) {
  const ref = shotsCol.doc();
  await ref.set({
    shotId: ref.id,
    ...data,
    version: 1,
    status: 'queued',
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
  driveFileId: string;
  version: number;
  progressStep: string;
  progressPct: number;
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
export async function createWardrobeItem(data: {
  name: string;
  category: string;
  gender?: 'male' | 'female' | 'unisex';
  description: string;
  imageUrls: string[];
  fitModelUrls?: string[];
  flatImageUrl?: string;
  thumbnailUrl: string;
  isPrimary?: boolean;
  openShoes?: boolean;
  hasHeels?: boolean;
}) {
  const ref = wardrobeCol.doc();
  // Default: shoes = styling item (false), everything else = focus garment (true)
  const isPrimary = data.isPrimary !== undefined ? data.isPrimary : data.category !== 'shoes';
  // Default gender: shoes = unisex, others = unisex if not specified
  const gender = data.gender || 'unisex';
  await ref.set({
    wardrobeId: ref.id,
    ...data,
    gender,
    isPrimary,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return ref.id;
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

// ── Dressed Base operations ──
// A "dressed base" is a pre-rendered model card showing the model wearing a specific wardrobe combo.
// Doc ID = `${modelId}_${wardrobeHash}_${view}` — deterministic, no composite index needed.
// Supports 4 views: front (0°), right (90°), back (180°), left (270°)
export type DressedView = 'front' | 'right' | 'back' | 'left';
export const dressedBasesCol = db.collection('dressedBases');

export async function createDressedBase(data: {
  modelId: string;
  wardrobeItemIds: Record<string, string>;
  wardrobeHash: string;
  view: DressedView;
  imageUrl: string;
  wardrobeItemNames: Record<string, string>;
  qcScore?: number;
  qcPass?: boolean;
}) {
  const docId = `${data.modelId}_${data.wardrobeHash}_${data.view}`;
  await dressedBasesCol.doc(docId).set({
    ...data,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return docId;
}

export async function findDressedBase(modelId: string, wardrobeHash: string, view: DressedView = 'front') {
  const docId = `${modelId}_${wardrobeHash}_${view}`;
  const doc = await dressedBasesCol.doc(docId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt,
  };
}

/** Returns all 4 view docs for a given model + wardrobeHash combo */
export async function getDressedBaseViews(modelId: string, wardrobeHash: string) {
  const snap = await dressedBasesCol
    .where('modelId', '==', modelId)
    .where('wardrobeHash', '==', wardrobeHash)
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

export async function listDressedBases(modelId: string) {
  const snap = await dressedBasesCol.where('modelId', '==', modelId).get();
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt,
    };
  }).sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function deleteDressedBase(docId: string) {
  await dressedBasesCol.doc(docId).delete();
}

// ── Generation Queue v2 ──
// Server-side worker with 2 parallel slots.
// No SSE streams, no browser dependency. Worker runs server-side and
// processes jobs to completion. Cloud Scheduler pings every 3 min as safety net.

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
  currentShot: string | null;  // e.g. "M03_A" — what's generating right now
  retryPass: number;           // 0 = first pass, 1 = retry pass 1, 2 = retry pass 2
}

export interface QueueStateV2 {
  slots: (SlotState | null)[];  // always length 2
  queue: QueueEntry[];
  workerHeartbeat: string | null;
  workerActive: boolean;
  updatedAt: string;
}

// Back-compat: keep old interface name for any remaining imports
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

/** Strip legacy single-slot fields from a raw Firestore document before writing back.
 *  The old schema had: activeJobId, activeJobName, activeStartedAt, activeHeartbeat.
 *  These ghost fields cause the dashboard to show a stuck job even when v2 slots are empty. */
function cleanV2State(raw: any): QueueStateV2 {
  return {
    slots: raw.slots || [null, null],
    queue: raw.queue || [],
    workerHeartbeat: raw.workerHeartbeat || null,
    workerActive: raw.workerActive || false,
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

/** Get current queue state */
export async function getQueueState(): Promise<QueueStateV2> {
  const doc = await QUEUE_DOC.get();
  if (!doc.exists) return emptyState();
  const data = doc.data() as QueueStateV2;
  // Migration: if old single-slot schema, convert AND persist to clear legacy fields
  if (!data.slots) {
    const old = data as any;
    const migrated = emptyState();
    if (old.activeJobId) {
      migrated.slots[0] = {
        jobId: old.activeJobId,
        jobName: old.activeJobName || '',
        startedAt: old.activeStartedAt || new Date().toISOString(),
        currentShot: null,
        retryPass: 0,
      };
    }
    migrated.queue = old.queue || [];
    migrated.updatedAt = old.updatedAt || new Date().toISOString();
    // v35: Persist migration — overwrites entire doc, clearing legacy fields
    // (activeJobId, activeJobName, activeStartedAt, activeHeartbeat)
    try {
      await QUEUE_DOC.set(migrated);
      console.log('[Queue] Migrated single-slot schema to v2 and persisted');
    } catch (e) {
      console.warn('[Queue] Migration persist failed (non-blocking):', e);
    }
    return migrated;
  }
  // Ensure slots array is always length 2
  while (data.slots.length < MAX_SLOTS) data.slots.push(null);
  return data;
}

/** Hard-reset the queue document to a clean empty state. Clears all legacy fields. */
export async function resetQueueState(): Promise<void> {
  await QUEUE_DOC.set(emptyState());
  console.log('[Queue] Queue state hard-reset to empty');
}

/** Update worker heartbeat — called by the worker loop after each shot */
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

/** Claim worker role. Returns true if this caller should run the worker loop. */
export async function claimWorker(): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(QUEUE_DOC);
    const state: QueueStateV2 = doc.exists ? (doc.data() as QueueStateV2) : emptyState();

    // Migration guard
    if (!state.slots) Object.assign(state, emptyState());

    const now = Date.now();
    const STALE_MS = 5 * 60 * 1000; // 5 min — worker is dead if no heartbeat

    // If worker is active and heartbeat is fresh, another worker is running
    if (state.workerActive && state.workerHeartbeat) {
      const age = now - new Date(state.workerHeartbeat).getTime();
      if (age < STALE_MS) {
        return false; // Another worker is alive
      }
      console.log(`[Queue] Stale worker detected (heartbeat ${Math.round(age / 60000)}min old) — claiming`);
    }

    // Claim worker role
    state.workerActive = true;
    state.workerHeartbeat = new Date().toISOString();
    state.updatedAt = new Date().toISOString();
    tx.set(QUEUE_DOC, state);
    return true;
  });
}

/** Release worker role (called when worker loop exits) */
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

/**
 * Add a job to the queue. If a slot is free, assigns directly.
 * Returns the slot index (0 or 1) if assigned, or queue position if queued.
 */
export async function enqueueJob(jobId: string, jobName: string): Promise<{ slot: number | null; position: number }> {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(QUEUE_DOC);
    const state: QueueStateV2 = doc.exists ? cleanV2State(doc.data()) : emptyState(); // v35: strip legacy fields
    while (state.slots.length < MAX_SLOTS) state.slots.push(null);

    // Already in a slot?
    const existingSlot = state.slots.findIndex(s => s && s.jobId === jobId);
    if (existingSlot !== -1) return { slot: existingSlot, position: 0 };

    // Already in queue?
    const existingQueue = state.queue.findIndex(e => e.jobId === jobId);
    if (existingQueue !== -1) return { slot: null, position: existingQueue + 1 };

    // Free slot available?
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

    // No free slot — add to queue
    state.queue.push({ jobId, jobName, queuedAt: new Date().toISOString() });
    state.updatedAt = new Date().toISOString();
    tx.set(QUEUE_DOC, state);
    return { slot: null, position: state.queue.length };
  });
}

/**
 * Release a slot and fill it from the queue. Called when a job finishes.
 */
export async function releaseSlot(jobId: string): Promise<QueueEntry | null> {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(QUEUE_DOC);
    if (!doc.exists) return null;
    const state = cleanV2State(doc.data()); // v35: strip legacy fields
    if (!state.slots) return null;

    const slotIdx = state.slots.findIndex(s => s && s.jobId === jobId);
    if (slotIdx === -1) return null;

    // Pop next from queue
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

/** Update the current shot label for a slot (for UI display) */
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

/** Increment retry pass for a slot */
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

/** Remove a job from queue or slot (e.g. cancelled/deleted) */
export async function removeFromQueue(jobId: string): Promise<void> {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(QUEUE_DOC);
    if (!doc.exists) return;
    const state = cleanV2State(doc.data()); // v35: strip legacy fields
    if (!state.slots) return;

    // Remove from slot
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

    // Remove from queue
    state.queue = state.queue.filter(e => e.jobId !== jobId);
    state.updatedAt = new Date().toISOString();
    tx.set(QUEUE_DOC, state);
  });
}

// Legacy exports for gradual migration — these are no-ops or adapters
export async function acquireGenerationLock(jobId: string, jobName: string): Promise<{ acquired: boolean; position: number }> {
  const result = await enqueueJob(jobId, jobName);
  return { acquired: result.slot !== null, position: result.position };
}
export async function releaseGenerationLock(jobId: string): Promise<QueueEntry | null> {
  return releaseSlot(jobId);
}
export async function forceReleaseGenerationLock(): Promise<{ released: string | null; next: QueueEntry | null }> {
  // Release first occupied slot
  const state = await getQueueState();
  for (const slot of state.slots) {
    if (slot) {
      const next = await releaseSlot(slot.jobId);
      return { released: slot.jobId, next };
    }
  }
  return { released: null, next: null };
}
export async function updateQueueHeartbeat(jobId: string): Promise<void> {
  await updateWorkerHeartbeat();
}

export default db;
