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
import { qaShoeMatrixCol, getModel, getWardrobeItem } from '@/lib/firestore';
import { FieldValue, Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { uploadGeneratedImage } from '@/lib/gcs';
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

// ──────────────────────────────────────────────────────────────────────────
// Google Gemini Files API + Batch API helpers
//
// Reference: https://ai.google.dev/gemini-api/docs/batch-api
// Reference: https://ai.google.dev/api/files
//
// Auth: API key in query string `?key=API_KEY`, same pool as generateContent.
// ──────────────────────────────────────────────────────────────────────────

const GENERATIVE_API_BASE = 'https://generativelanguage.googleapis.com';

interface UploadedFile {
  name: string;       // "files/abc123"
  uri: string;        // full URI like "https://generativelanguage.googleapis.com/v1beta/files/abc123"
  mimeType: string;
  sizeBytes: string;
}

/**
 * Upload a buffer to the Gemini Files API using resumable protocol.
 * Returns the file resource. Files have a 48-hour lifetime by default,
 * which is plenty for a batch that completes within 24h.
 */
async function uploadFileToGemini(
  buffer: Buffer,
  mimeType: string,
  displayName: string,
  apiKey: string,
): Promise<UploadedFile> {
  // Step 1: initiate resumable upload with metadata.
  const initRes = await fetch(`${GENERATIVE_API_BASE}/upload/v1beta/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(buffer.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  if (!initRes.ok) {
    throw new Error(`Files init failed ${initRes.status}: ${await initRes.text()}`);
  }
  const uploadUrl = initRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('No upload URL returned from init');

  // Step 2: upload bytes to the URL.
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Length': String(buffer.length),
    },
    body: buffer as unknown as ArrayBuffer,
  });
  if (!uploadRes.ok) {
    throw new Error(`File upload failed ${uploadRes.status}: ${await uploadRes.text()}`);
  }
  const data = await uploadRes.json() as { file: UploadedFile };
  return data.file;
}

async function fetchBufferFromUrl(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const r = await fetch(url.split('?')[0]);
  if (!r.ok) throw new Error(`fetch ${url.slice(0, 80)} → ${r.status}`);
  return {
    buffer: Buffer.from(await r.arrayBuffer()),
    mimeType: r.headers.get('content-type') || 'image/png',
  };
}

/**
 * Build the same prompt as renderMatrixCellView's buildMatrixPrompt.
 * Duplicated here to avoid a circular module dependency. Keep in sync.
 */
function buildBatchPrompt(view: ViewKey): string {
  const isBack = view === 'fullBodyBack' || view === 'legsBack';
  const isLegsOnly = view === 'legsFront' || view === 'legsBack';

  return `Photorealistic studio reference photo, 1:1 SQUARE crop, 4K resolution, ${isBack ? 'BACK' : 'FRONT'} VIEW, ${isLegsOnly ? 'waist-down (legs + feet)' : 'full body head-to-toe'}.

═══ THIS IS A NARROW EDIT — IMAGE 1 IS YOUR BLUEPRINT ═══
The output is IMAGE 1 with shoes added. Every pixel of IMAGE 1 outside the bare-feet area MUST be preserved exactly:
- Identity (face, hair, skin tone, body proportions): preserved from IMAGE 1.
- Outfit (top + bottom): preserved from IMAGE 1.
- Pose (stance, foot placement, hip/shoulder angle, arm position, hand position, head tilt): preserved from IMAGE 1.
- Background (light-grey studio sweep #D9DAD2): preserved from IMAGE 1.
- Lighting, framing, composition, camera angle: preserved from IMAGE 1.

═══ THE EDIT — REPLACE BARE FEET WITH THE SHOES IN IMAGE 2 ═══
The model in IMAGE 1 is barefoot. Replace ONLY the bare-feet area with the shoes shown in IMAGE 2:
- Shoe style: match IMAGE 2 exactly — same shape, colour, material, finish, sole, hardware, laces, straps.
- Shoe scale: rendered at correct anatomical proportions for the model's feet in IMAGE 1. The shoes fit the model's existing foot positions — same stance, same foot orientation, same gap between feet.
- Position: each shoe sits on the floor at exactly the same spot the corresponding bare foot was standing in IMAGE 1. ${isBack ? 'Heels visible to the camera.' : 'Toes/tops of shoes visible to the camera.'}
- Both shoes fully visible — neither shoe is occluded, hidden behind the other foot, or cropped.
- The floor shadow under each shoe is faint and soft, matching the studio lighting in IMAGE 1.

═══ ABSOLUTELY FORBIDDEN ═══
- DO NOT modify the model's face, hair, skin tone, or body — those are 100% locked to IMAGE 1.
- DO NOT modify the outfit (top, bottom) — preserved from IMAGE 1.
- DO NOT modify the pose, stance, or foot placement.
- DO NOT change the background, lighting, or framing.
- DO NOT show only one shoe — both shoes are fully visible at correct anatomical proportions.
- DO NOT add socks, ankle accessories, or anything not in IMAGE 2.`;
}

/**
 * Submit a batch of cell renders to Gemini Pro Image Preview Batch API.
 *
 * Steps:
 *   1. Group entries by unique (shoeId, modelId, view, isBack) so each
 *      input ref file is uploaded only once.
 *   2. Upload each unique Tier-1 base image + shoe flat to the Files API,
 *      receiving file URIs that the batch service can read.
 *   3. Build a JSONL where each line references the file_uris instead of
 *      inlining megabytes of base64 data.
 *   4. Upload the JSONL to the Files API as the batch input.
 *   5. POST to /v1beta/models/{model}:batchGenerateContent with the file
 *      name as inputConfig.
 *   6. Persist the batch resource name + entries to Firestore so the poll
 *      endpoint can map results back to cells.
 */
export async function submitBatch(entries: BatchEntry[], apiKey: string): Promise<{ name: string; totalRequests: number }> {
  if (entries.length === 0) throw new Error('No entries to submit');
  if (entries.length > 10000) throw new Error(`Batch too large (${entries.length} > 10000 max per Google docs)`);

  console.log(`[submitBatch] preparing ${entries.length} requests`);
  const db = new Firestore();

  // Step 1: collect unique refs that need uploading. The Tier-1 base
  // depends on (modelId, view) — each combo has its own asset. The shoe
  // ref depends on (shoeId, isBack) — front/back use different shoe flats
  // when available.
  const tier1RefKeys = new Set<string>();   // `${modelId}::${view}`
  const shoeRefKeys = new Set<string>();    // `${shoeId}::${isBack}`
  for (const e of entries) {
    const isBack = e.view === 'fullBodyBack' || e.view === 'legsBack';
    tier1RefKeys.add(`${e.modelId}::${e.view}`);
    shoeRefKeys.add(`${e.shoeId}::${isBack ? 'back' : 'front'}`);
  }
  console.log(`[submitBatch] uniques: ${tier1RefKeys.size} tier-1 refs, ${shoeRefKeys.size} shoe refs`);

  // Step 2: resolve each unique ref → download buffer → upload to Files API.
  const tier1UriByKey = new Map<string, { uri: string; mimeType: string }>();
  for (const key of tier1RefKeys) {
    const [modelId, view] = key.split('::') as [string, ViewKey];
    const model = await getModel(modelId) as Record<string, string | undefined> | null;
    if (!model) throw new Error(`Model ${modelId} not found`);
    const tier1Url = model[`assets4K_${view}`];
    if (!tier1Url) throw new Error(`Model ${modelId} missing assets4K_${view}`);
    const { buffer, mimeType } = await fetchBufferFromUrl(tier1Url);
    const file = await uploadFileToGemini(buffer, mimeType, `tier1-${modelId}-${view}`, apiKey);
    tier1UriByKey.set(key, { uri: file.uri, mimeType: file.mimeType });
    console.log(`[submitBatch] uploaded tier1 ${key} → ${file.name}`);
  }

  const shoeUriByKey = new Map<string, { uri: string; mimeType: string }>();
  for (const key of shoeRefKeys) {
    const [shoeId, side] = key.split('::');
    const shoe = await getWardrobeItem(shoeId) as { flatFrontUrl?: string; flatBackUrl?: string } | null;
    if (!shoe) throw new Error(`Shoe ${shoeId} not found`);
    const shoeUrl = side === 'back' ? (shoe.flatBackUrl || shoe.flatFrontUrl) : shoe.flatFrontUrl;
    if (!shoeUrl) throw new Error(`Shoe ${shoeId} has no flat for side=${side}`);
    const { buffer, mimeType } = await fetchBufferFromUrl(shoeUrl);
    const file = await uploadFileToGemini(buffer, mimeType, `shoe-${shoeId}-${side}`, apiKey);
    shoeUriByKey.set(key, { uri: file.uri, mimeType: file.mimeType });
    console.log(`[submitBatch] uploaded shoe ${key} → ${file.name}`);
  }

  // Step 3: build the JSONL. Each line is a complete BatchRequest.
  const lines: string[] = [];
  for (const e of entries) {
    const isBack = e.view === 'fullBodyBack' || e.view === 'legsBack';
    const tier1 = tier1UriByKey.get(`${e.modelId}::${e.view}`)!;
    const shoe = shoeUriByKey.get(`${e.shoeId}::${isBack ? 'back' : 'front'}`)!;
    const requestObj = {
      contents: [{
        role: 'user',
        parts: [
          { text: buildBatchPrompt(e.view) },
          { file_data: { mime_type: tier1.mimeType, file_uri: tier1.uri } },
          { file_data: { mime_type: shoe.mimeType, file_uri: shoe.uri } },
        ],
      }],
      generation_config: {
        response_modalities: ['IMAGE'],
        image_config: { aspect_ratio: '1:1', image_size: '4K' },
      },
    };
    lines.push(JSON.stringify({ key: e.requestKey, request: requestObj }));
  }
  const jsonlBuffer = Buffer.from(lines.join('\n'), 'utf-8');
  console.log(`[submitBatch] JSONL built: ${lines.length} lines, ${(jsonlBuffer.length / 1024 / 1024).toFixed(2)} MB`);

  // Step 4: upload the JSONL to the Files API.
  const jsonlFile = await uploadFileToGemini(
    jsonlBuffer,
    'application/jsonl',
    `qa-matrix-batch-${Date.now()}`,
    apiKey,
  );
  console.log(`[submitBatch] JSONL uploaded → ${jsonlFile.name}`);

  // Step 5: submit the batch. The :batchGenerateContent endpoint takes a
  // `batch` object with display_name + input_config.file_name (the Files
  // API name, NOT the URI).
  const batchRes = await fetch(
    `${GENERATIVE_API_BASE}/v1beta/models/${GEMINI_MODEL}:batchGenerateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch: {
          display_name: `qa-matrix-batch-${Date.now()}`,
          input_config: { file_name: jsonlFile.name },
        },
      }),
    },
  );
  if (!batchRes.ok) {
    throw new Error(`batchGenerateContent failed ${batchRes.status}: ${await batchRes.text()}`);
  }
  const batchData = await batchRes.json() as { name: string; metadata?: { state?: string } };
  const batchName = batchData.name;
  console.log(`[submitBatch] batch submitted → ${batchName}, state=${batchData.metadata?.state}`);

  // Step 6: persist batch tracking doc.
  await db.collection('system').doc(BATCH_JOB_DOC_ID).set({
    name: batchName,
    state: 'PENDING' as BatchState,
    submittedAt: FieldValue.serverTimestamp(),
    totalRequests: entries.length,
    completedRequests: 0,
    failedRequests: 0,
    inputUri: jsonlFile.name,
    outputUri: '',
    entries,
  });

  return { name: batchName, totalRequests: entries.length };
}

