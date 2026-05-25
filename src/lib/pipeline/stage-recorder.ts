/**
 * Pipeline-stage recorder.
 *
 * Saves the buffer at each post-processing stage to GCS at a predictable
 * debug path so reviewers can inspect intermediate outputs after the fact
 * and identify which stage introduced an artifact ("paintbrush look",
 * blur, color shift, edge smoothing, etc.).
 *
 * Non-blocking: every save is wrapped in try/catch — a GCS hiccup must
 * NEVER fail the shot. Returns the URL on success, null on failure.
 *
 * GCS path: `{jobName}/debug/{modelId}_{shotType}_v{version}_{stage}.png`
 *
 * Stages used in production (M03/M04 only — others can call too):
 *   pass1        — M04 two-pass Pass 1 output (model + bra + shoes, no jeans)
 *   seedream     — raw Seedream final-pass output (pre any Gemini editing)
 *   teeedit      — after Gemini tee-edit (real top painted in)
 *   shoeedit     — after Gemini shoe-edit (shoes repositioned under hem)
 *   label        — after auto-hybrid leather-label composite
 *   upscaled     — after 4K square lanczos upscale (sharp)
 *   matte-grey   — grey-backdrop variant from subject-matte Cloud Run Job
 *   matte-white  — white-backdrop variant from subject-matte Cloud Run Job
 *   final        — the saved master (same as shot.imageUrl; redundant but lets
 *                  the UI overlay show "before / after final" against
 *                  matte-grey if a later step rewrote the buffer)
 */
import { uploadGeneratedImage } from '@/lib/gcs';

export type PipelineStage =
  | 'pass1'
  | 'seedream'
  | 'teeedit'
  | 'shoeedit'
  | 'label'
  | 'upscaled'
  | 'matte-raw-grey'    // rembg + procedural shadow only (pre Gemini regen)
  | 'matte-raw-white'   // rembg + composite to white (pre Gemini regen)
  | 'matte-grey'        // after Gemini grounding-shadow regen
  | 'matte-white'       // after Gemini grounding-shadow regen
  | 'final';

export interface SaveStageArgs {
  jobName: string;
  modelId: string;
  shotType: string;
  version: number;
  stage: PipelineStage;
  buffer: Buffer;
}

/**
 * Save a pipeline stage to GCS. Returns the public URL or null on failure
 * (non-blocking — logs but doesn't throw).
 */
export async function saveStage(args: SaveStageArgs): Promise<string | null> {
  const { jobName, modelId, shotType, version, stage, buffer } = args;
  try {
    const filename = `${modelId}_${shotType}_v${version}_${stage}.png`;
    const url = await uploadGeneratedImage(`${jobName}/debug`, filename, buffer);
    console.log(`[Stage:${stage}] ${shotType} saved (${buffer.length} bytes) → ${url}`);
    return url;
  } catch (e) {
    console.log(`[Stage:${stage}] ${shotType} save FAILED (non-blocking):`, e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Construct the expected URL for a given stage (without fetching). Used by
 * the UI to build a "stages" gallery that tries to load each stage and
 * silently hides 404s for stages that didn't run for this shot type.
 *
 * NOTE: only meaningful AFTER a deploy that wrote with this naming
 * convention. Older shots predating the recorder don't have these objects.
 */
export function stageUrl(
  jobName: string,
  modelId: string,
  shotType: string,
  version: number,
  stage: PipelineStage,
): string {
  const filename = `${modelId}_${shotType}_v${version}_${stage}.png`;
  return `https://storage.googleapis.com/gstar-ai-studio-assets/output/${encodeURIComponent(jobName)}/debug/${encodeURIComponent(filename)}`;
}
