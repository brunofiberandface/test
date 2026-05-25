/**
 * Jobs API — v2 Pro pipeline.
 *
 * GET: List jobs
 * POST: Create job with 3 wardrobe items + focus + model selection
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  createJob, listJobs, createShot, updateJobStatus, updateJob,
  enqueueJob, getActivePrompt, getWardrobeItem, getModel,
} from '@/lib/firestore';
import { downloadGarmentImage } from '@/lib/gcs';
import { runSilhouetteForWardrobe } from '@/lib/pipeline/silhouette';
import { APP_CONFIG } from '@/lib/config';
import type { JobWardrobe, FitModelAngles, JobStatus } from '@/types';
import { normalizeWardrobeItem } from '@/lib/wardrobe-compat';
import { triggerWorker } from '@/lib/worker/trigger';
import { isMatrixCellComplete } from '@/lib/qa/shoe-matrix';
import { getCurrentBatchJob, submitSingleCellBatch } from '@/lib/qa/shoe-matrix-batch';

function getInternalBase(): string {
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

// GET /api/jobs
// Query params:
//   includeArchived=true            — include archived jobs in the result
//   cursor=<ms>                     — pagination cursor: createdAt-ms of the
//                                     LAST job in the previous page. Omit
//                                     for first page (newest 50).
//   limit=<n>                       — page size, default 50, max 200.
//   fetchAll=true                   — fetch the ENTIRE collection in one
//                                     call (no pagination). Used by the
//                                     dashboard when the user has any
//                                     search filter active — search should
//                                     match against the full DB, not just
//                                     the currently-paginated slice. Caps
//                                     at limit=5000 to avoid runaway loads
//                                     on collections that have grown.
// Response:
//   { jobs: [...], hasMore: bool, nextCursor: <ms> | null }
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const includeArchived = searchParams.get('includeArchived') === 'true';
    const cursorParam = searchParams.get('cursor');
    const limitParam = searchParams.get('limit');
    const fetchAll = searchParams.get('fetchAll') === 'true';
    const cursorMs = cursorParam ? Number(cursorParam) : undefined;
    const limit = fetchAll ? 5000 : (limitParam ? Number(limitParam) : undefined);

    const { jobs: allJobs, hasMore, nextCursorMs } = await listJobs(undefined, { cursorMs, limit });
    const jobs = includeArchived ? allJobs : allJobs.filter((j: any) => !j.archived);

    // Auto-fix stuck jobs. Ignore retired shotTypes (M03/M04) — legacy job
    // docs may carry shot rows for those types that will never reach 'done'
    // because the worker no longer dispatches them.
    const stuckJobs = jobs.filter((j: any) => j.status === 'generating');
    if (stuckJobs.length > 0) {
      const { listShots } = await import('@/lib/firestore');
      const activeShotTypes = new Set<string>(APP_CONFIG.shotTypes);
      await Promise.all(stuckJobs.map(async (job: any) => {
        try {
          const jobId = job.jobId || job.id;
          const shots = await listShots(jobId);
          const activeShots = shots.filter((s: any) => activeShotTypes.has(s.shotType));
          if (activeShots.length === 0) return;
          const allDone = activeShots.every((s: any) => s.status === 'done' || s.status === 'approved');
          if (allDone) {
            await updateJobStatus(jobId, 'review');
            job.status = 'review';
          }
        } catch { /* non-blocking */ }
      }));
    }

    // Enrich jobs with focus item description, category, and model name
    await Promise.all(jobs.map(async (job: any) => {
      try {
        // Resolve focus wardrobe item. Fall back to bottom item when no
        // slot is flagged isFocus — older jobs (pre-focus-picker) didn't
        // mark any slot, but the bottom is the de-facto hero for those.
        const w = job.wardrobe;
        if (w) {
          const focusEntry = [w.shoe, w.top, w.bottom].find((slot: any) => slot?.isFocus) || w.bottom;
          if (focusEntry?.itemId) {
            const item = await getWardrobeItem(focusEntry.itemId) as any;
            if (item) {
              // Parse "D12345-X678-Y999 DESIGN NAME" into separate fields
              const fullName = item.name || '—';
              const match = fullName.match(/^(D\d+[-\w]+)\s+(.+)$/);
              if (match) {
                job.focusDesignNumber = match[1];  // e.g. "D29953-E875-J648"
                job.focusDesignName = match[2];     // e.g. "LOUX BOYFRIEND WMN"
              } else if (item.designNumber) {
                job.focusDesignNumber = item.designNumber;
                job.focusDesignName = fullName;
              } else {
                job.focusDesignNumber = '';
                job.focusDesignName = fullName;
              }
              job.focusName = fullName;  // keep full name for backward compat
              job.focusCategory = item.category || '—';
              // Resolve the focus item's front fit-model photo so the
              // dashboard can show it as an "Original" thumbnail. Falls
              // back to the flat-front product image when no fit-model
              // photo is set. Only set if not already on the job doc
              // (newer jobs persist focusFitModelFrontUrl at creation).
              if (!job.focusFitModelFrontUrl) {
                job.focusFitModelFrontUrl =
                  item.fitModels?.front
                  || item.fitModelFrontUrl
                  || item.thumbnailUrl
                  || item.flatFrontUrl
                  || (Array.isArray(item.fitModelUrls) ? item.fitModelUrls[0] : undefined)
                  || '';
              }
            }
          }
        }
        // Resolve model name
        if (job.modelId) {
          const model = await getModel(job.modelId) as any;
          if (model) {
            job.modelName = model.name || job.modelId;
          }
        }
        // Enrich jobs with shot counts so the dashboard can show progress
        // ("Generating 3/6", "In Review 4/6"). Approved shot thumbnails are
        // surfaced for review/complete jobs only — pending/generating won't
        // have approved shots, but they will have done shots worth showing
        // as a progress count.
        const ENRICHABLE = ['generating', 'queued', 'review', 'complete', 'completed', 'done'];
        if (ENRICHABLE.includes(job.status)) {
          try {
            const { listShots } = await import('@/lib/firestore');
            const jobId = job.jobId || job.id;
            const shots = await listShots(jobId);
            const approvedCount = shots.filter((s: any) => s.status === 'approved').length;
            const preApprovedCount = shots.filter((s: any) => s.status !== 'approved' && s.wasApproved === true).length;
            // "Done" for progress purposes = shot has produced an image
            // (status 'done' OR 'approved'). Reviewers see the count of
            // shots that successfully rendered.
            const doneCount = shots.filter((s: any) => s.status === 'done' || s.status === 'approved').length;
            job.approvedCount = approvedCount;
            job.preApprovedCount = preApprovedCount;
            job.doneCount = doneCount;
            job.totalShots = shots.length;
            // Stable shot-type order for the thumbnail list
            const SHOT_ORDER = ['M01', 'M02', 'M03', 'M04', 'M05', 'M06'];
            // Show approved AND pre-approved shots as thumbnails. wasApproved
            // distinguishes the two visually in the UI (amber border for
            // pre-approved, neutral for approved).
            job.approvedShots = shots
              .filter((s: any) => s.status === 'approved' || (s.wasApproved === true && s.status === 'done'))
              .map((s: any) => ({
                shotId: s.shotId || s.id,
                shotType: s.shotType,
                wasApproved: s.status !== 'approved' && s.wasApproved === true,
                // Prefer PLP/PDP variants (smaller files) for the dashboard
                // thumbnails — full grey/white masters are 4K and slow to
                // load just to render an 8×10 thumb. Falls back to the master
                // for older shots that predate the deliverable-format step.
                imageUrl: s.plpUrl || s.pdpUrl || s.greyMasterUrl || s.imageUrl,
              }))
              .sort((a: any, b: any) => {
                const ai = SHOT_ORDER.indexOf(a.shotType);
                const bi = SHOT_ORDER.indexOf(b.shotType);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
              });
          } catch { /* non-blocking */ }
        }
      } catch { /* non-blocking enrichment */ }
    }));

    return NextResponse.json({ jobs, hasMore, nextCursor: nextCursorMs });
  } catch (error) {
    console.error('Error listing jobs:', error);
    return NextResponse.json({ error: 'Failed to list jobs' }, { status: 500 });
  }
}