/**
 * Poll the current batch job. If complete, downloads the result JSONL,
 * parses each row, decodes the inline image, uploads to GCS, generates a
 * thumb, and patches the cell doc.
 *
 * Returns the batch state + progress counters so the UI can render.
 */
export async function checkBatch(apiKey: string): Promise<{ state: BatchState; progress: { done: number; total: number } } | null> {
  const db = new Firestore();
  const doc = await db.collection('system').doc(BATCH_JOB_DOC_ID).get();
  if (!doc.exists) return null;
  const job = doc.data() as Record<string, unknown>;
  const name = job.name as string;
  if (!name) throw new Error('Batch doc has no name field');

  // Poll Google.
  const statusRes = await fetch(`${GENERATIVE_API_BASE}/v1beta/${name}?key=${apiKey}`);
  if (!statusRes.ok) {
    throw new Error(`batch status fetch failed ${statusRes.status}: ${await statusRes.text()}`);
  }
  const status = await statusRes.json() as {
    name: string;
    metadata?: { state?: string };
    state?: string;
    response?: { output_file?: { file_name?: string } };
  };
  // The state shows up in different places depending on completion phase.
  const rawState = status.metadata?.state || status.state || 'JOB_STATE_UNSPECIFIED';
  // Google uses JOB_STATE_* prefix; map to our shorter enum.
  const normalisedState: BatchState = rawState.includes('SUCCEEDED') ? 'SUCCEEDED'
    : rawState.includes('FAILED') ? 'FAILED'
    : rawState.includes('CANCELLED') ? 'CANCELLED'
    : rawState.includes('RUNNING') ? 'RUNNING'
    : 'PENDING';

  await db.collection('system').doc(BATCH_JOB_DOC_ID).set(
    {
      state: normalisedState,
      lastCheckedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // Not done? Return progress so far.
  if (normalisedState !== 'SUCCEEDED') {
    return {
      state: normalisedState,
      progress: { done: (job.completedRequests as number) || 0, total: (job.totalRequests as number) || 0 },
    };
  }

  // Done — download the result JSONL.
  const outputFileName = status.response?.output_file?.file_name;
  if (!outputFileName) {
    throw new Error('Batch SUCCEEDED but no output_file in response');
  }
  console.log(`[checkBatch] downloading results from ${outputFileName}`);
  const dlRes = await fetch(
    `${GENERATIVE_API_BASE}/download/v1beta/${outputFileName}:download?alt=media&key=${apiKey}`,
  );
  if (!dlRes.ok) {
    throw new Error(`result download failed ${dlRes.status}: ${await dlRes.text()}`);
  }
  const resultText = await dlRes.text();
  const resultLines = resultText.split('\n').filter(l => l.trim().length > 0);
  console.log(`[checkBatch] got ${resultLines.length} result lines`);

  // Process each line. Key format: `${cellId}::${view}` — split to find the cell.
  const sharp = (await import('sharp')).default;
  let done = 0;
  let failed = 0;
  for (const line of resultLines) {
    try {
      const row = JSON.parse(line) as {
        key: string;
        response?: { candidates?: Array<{ content?: { parts?: Array<{ inline_data?: { mime_type?: string; data?: string } }> } }> };
        error?: { message?: string };
      };
      const [cellId, view] = row.key.split('::') as [string, ViewKey];
      if (!cellId || !view) {
        console.warn(`[checkBatch] bad key ${row.key}, skipping`);
        failed++;
        continue;
      }
      if (row.error) {
        console.warn(`[checkBatch] ${row.key} error: ${row.error.message}`);
        failed++;
        continue;
      }
      const inlinePart = row.response?.candidates?.[0]?.content?.parts?.find(p => p.inline_data?.data);
      if (!inlinePart?.inline_data?.data) {
        console.warn(`[checkBatch] ${row.key} no inline image data`);
        failed++;
        continue;
      }
      const imgBuf = Buffer.from(inlinePart.inline_data.data, 'base64');
      const mime = inlinePart.inline_data.mime_type || 'image/png';
      // Recover (shoeId, modelId) from the existing cell doc.
      const cellSnap = await qaShoeMatrixCol.doc(cellId).get();
      if (!cellSnap.exists) {
        console.warn(`[checkBatch] cell ${cellId} not in Firestore, skipping`);
        failed++;
        continue;
      }
      const cellData = cellSnap.data() as { shoeId: string; modelId: string };
      const ext = mime === 'image/jpeg' ? 'jpg' : 'png';
      const imageUrl = await uploadGeneratedImage(
        `qa-matrix/${cellData.shoeId}/${cellData.modelId}`,
        `${view}.${ext}`,
        imgBuf,
        mime,
      );
      const thumbBuf = await sharp(imgBuf)
        .resize(512, 512, { fit: 'cover', kernel: 'lanczos3' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      const thumbUrl = await uploadGeneratedImage(
        `qa-matrix/${cellData.shoeId}/${cellData.modelId}`,
        `${view}_thumb.jpg`,
        thumbBuf,
        'image/jpeg',
      );
      const v = Date.now();
      await qaShoeMatrixCol.doc(cellId).set(
        {
          [`images.${view}`]: `${imageUrl}?v=${v}`,
          [`thumbs.${view}`]: `${thumbUrl}?v=${v}`,
          viewsCompleted: FieldValue.arrayUnion(view),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      done++;
    } catch (err) {
      console.error(`[checkBatch] line process failed:`, err);
      failed++;
    }
  }

  // Mark cells whose 4 views are all in: check viewsCompleted length per cell.
  const touchedCellIds = new Set<string>();
  for (const line of resultLines) {
    try {
      const row = JSON.parse(line) as { key: string };
      const [cellId] = row.key.split('::');
      touchedCellIds.add(cellId);
    } catch { /* ignore */ }
  }
  for (const cellId of touchedCellIds) {
    const cellSnap = await qaShoeMatrixCol.doc(cellId).get();
    if (!cellSnap.exists) continue;
    const data = cellSnap.data() as { viewsCompleted?: ViewKey[] };
    const completedSet = new Set(data.viewsCompleted || []);
    const status: 'done' | 'partial' = completedSet.size === VIEWS.length ? 'done' : 'partial';
    await qaShoeMatrixCol.doc(cellId).set({ status }, { merge: true });
  }

  await db.collection('system').doc(BATCH_JOB_DOC_ID).set(
    {
      state: 'SUCCEEDED' as BatchState,
      completedAt: FieldValue.serverTimestamp(),
      completedRequests: done,
      failedRequests: failed,
      outputUri: outputFileName,
    },
    { merge: true },
  );

  console.log(`[checkBatch] processed ${done} ok, ${failed} failed`);
  return { state: 'SUCCEEDED', progress: { done, total: (job.totalRequests as number) || resultLines.length } };
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
