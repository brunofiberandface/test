/**
 * Gemini Pro Image Preview Batch API integration for the Tier-2 (model × shoe)
 * cache.
 *
 * Why Batch API:
 *   - 50% cheaper than synchronous Pro Image Preview ($0.12/image vs $0.24).
 *   - Async — no Cloud Run request timeout to worry about.
 *   - Single submit covers up to ~1k requests in one batch.
 *   - Results land in GCS as JSONL; we poll/pull when ready.
 *
 * Per Google's published SLA, batches complete within 24h (usually <12h).
 * For the Tier-2 batch (~1,220 requests), expect 2-12h wall time.
 *
 * Architecture:
 *   1. SUBMIT (this module → POST /api/qa/shoe-matrix/batch-submit)
 *      - Walks every pending cell × 4 views = N requests.
 *      - Builds a JSONL file with one request per row (prompt + refs as
 *        inline base64 / GCS URIs).
 *      - Uploads JSONL to gs://gstar-ai-studio-assets/batch-inputs/...
 *      - Calls Google's batches.create endpoint.
 *      - Stores batch job name in `system/shoeMatrixBatchJob` Firestore doc.
 *
 *   2. POLL (this module → POST /api/qa/shoe-matrix/batch-check)
 *      - Reads batch job name from Firestore.
 *      - Calls Google's batches.get to check state.
 *      - When state = SUCCEEDED, downloads result JSONL from GCS.
 *      - Parses each result row, decodes the image, uploads to GCS as the
 *        cell's view image, generates thumb, patches the cell doc.
 *
 * Firestore tracking:
 *   system/shoeMatrixBatchJob {
 *     name: "batches/12345..."        // Google's batch resource name
 *     state: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED"
 *     submittedAt, lastCheckedAt, completedAt
 *     totalRequests, completedRequests, failedRequests
 *     inputUri, outputUri          // GCS paths
 *     entries: [{ cellId, view, requestKey }]
 *   }
 *
 * Status: SCAFFOLD ONLY. Implementation pending — see `TODO_*` markers below.
 */
import { qaShoeMatrixCol } from '@/lib/firestore';
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { VIEWS, type ViewKey } from './shoe-matrix';

const BATCH_INPUT_PREFIX = 'batch-inputs/qa-shoe-matrix';
const BATCH_OUTPUT_PREFIX = 'batch-outputs/qa-shoe-matrix';
const BATCH_JOB_DOC_ID = 'shoeMatrixBatchJob';
const BUCKET_NAME = 'gstar-ai-studio-assets';
const GEMINI_MODEL = 'gemini-3-pro-image-preview';

export interface BatchEntry {
  cellId: string;
  shoeId: string;
  modelId: string;
  view: ViewKey;
  /** request_id field sent to Google so we can map results back to cells. */
  requestKey: string;
}

export type BatchState = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface BatchJobDoc {
  name: string;
  state: BatchState;
  submittedAt: Date;
  lastCheckedAt?: Date;
  completedAt?: Date;
  totalRequests: number;
  completedRequests: number;
  failedRequests: number;
  inputUri: string;
  outputUri: string;
  entries: BatchEntry[];
}

/**
 * Collect the entries that should be submitted in the next batch. Each
 * pending or failed cell becomes 4 entries (one per view).
 *
 * Caller decides whether to include cells with status='partial' — usually
 * yes (retry the failed views) — or skip them.
 */
export async function collectPendingBatchEntries(options: {
  includePartial?: boolean;
  shoeIds?: string[];   // limit to specific shoes
  modelIds?: string[];  // limit to specific models
} = {}): Promise<BatchEntry[]> {
  const includePartial = options.includePartial ?? true;
  const snap = await qaShoeMatrixCol.get();
  const entries: BatchEntry[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (data.archived) continue;
    if (data.blocked) continue;
    if (options.shoeIds && !options.shoeIds.includes(data.shoeId)) continue;
    if (options.modelIds && !options.modelIds.includes(data.modelId)) continue;
    const status = data.status as string;
    const wantsRender = status === 'pending' || status === 'failed' || (includePartial && status === 'partial');
    if (!wantsRender) continue;

    const viewsCompleted = (data.viewsCompleted || []) as ViewKey[];
    const completedSet = new Set(viewsCompleted);
    for (const view of VIEWS) {
      if (completedSet.has(view)) continue; // skip already-done views
      entries.push({
        cellId: d.id,
        shoeId: data.shoeId,
        modelId: data.modelId,
        view,
        requestKey: `${d.id}::${view}`,
      });
    }
  }
  return entries;
}