// POST /api/jobs — create a new generation job
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      jobName,
      creatorEmail,
      modelId,
      wardrobe,  // { shoe: { itemId, isFocus }, top: { itemId, isFocus }, bottom: { itemId, isFocus } }
      stylingNotes,
      provider,  // 'gemini' | 'seedream' — absent falls back to production default ('gemini')
      m06PoseId,  // optional — id from src/lib/m06-poses.ts; absent falls back to default pose
    } = body;

    if (!creatorEmail || !modelId || !wardrobe) {
      return NextResponse.json({ error: 'Missing required fields: creatorEmail, modelId, wardrobe' }, { status: 400 });
    }

    if (provider && provider !== 'gemini' && provider !== 'seedream') {
      return NextResponse.json({ error: `Invalid provider: ${provider}` }, { status: 400 });
    }

    // Validate wardrobe structure
    const w = wardrobe as JobWardrobe;
    if (!w.shoe?.itemId || !w.top?.itemId || !w.bottom?.itemId) {
      return NextResponse.json({ error: 'Wardrobe must include shoe, top, and bottom items' }, { status: 400 });
    }

    // Ensure exactly one focus
    const focusCount = [w.shoe, w.top, w.bottom].filter(x => x.isFocus).length;
    if (focusCount !== 1) {
      return NextResponse.json({ error: 'Exactly one wardrobe item must be marked as focus' }, { status: 400 });
    }

    // Get active prompt revisions. As of 2026-05-17 matrix-paint M01/M02
    // also load from the vault (Seedream pipeline) — same regression-safe
    // pattern as M05/M06.
    const promptRevisions: Record<string, number> = {};
    for (const st of APP_CONFIG.shotTypes) {
      // Matrix-paint shots use the Seedream pipeline specifically.
      const pipeline = (st === 'M01' || st === 'M02') ? 'seedream' as const : undefined;
      const active = await getActivePrompt(st, undefined, pipeline);
      if (!active) {
        return NextResponse.json(
          { error: `No active prompt found for ${st}${pipeline ? ` (pipeline=${pipeline})` : ''}. Upload prompts to the vault first.` },
          { status: 400 }
        );
      }
      promptRevisions[st] = active.revision;
    }

    // Resolve focus item for auto-naming — use full "D12345-X678 DESIGN NAME" as job name
    const focusSlotEntry = Object.entries(w).find(([, v]) => v.isFocus)!;
    const focusItemForName = await getWardrobeItem(focusSlotEntry[1].itemId) as any;
    let autoJobName = jobName;
    if (!autoJobName && focusItemForName?.name) {
      // Use the full wardrobe item name (e.g., "D29953-E875-J648 LOUX BOYFRIEND WMN")
      autoJobName = focusItemForName.name;
    }
    if (!autoJobName) {
      autoJobName = `Job ${new Date().toISOString().slice(0, 10)}`;
    }

    // Create job
    const jobId = await createJob({
      jobName: autoJobName,
      creatorEmail,
      modelId,
      wardrobe: w,
      promptRevisions,
      ...(stylingNotes ? { stylingNotes } : {}),
      ...(provider ? { provider } : {}),
      ...(m06PoseId ? { m06PoseId } : {}),
    });

    console.log(`[Job] Created job ${jobId}`);

    // ── Load cached silhouette from wardrobe item ──
    // Silhouette is computed once on wardrobe upload and cached on the doc.
    // If missing (legacy items), run it now and cache for next time.
    const focusSlot = Object.entries(w).find(([, v]) => v.isFocus)!;
    const focusItem = await getWardrobeItem(focusSlot[1].itemId) as any;

    const normalized = normalizeWardrobeItem(focusItem);
    if (!normalized || !normalized.flatFrontUrl) {
      return NextResponse.json(
        { error: 'Focus garment must have fit model images and at least a flat front image' },
        { status: 400 }
      );
    }

    const fitModels: FitModelAngles = normalized.fitModels;

    try {
      let silhouette: { front: string; back: string };

      if (focusItem.silhouetteFront && focusItem.silhouetteBack) {
        // Cached — skip analysis
        silhouette = { front: focusItem.silhouetteFront, back: focusItem.silhouetteBack };
        console.log(`[Job] Using cached silhouette for "${focusItem.name}" (front: ${silhouette.front.length} chars, back: ${silhouette.back.length} chars)`);
      } else {
        // Legacy item without cached silhouette — run once and cache
        console.log(`[Job] No cached silhouette for "${focusItem.name}" — running analysis and caching...`);
        silhouette = await runSilhouetteForWardrobe(focusSlot[1].itemId);
      }

      // Store silhouette results on the job
      await updateJob(jobId, { silhouetteAnalysis: silhouette });
      console.log(`[Job] Silhouette loaded`);
    } catch (silErr) {
      console.error(`[Job] Silhouette failed:`, silErr);
      // Continue without silhouette — generation will work but less accurate
      await updateJob(jobId, {
        silhouetteAnalysis: { front: '', back: '' },
        silhouetteError: String(silErr),
      });
    }

    // ── Create shot records ──
    // All active shotTypes get a 'pending' shot doc. Worker processes them
    // in dependency order. For matrix-paint shots (M01/M02) promptRevision
    // is 0 since they bypass the vault.
    const shotIds: string[] = [];
    for (const shotType of APP_CONFIG.shotTypes) {
      const shotId = await createShot({
        jobId,
        modelId,
        shotType,
        prompt: '', // prompt loaded from vault at generation time (or hardcoded for matrix shots)
        promptRevision: promptRevisions[shotType] ?? 0,
        status: 'pending',
      });
      shotIds.push(shotId);
    }

    // ── Matrix-cell readiness gate ─────────────────────────────────────────
    // M01/M02 depend on the (shoe × model) Tier-2 cell being fully rendered.
    // If it's not, park the job in 'awaiting-matrix' and (best-effort) kick
    // off a single-cell batch render. Worker tick polls the cell + resumes
    // the job when all 4 views land.
    const cellReady = await isMatrixCellComplete(w.shoe.itemId, modelId);

    let jobStatus: JobStatus = 'generating';
    let enqueueResult: { slot: number | null; position: number } | null = null;
    let awaitingCellBatchName: string | undefined;

    if (cellReady) {
      jobStatus = 'generating';
      await updateJobStatus(jobId, jobStatus);
      enqueueResult = await enqueueJob(jobId, jobName || jobId);
      console.log(`[Job] Matrix cell ready — enqueued: slot=${enqueueResult.slot}, position=${enqueueResult.position}`);
    } else {
      jobStatus = 'awaiting-matrix';
      console.log(`[Job] Matrix cell missing for (${w.shoe.itemId} × ${modelId}) — parking job in awaiting-matrix`);

      // Try to submit a single-cell batch if no other batch is live.
      try {
        const existingBatch = await getCurrentBatchJob();
        const live = existingBatch && (existingBatch.state === 'PENDING' || existingBatch.state === 'RUNNING');
        if (!live) {
          const apiKey = process.env.GEMINI_API_KEY;
          if (apiKey) {
            const submitResult = await submitSingleCellBatch(w.shoe.itemId, modelId, apiKey);
            awaitingCellBatchName = submitResult.name;
            console.log(`[Job] Submitted single-cell batch ${submitResult.name} for missing cell`);
          } else {
            console.warn('[Job] GEMINI_API_KEY not set — cannot submit single-cell batch. Job will wait for an external batch to land the cell.');
          }
        } else {
          console.log(`[Job] Batch ${existingBatch.name} is ${existingBatch.state} — job will wait for it to finish before its own batch can be submitted`);
        }
      } catch (submitErr) {
        console.error('[Job] Single-cell batch submit failed (non-blocking — worker will retry):', submitErr);
      }

      await updateJob(jobId, {
        status: jobStatus,
        awaitingCell: {
          shoeId: w.shoe.itemId,
          modelId,
          parkedAt: Date.now(),
          ...(awaitingCellBatchName ? { batchName: awaitingCellBatchName } : {}),
        },
      });
    }

    // ── Respond then fire worker ──
    const response = NextResponse.json({
      success: true,
      jobId,
      shotsCreated: shotIds.length,
      status: jobStatus,
      ...(enqueueResult ? { slot: enqueueResult.slot, position: enqueueResult.position } : {}),
      ...(jobStatus === 'awaiting-matrix' ? { awaitingCell: { shoeId: w.shoe.itemId, modelId, batchName: awaitingCellBatchName } } : {}),
    });

    // Fire worker kick AFTER building response — DO NOT AWAIT.
    // Branches on WORKER_MODE env var: 'inproc' (default) → in-process worker,
    // 'job' → triggers gstar-worker-job Cloud Run Job.
    // For awaiting-matrix jobs the worker tick will scan + (eventually) resume
    // the job once the cell lands. For ready jobs it dispatches shots normally.
    triggerWorker(jobStatus === 'awaiting-matrix' ? 'job-create-awaiting-matrix' : 'job-create').catch(() => { /* already logged inside helper */ });

    return response;
  } catch (error) {
    console.error('Error creating job:', error);
    return NextResponse.json({ error: 'Failed to create job', details: String(error) }, { status: 500 });
  }
}