/**
 * TODO_SUBMIT — Build the JSONL request file and submit to Gemini Batch API.
 *
 * This requires:
 *   1. For each entry, build the same prompt + refs as renderMatrixCellView
 *      (in shoe-matrix.ts). Refs come from Tier-1 4K barefoot + shoe flat.
 *   2. Encode refs as inline base64 (fast, no GCS round-trip per ref) OR as
 *      GCS URIs (smaller request file but requires public-read or per-call
 *      auth). Inline is simpler for v1.
 *   3. Each JSONL row:
 *        { "key": "<requestKey>", "request": { contents: [...], generationConfig: {...} } }
 *   4. Upload to gs://{BUCKET_NAME}/{BATCH_INPUT_PREFIX}/{timestamp}.jsonl
 *   5. POST to https://generativelanguage.googleapis.com/v1beta/models/{model}:batchGenerateContent
 *      with body { name, displayName, inputConfig: { fileName }, outputConfig: { ... } }
 *   6. Persist BatchJobDoc with entries + uris + state='PENDING'.
 */
export async function submitBatch(entries: BatchEntry[], _apiKey: string): Promise<{ name: string; totalRequests: number }> {
  if (entries.length === 0) throw new Error('No entries to submit');
  if (entries.length > 10000) throw new Error(`Batch too large (${entries.length} > 10000 max per Google docs)`);

  // TODO_SUBMIT: implement JSONL build + GCS upload + Google batches.create call.
  // Stub for now so the rest of the wiring compiles.
  throw new Error(
    `submitBatch not yet implemented — would submit ${entries.length} requests. ` +
    `See TODO_SUBMIT in shoe-matrix-batch.ts.`,
  );
}

/**
 * TODO_POLL — Check the current batch job's state and, if complete, pull
 * results and write to per-cell GCS + Firestore.
 *
 * 1. Read system/shoeMatrixBatchJob from Firestore.
 * 2. GET https://generativelanguage.googleapis.com/v1beta/{name} → state.
 * 3. If state in {PENDING, RUNNING}: update lastCheckedAt, return.
 * 4. If SUCCEEDED: download output JSONL from outputUri, parse each row,
 *    decode the inline image, upload to qa-matrix/{shoeId}/{modelId}/{view}.png,
 *    generate thumb, patch the cell doc's images[view]/thumbs[view]/viewsCompleted.
 * 5. After all entries processed, set the batch state to SUCCEEDED + completedAt.
 */
export async function checkBatch(_apiKey: string): Promise<{ state: BatchState; progress: { done: number; total: number } } | null> {
  const db = new Firestore();
  const doc = await db.collection('system').doc(BATCH_JOB_DOC_ID).get();
  if (!doc.exists) return null;
  // TODO_POLL: implement the fetch + parse + write-back flow.
  throw new Error('checkBatch not yet implemented — see TODO_POLL in shoe-matrix-batch.ts');
}

/** Return the current batch job doc (or null if none). UI uses this for the
 *  status banner. Safe to call frequently. */
export async function getCurrentBatchJob(): Promise<BatchJobDoc | null> {
  const db = new Firestore();
  const doc = await db.collection('system').doc(BATCH_JOB_DOC_ID).get();
  if (!doc.exists) return null;
  const d = doc.data() as Record<string, unknown>;
  return {
    name: d.name as string,
    state: d.state as BatchState,
    submittedAt: (d.submittedAt as { toDate?: () => Date } | undefined)?.toDate?.() || new Date(0),
    lastCheckedAt: (d.lastCheckedAt as { toDate?: () => Date } | undefined)?.toDate?.(),
    completedAt: (d.completedAt as { toDate?: () => Date } | undefined)?.toDate?.(),
    totalRequests: (d.totalRequests as number) || 0,
    completedRequests: (d.completedRequests as number) || 0,
    failedRequests: (d.failedRequests as number) || 0,
    inputUri: d.inputUri as string,
    outputUri: d.outputUri as string,
    entries: (d.entries as BatchEntry[]) || [],
  };
}

/** Manually clear the batch job doc so a new batch can be submitted. */
export async function clearBatchJob(): Promise<void> {
  const db = new Firestore();
  await db.collection('system').doc(BATCH_JOB_DOC_ID).delete();
}

// Type-export convenience for endpoints that need to know constants.
export { BATCH_INPUT_PREFIX, BATCH_OUTPUT_PREFIX, BATCH_JOB_DOC_ID, BUCKET_NAME, GEMINI_MODEL };
// Re-export for the sync layer to import the same default storage instance.
export { Storage };
