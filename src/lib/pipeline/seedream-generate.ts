/**
 * Seedream-backed shot generation — single-pass for all 5 shots.
 *
 * DESIGN NOTES
 * ------------
 * - Mirrors the reference-assembly logic of the legacy Gemini generateM* functions
 *   (src/lib/pipeline/generate.ts), but passes ref images as URLs instead of
 *   downloading them to Buffers. The GCS bucket has public read, so BytePlus can
 *   fetch them directly.
 * - Uses the SAME prompts as Gemini — no Seedream-specific overrides. Per Bruno:
 *   "start with the prompts as we have them now, this very small poc is not the
 *   base to change it all."
 * - No dressed base Phase 1 for M03/M04: the dressed-base pipeline is a
 *   Gemini-specific correction for foot proportion drift. Seedream is single-pass
 *   at every shot. If output quality regresses vs Gemini, we iterate.
 * - Image labels (which the Gemini pipeline interleaves as text between image
 *   payloads) are dropped — Seedream's API is prompt + image-URL array only.
 *   We log them for debugging.
 *
 * Shot ref assembly follows the LEGACY (pre-dressed-base) patterns:
 *   M03: model ref + flat front + 3 front angles + top front + shoes front   = 7
 *   M04: back ref (+ front ref) + flat back + 3 back angles + top back + shoes back (+ leather label) = 8–10
 *   M01: model ref + M03 anchor + flat front + 3 front angles + top + shoes  = 8
 *   M02: back ref (+ front ref) + M04 anchor + flat back + 3 back angles + top + shoes = 9–10
 *   M05: (back ref|model ref) + M04 anchor + M03 anchor + flat back + 3 back angles = 7
 *
 * All within BytePlus's 10-ref limit.
 */
import { getWardrobeItem, getModel, resolveLabelAssetUrls } from '@/lib/firestore';
import { injectSilhouette, injectStylingDescriptions, injectGender, injectGarmentType, type LoadedPrompt } from './prompt-loader';
import { APP_CONFIG } from '@/lib/config';
import type { ShotType, JobWardrobe, FitModelAngles, FocusSlot } from '@/types';
import { normalizeWardrobeItem } from '@/lib/wardrobe-compat';
import { generateSeedreamImage, isSeedream5, type SeedreamReferenceImage } from './seedream-client';
import { ensureSeedreamSafeUrl } from './seedream-image-safe';
import { getM06Pose } from '@/lib/m06-poses';
import { pickTopVariant, TOP_VARIANTS, type TopVariantId } from './m05-prompts';

/**
 * Replace the "### Pose Archetype …" section of an M06 prompt with a
 * freshly-formatted block driven by the selected pose's description.
 * The pose section runs from "### Pose Archetype" to the next "###" header.
 * No-op if the prompt doesn't contain "### Pose Archetype".
 */
function swapM06PoseBlock(promptContent: string, poseLabel: string, poseDescription: string): string {
  // Wrap description with explicit reference to the POSE REFERENCE visual ref.
  // The visual ref is injected at slot 1 of the Seedream refs (see seedreamM06).
  // This text serves as a fallback / reinforcement of the visual.
  const block = `### Pose Archetype — ${poseLabel}\nThe model's pose MUST match the POSE REFERENCE image (Image 2, labeled "POSE REFERENCE") exactly. The pose in that reference image is the canonical target — body angle, arm placement, hand position, hip tilt, head turn, and gaze direction all come from it. The text below describes the same pose for clarity.\n\n${poseDescription}\n\nReminder: the pose comes from the POSE REFERENCE image. Do NOT default to a generic frontal arms-at-sides stance. Do NOT copy the pose from the model card or fit-model photographs — those references show neutral default poses. The pose for this render is the one shown in the POSE REFERENCE image.\n`;
  const idx = promptContent.indexOf('### Pose Archetype');
  if (idx < 0) {
    return promptContent + `\n\n${block}`;
  }
  const after = promptContent.substring(idx);
  const nextHeaderRel = after.substring(20).search(/\n### /);
  const endIdx = nextHeaderRel >= 0 ? idx + 20 + nextHeaderRel : promptContent.length;
  return promptContent.substring(0, idx) + block + promptContent.substring(endIdx);
}

export interface SeedreamGenerationContext {
  wardrobe: JobWardrobe;
  modelId: string;
  silhouette: { front: string; back: string };
  m03AnchorUrl?: string;
  m04AnchorUrl?: string;
  apiKey?: string; // BytePlus API key override; falls back to env
  /** Optional Seedream model override. Defaults to SEEDREAM_MODEL env var or
   *  'seedream-4-5-251128'. Use 'seedream-5-0-260128' to call 5.0 Lite. */
  model?: string;
  /** M06 pose selection — id from src/lib/m06-poses.ts (e.g. 'p07').
   *  Optional: jobs created before the pose picker shipped fall back to
   *  M06_DEFAULT_POSE_ID inside seedreamM06. */
  m06PoseId?: string;
  /** M05 top-focus variant override (e.g. 'A'). When set, seedreamM05
   *  uses this specific variant instead of the random pick. Only applies
   *  when ctx.focusSlot === 'top'. */
  m05TopVariantId?: TopVariantId;
  /** M06 top-focus pose override (id 't01'-'t05' from m06-top-poses.ts).
   *  When set on a top-focus job, the renderer uses this exact pose instead
   *  of the random pick. Only applies when ctx.focusSlot === 'top'. */
  m06TopPoseId?: string;
  /** Slot name of the wardrobe item flagged isFocus. When 'top' (focus is a
   *  jacket / shirt / etc.), the pipeline switches branches:
   *    - rewriteTopForSeedream returns the real Opus description (no sports-
   *      bra placeholder) so Seedream paints the focus garment directly.
   *    - needsTeeEdit returns false (the post-Seedream Gemini tucking pass
   *      would force the focus jacket tucked into the jeans — destructive).
   *    - M04 routes through the legacy single-pass path instead of the
   *      two-pass dispatcher (two-pass paints the bottom as the hero, wrong
   *      for top-focus).
   *    - M01/M02 crop to upper body (head → mid-femur) instead of waist-down
   *      so the focus garment is visible in the cropped frame.
   *  Optional — undefined means "no explicit focus", which is also the safe
   *  default for legacy jobs created before the wardrobe focus picker. */
  focusSlot?: FocusSlot;
}

export interface SeedreamGenerationResult {
  imageData: Buffer;
  mimeType: string;
  /** The Seedream model that produced this image. Caller should record this
   *  on the shot doc so downstream steps (tee-edit, etc) know which model
   *  ran — 5.0 handles tucked-in tops natively, so tee-edit is skipped. */
  model?: string;
  /** M04 two-pass only: GCS URL of the Pass 1 (sports-bra + briefs + shoes)
   *  intermediate. Surfaced so the caller can record it in pipelineStages
   *  for the debug viewer. Absent for single-pass M04 + every other shot. */
  pass1Url?: string;
}

/** Strip query string (?v=..., signed URL params) so BytePlus fetches the raw object. */
function cleanUrl(url: string): string {
  return url.split('?')[0];
}

/**
 * Build a Seedream ref. Runs the URL through the 10 MiB guard — oversized GCS
 * objects get a cached `_seedream.jpg` sibling and we return that path instead.
 */
async function refFromUrl(url: string, label: string): Promise<SeedreamReferenceImage> {
  const safeUrl = await ensureSeedreamSafeUrl(cleanUrl(url));
  return { url: safeUrl, label };
}

/**
 * SMART-CROP HELPER (originally M05-only 2026-05-11, generalized 2026-05-13).
 *
 * Downloads `sourceUrl`, crops to vertical band [fromPct, toPct], uploads to
 * GCS at a content-addressed path, returns the cropped URL. Re-uses an
 * existing cropped object if already cached.
 *
 * Why: ref framing was being dominated by the full-body model card + fit-model
 * refs (visual evidence > text instructions per LEARNING #89). Cropping these
 * refs to just the relevant zone BEFORE Seedream sees them aligns the
 * visual + text signals — Seedream renders tight when refs are tight.
 *
 * Per-ref crops in production:
 *   MODEL CARD FRONT    → vertical 0-30%  (M03 head/shoulders identity anchor
 *                                          — counters fit-model identity bleed
 *                                          when 3 fit-model angles outvote the
 *                                          single full-body model card)
 *   MODEL CARD BACK     → vertical 5-30%  (M05 head/shoulders — skin tone,
 *                                          NO compression-shorts styling)
 *   FIT MODEL BACK 45°  → vertical 25-60% (M05 hip/buttock — garment + framing)
 *
 * Cache: GCS path cropped-refs/{sha1(sourceUrl|from|to)}.jpg. Renamed from
 * m05-cropped-refs/ on 2026-05-13 when M03 started using the same helper —
 * existing M05 cache entries remain valid under the old path; new entries go
 * to the unified path. Both paths are read-only references by Seedream.
 */
async function cropAndCacheRef(
  sourceUrl: string,
  fromPct: number,
  toPct: number,
): Promise<string> {
  const crypto = await import('crypto');
  const sharp = (await import('sharp')).default;
  const { Storage } = await import('@google-cloud/storage');

  const clean = sourceUrl.split('?')[0];
  const key = crypto.createHash('sha1').update(`${clean}|${fromPct}|${toPct}`).digest('hex');
  const gcsPath = `cropped-refs/${key}.jpg`;
  const publicUrl = `https://storage.googleapis.com/gstar-ai-studio-assets/${gcsPath}`;

  const storage = new Storage();
  const bucket = storage.bucket('gstar-ai-studio-assets');
  const file = bucket.file(gcsPath);
  const [exists] = await file.exists();
  if (exists) return publicUrl;

  // Cache miss — download, crop, upload
  const resp = await fetch(clean);
  if (!resp.ok) throw new Error(`[M05 crop] fetch ${clean} → ${resp.status}`);
  const sourceBuf = Buffer.from(await resp.arrayBuffer());

  const img = sharp(sourceBuf);
  const meta = await img.metadata();
  const w = meta.width!;
  const h = meta.height!;
  const top = Math.round(h * fromPct);
  const cropH = Math.round(h * (toPct - fromPct));
  const croppedBuf = await img
    .extract({ left: 0, top, width: w, height: cropH })
    .jpeg({ quality: 90 })
    .toBuffer();

  await file.save(croppedBuf, {
    metadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
  });
  console.log(`[M05 crop] cached ${w}x${h} → ${w}x${cropH} (v${(fromPct*100).toFixed(0)}-${(toPct*100).toFixed(0)}%) at ${gcsPath}`);
  return publicUrl;
}

/**
 * Canonical clean studio backdrop reference. Uniform light-grey sweep
 * (4000×4000) — same #D5D3CC palette the M03/M04/M06 prompts already specify.
 * Injected as an explicit ref to counteract the floor-texture bleed-through
 * from fit-model photos: text instructions ("studio is fresh and pristine,
 * fit-model photo backgrounds are not part of this render") get outweighed
 * by visual evidence in the fit-model refs. Giving Seedance a clean backdrop
 * IMAGE provides a competing visual anchor for the studio environment.
 *
 * Used in M03 / M04 / M06. Skipped for M05 (close-up, no floor) and M01/M02
 * (cropped from M03/M04 anchors — inherit clean backdrop automatically).
 *
 * One-shot upload: gs://gstar-ai-studio-assets/backdrops/clean-studio-grey.jpg
 * (source: G-STAR E-COM BG-M01 032526.jpg in the workspace folder).
 *
 * To swap to a different backdrop, just overwrite the GCS object — no code
 * change needed.
 */
const STUDIO_BACKDROP_URL =
  'https://storage.googleapis.com/gstar-ai-studio-assets/backdrops/clean-studio-grey.jpg';

const STUDIO_BACKDROP_LABEL =
  'STUDIO BACKDROP — exact appearance for the seamless backdrop and floor ' +
  'surface in this render. The ENTIRE backdrop and floor must match this ' +
  'reference image — same tone, same texture, same edge-to-edge consistency ' +
  'across the whole frame, including the lower portion where the floor ' +
  'extends out to either side of the model. The reference shows a subtle ' +
  'natural studio lighting falloff (slightly lighter at the top of the ' +
  'frame, slightly cooler at the floor) — that gentle gradient IS correct ' +
  'and should be reproduced. Replace any backdrop, floor texture, scuff ' +
  'marks, harsh gradients, streaks, or surface details visible in the ' +
  'fit-model reference photos with the smooth studio sweep shown in this ' +
  'reference. NOT a source of pose, garment, or model identity — only the ' +
  'studio set.';

/** Bottom (pants) garment info + selected fit model angles + flat for the view.
 *
 * 2026-05-08 BUG FIX: Was `getFocusGarmentUrls` using whichever item the user
 * marked as focus. Symptom (job OxqrvYGwxKa5HedHlz7X): when focus was a TOP
 * (denim jacket), M03/M04/M05/M06 pulled the JACKET's fit-model angles + flat
 * as the "garment" reference. Seedream rendered the jacket fit model + the
 * jacket and made up white pants (or no pants). Fix: always pull from
 * wardrobe.bottom for these visual refs — focus only affects UI highlighting,
 * not Seedream rendering.
 *
 * 2026-05-10 (post-00472): The "always pull bottom" semantics is RIGHT for the
 * BOTTOM half of the outfit signal but it left top-focus jobs with NO visual
 * reference for the focus jacket — only text. Result: jacket hem/back wrong,
 * M04 jacket rendered facing forward. Top refs are now added separately via
 * `getTopGarmentUrls()` at the M03/M04/M06 call sites, conditional on
 * `ctx.focusSlot === 'top'`. This function keeps its bottom-pull semantics;
 * do NOT make it focus-aware.
 */
async function getFocusGarmentUrls(wardrobe: JobWardrobe, view: 'front' | 'back') {
  const bottomConfig = wardrobe['bottom' as keyof JobWardrobe];
  if (!bottomConfig?.itemId) throw new Error('No bottom (pants) item in wardrobe');

  const item = await getWardrobeItem(bottomConfig.itemId) as any;
  if (!item) throw new Error(`Bottom garment not found: ${bottomConfig.itemId}`);

  const normalized = normalizeWardrobeItem(item);
  if (!normalized) throw new Error(`Bottom garment has no fit model images: ${bottomConfig.itemId}`);
  if (!normalized.fitModels?.front) throw new Error(`fitModels.front missing for ${bottomConfig.itemId}`);

  const fitModels: FitModelAngles = normalized.fitModels;

  const angles = view === 'front'
    ? [fitModels.front, fitModels.front45Left, fitModels.front45Right]
    : [fitModels.back, fitModels.back45Left, fitModels.back45Right];

  // Always use flat front — flat back retired. For back shots, the prompt
  // tells Seedream to use flat front only for garment length/silhouette
  // proportions, not for copying front details onto the back.
  const flat = normalized.flatFrontUrl;

  return { angles, flat, item };
}

/** TOP garment info + selected fit model angles + flat for the view.
 *
 * Used ONLY for top-focus jobs (M03/M04/M06 when `ctx.focusSlot === 'top'`).
 * Without this, the focus jacket has no visual reference at all in the
 * Seedream ref array — the May 8 fix pinned `getFocusGarmentUrls` to bottom.
 * `topDescription` text alone is insufficient for hem/back/sleeve fidelity;
 * M04 backs rendered with the jacket's front orientation until back-view
 * visual refs were fed in.
 *
 * Returns null if no top item is in the wardrobe (legacy / outfit-less jobs).
 * Caller should fall back to text-only behavior on null. Defensively returns
 * whatever angles + flat are available — top items don't always have all 6
 * fit-model positions populated.
 */
async function getTopGarmentUrls(wardrobe: JobWardrobe, view: 'front' | 'back') {
  const topConfig = wardrobe['top' as keyof JobWardrobe];
  if (!topConfig?.itemId) return null;

  const item = await getWardrobeItem(topConfig.itemId) as any;
  if (!item) return null;

  const normalized = normalizeWardrobeItem(item);

  // Pull whatever angles exist for the requested view; filter undefined.
  const candidateAngles = view === 'front'
    ? [normalized?.fitModels?.front, normalized?.fitModels?.front45Left, normalized?.fitModels?.front45Right]
    : [normalized?.fitModels?.back, normalized?.fitModels?.back45Left, normalized?.fitModels?.back45Right];
  const angles = candidateAngles.filter((u): u is string => typeof u === 'string' && u.length > 0);

  // Flat preference: view-matched flat first, then opposite view, then any
  // raw imageUrl on the item (fallback for tops that only have a single product shot).
  const flat = view === 'front'
    ? (normalized?.flatFrontUrl || item.flatFrontUrl || normalized?.flatBackUrl || item.flatBackUrl || item.imageUrl || item.thumbnailUrl)
    : (normalized?.flatBackUrl || item.flatBackUrl || normalized?.flatFrontUrl || item.flatFrontUrl || item.imageUrl || item.thumbnailUrl);

  return { flat, angles, item };
}

/** Top + shoes descriptions (for prompt injection).
 * Top: uses Opus-cached `topDescription` field (rich visual description) if available,
 * otherwise lazy-computes it via Claude Opus. Falls back to item name if all else fails.
 * This text replaces the top reference IMAGE for Seedream — prevents crop-top copying. */
async function getStylingDescriptions(wardrobe: JobWardrobe): Promise<{ topDescription: string; shoesDescription: string }> {
  let topDescription = '';
  let shoesDescription = '';

  for (const [slot, config] of Object.entries(wardrobe)) {
    if (!config?.itemId) continue;
    const item = await getWardrobeItem(config.itemId) as any;
    if (!item) continue;
    if (slot === 'top') {
      // Prefer Opus-cached description (rich visual detail)
      if (item.topDescription) {
        topDescription = item.topDescription;
      } else {
        // Lazy-compute: run Opus analysis now, cache for next time
        try {
          const { runTopDescriptionForWardrobe } = await import('@/lib/pipeline/top-description');
          topDescription = await runTopDescriptionForWardrobe(config.itemId);
        } catch (err) {
          console.warn(`[Seedream] Top description analysis failed, falling back to name:`, err);
          topDescription = item.description || item.name || '';
        }
      }
    } else if (slot === 'shoe') {
      shoesDescription = item.description || item.name || '';
    }
  }
  return { topDescription, shoesDescription };
}

/** Styling item reference images — shoes only for Seedream.
 * Top reference image is INTENTIONALLY excluded — Seedream copies crop-top styling
 * from the reference image, overriding tuck instructions. The top is described via
 * text only (Opus-generated {top_description}) in the prompt. */
async function getStylingRefs(wardrobe: JobWardrobe, view: 'front' | 'back', focusSlot?: FocusSlot): Promise<SeedreamReferenceImage[]> {
  // 2026-05-10 RE-INTRODUCED: shoe ref was dropped at 00473-wv6 because label
  // scoping wasn't moving the shoe/body ratio (0.87 → 0.85, within noise). That
  // diagnosis was based on no-op label deploys — Path B (prompt inventory
  // injection) wasn't yet live so the labels never reached Seedream. With Path B
  // delivering the labels, the shoe ref + scoping label is worth re-testing.
  //
  // 2026-05-11 FIX: skipped on top-focus. M03 top-focus = 1+1+4+4 = 10 already,
  // M04 single-pass top-focus = 1+2+4+3 = 10 already — adding the shoe ref
  // pushed both to 11 and caused "Seedream supports max 10 reference images"
  // failures on every jacket-focus shot. Same precedent as the leather/pocket
  // label skip in M04: don't burn a 10-ref budget slot on a non-hero detail
  // when the focus garment refs already fill the budget.
  if (focusSlot === 'top') return [];
  const refs: SeedreamReferenceImage[] = [];
  const shoeConfig = wardrobe['shoe' as keyof JobWardrobe];
  if (shoeConfig?.itemId && !shoeConfig.isFocus) {
    const item = await getWardrobeItem(shoeConfig.itemId) as any;
    if (item) {
      const norm = normalizeWardrobeItem(item);
      const flatUrl = view === 'front'
        ? (norm?.flatFrontUrl || item.flatFrontUrl || norm?.fitModels?.front)
        : (norm?.flatBackUrl || item.flatBackUrl || norm?.flatFrontUrl || item.flatFrontUrl || norm?.fitModels?.back);
      if (flatUrl) {
        refs.push(await refFromUrl(flatUrl, `SHOE REFERENCE (${item.name}) — visual reference for the focus footwear style, color, material, leather finish, sole construction, and silhouette. Use this image for the shoe's appearance and design details only. The product-photography perspective in this reference is not a guide for render scale. Render the shoe at correct anatomical foot proportions for the AI model — a normal adult female shoe footprint, scaled to match the body and stance shown in the model reference.`));
      }
    }
  }
  return refs;
}

// ── Seedream prompt builder ──────────────────────────────────────────
// All styling rules, pose, tuck, and framing instructions now live in the
// vault prompts (pipeline: 'seedream'). No code-side prepend/append.
/** Force sports bra for Seedream 4.5 — the real top is painted on afterward by
 * Gemini tee-edit (seedream-tee-edit.ts). This avoids the body seam artifact
 * that Seedream 4.5 produces when rendering full tops directly.
 *
 * Skipped for M05: the back-pocket close-up doesn't run tee-edit, so a sports-bra
 * placeholder would never get replaced. Letting Seedream render the actual top
 * description directly is safer — even if a seam artifact appears, it sits at
 * the top of a tight back-pocket frame and is mostly out of focus.
 *
 * Skipped for Seedream 5.0+: 5.0 Lite handles tucked-in tops natively without
 * the seam artifact, so we pass the real top description and skip the
 * downstream tee-edit pass entirely (see seedream-tee-edit.ts).
 *
 * Skipped when focusSlot === 'top': the focus garment IS the top (e.g. a
 * denim jacket). Substituting a sports-bra placeholder + later tee-edit would
 * force the focus jacket tucked into the jeans, which contradicts how a
 * jacket is worn. Passing the real Opus description lets Seedream paint the
 * focus garment directly. The downstream tee-edit pass is skipped via
 * needsTeeEdit's matching focusSlot guard.
 */
function rewriteTopForSeedream(opusDescription: string, shotType: ShotType, modelOverride?: string, focusSlot?: FocusSlot): string {
  if (shotType === 'M05') return opusDescription;
  if (isSeedream5(modelOverride)) return opusDescription;
  if (focusSlot === 'top') return opusDescription;
  return 'simple black sports bra';
}

async function buildPrompt(prompt: LoadedPrompt, wardrobe: JobWardrobe, modelId: string, focusItem: any, view: 'front' | 'back', silhouette: { front: string; back: string }, skipSilhouette = false, shotType: ShotType = 'M03', seedreamModelOverride?: string, focusSlot?: FocusSlot): Promise<string> {
  const model = await getModel(modelId) as any;
  const { topDescription, shoesDescription } = await getStylingDescriptions(wardrobe);

  // Rewrite top description for Seedream — sports bra placeholder when 4.5 +
  // not M05 (real top description for M05 always, and for 5.0 always since
  // 5.0 handles tucked-in tops natively without the seam artifact). Also
  // skipped when focus IS the top (jacket-focus jobs) — Seedream paints the
  // focus garment directly instead of via the tee-edit detour.
  const seedreamTopDescription = rewriteTopForSeedream(topDescription, shotType, seedreamModelOverride, focusSlot);
  console.log(`[Seedream] Top description rewrite (${shotType}, model=${seedreamModelOverride || 'default'}, focus=${focusSlot || 'none'}): "${topDescription.slice(0, 80)}..." → "${seedreamTopDescription.slice(0, 80)}${seedreamTopDescription.length > 80 ? '...' : ''}"`);

  let finalPrompt = prompt.generationPrompt;
  if (!skipSilhouette) {
    finalPrompt = injectSilhouette(finalPrompt, (view === 'front' ? silhouette?.front : silhouette?.back) || '');
  }
  finalPrompt = injectStylingDescriptions(finalPrompt, seedreamTopDescription, shoesDescription);
  finalPrompt = injectGender(finalPrompt, model?.gender || 'female');
  finalPrompt = injectGarmentType(finalPrompt, focusItem?.category || 'Pants');

  return finalPrompt;
}

// ── M03 — Full body front ──────────────────────────────────────────────
async function seedreamM03(ctx: SeedreamGenerationContext, prompt: LoadedPrompt): Promise<SeedreamGenerationResult> {
  const { angles: bottomAngles, flat: bottomFlat, item: focusItem } = await getFocusGarmentUrls(ctx.wardrobe, 'front');
  const model = await getModel(ctx.modelId) as any;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;
  if (!modelRefUrl) throw new Error(`Model reference image not found for ${ctx.modelId}`);

  const refs: SeedreamReferenceImage[] = [];
  // Backdrop FIRST — most prominent slot.
  refs.push(await refFromUrl(STUDIO_BACKDROP_URL, STUDIO_BACKDROP_LABEL));
  refs.push(await refFromUrl(modelRefUrl, 'MODEL CARD (FRONT) — canonical, exclusive source of truth for the model\'s identity. Match the model shown in this card identically: every facial feature (eye shape, eye color, nose, mouth, brow shape), the natural facial expression and presence as captured here, skin tone with undertone, freckle pattern, hair color and texture, body proportions. The face and expression in this card are exactly correct — preserve them precisely when the model\'s face is rendered. Lighting on the rendered model is neutral — do not transfer warm key lighting from any other reference. STANCE, FOOT POSITION, HIP TILT, WEIGHT DISTRIBUTION, AND BODY POSE are NOT taken from this card — those come from the FIT MODEL angles. Do not copy the contrapposto, single-leg-weight, or any asymmetric stance shown in this card image.'));

  // 2026-05-13 FIX: head-crop identity anchor. M03 was occasionally drifting
  // to a different model identity (Bruno caught on 90e5Z1nFR1XwS7BZyG6a)
  // because the 3 fit-model angle refs (each with their own face) can
  // outvote the single full-body MODEL CARD (FRONT) ref. Cropping the front
  // card to head+shoulders gives Seedream an extra identity signal at face
  // resolution — same pattern that fixed M06 skin drift today (top-focus
  // 2026-05-12, bottom-focus 2026-05-13). cropAndCacheRef writes to GCS at
  // a content-addressed path so it's a one-time cost per model.
  try {
    const headCropUrl = await cropAndCacheRef(modelRefUrl, 0.0, 0.30);
    refs.push(await refFromUrl(headCropUrl, 'MODEL CARD (FRONT) — HEAD AND SHOULDERS CROP. Identity anchor: face features, hair color/length/texture, skin tone with undertone, freckles. Same person as MODEL CARD (FRONT) full-body ref above — this crop reinforces the identity at face resolution so it can\'t be diluted by the fit-model angles below. STANCE, POSE, GARMENTS are NOT taken from this crop.'));
  } catch (e) {
    console.warn(`[Seedream M03] head-crop identity anchor skipped (non-blocking):`, (e as Error).message);
  }

  if (ctx.focusSlot === 'top') {
    // FOCUS — top garment refs. Without these, Seedream has no visual anchor
    // for the focus jacket and renders the hem / sleeves / closures from
    // text alone (00472 deploy bug — Bruno feedback May 10). Add top refs
    // BEFORE bottom so the focus garment gets primary visual weight.
    // Per Bruno: focus garment must always have flat + all 3 fit-model angles.
    const top = await getTopGarmentUrls(ctx.wardrobe, 'front');
    if (top?.flat) {
      refs.push(await refFromUrl(top.flat, 'FOCUS TOP FLAT (FRONT) — exclusive source of truth for the focus top\'s color, fabric, length, hem position relative to the waist, closure type, sleeves, pockets, and branding details. Render the focus top exactly as shown in this flat — every detail.'));
    }
    const topAnglesToInclude = (top?.angles ?? []).slice(0, 3);
    for (let i = 0; i < topAnglesToInclude.length; i++) {
      refs.push(await refFromUrl(topAnglesToInclude[i], `FOCUS TOP FIT MODEL FRONT ANGLE ${i + 1} — focus garment on a fit model. Use ONLY for the focus top's fit, drape, hem behaviour, sleeve length and how the top sits on the body. SKIN TONE, COMPLEXION, IDENTITY, BACKDROP, FLOOR, and any garments worn below the waist are NOT taken from this image.`));
    }
    // Styling bottom — flat + 2 angles (reduced from 3 on 2026-05-13 to make
    // room for the head-crop identity anchor without overflowing the
    // BytePlus 10-ref limit). Budget now:
    //   1 backdrop + 1 model + 1 head crop + 4 top + 3 bottom = 10. Exactly
    // at the limit. Dropping the 3rd styling-bottom angle is the right
    // trade: the bottom is NOT the focus in top-focus jobs (it's supporting
    // context), so 2 angles + 1 flat is enough for fit/drape/wash reference.
    refs.push(await refFromUrl(bottomFlat, 'STYLING BOTTOM FLAT — the styling bottom (pants/jeans) for color, wash, fabric, fit. Not the focus garment — render accurately in support of the focus top, no extra detail or invented hardware.'));
    const stylingBottomAnglesTopFocus = bottomAngles.slice(0, 2);
    for (let i = 0; i < stylingBottomAnglesTopFocus.length; i++) {
      refs.push(await refFromUrl(stylingBottomAnglesTopFocus[i], `STYLING BOTTOM FIT MODEL FRONT ANGLE ${i + 1} — the styling bottom (pants/jeans) on a fit model for fit, drape, length, wash. SKIN TONE, COMPLEXION, IDENTITY, BACKDROP, KEY-LIGHT COLOR, and the top half of the outfit are NOT taken from this image.`));
    }
  } else {
    // BOTTOM-FOCUS (default) — bottom is the hero, full ref set.
    //
    // 2026-05-13 wash-lock: M03 wash was drifting (Bruno flagged Bowey Barrel
    // jeans 53 j7RnJwgHfCTfEzgTXjpI — actual product is light-medium blue
    // with whiskers, M03 rendered darker / more saturated medium blue).
    // GARMENT FLAT FRONT is the cleanest color reference for the product
    // (no lighting variance from a fit-model photo), so it's the right
    // anchor to lock wash to. We make this label substantive and add wash
    // language to the fit-model angle label so the multi-ref Seedream input
    // doesn't average toward a more saturated wash.
    refs.push(await refFromUrl(bottomFlat, 'GARMENT FLAT FRONT — SOURCE OF TRUTH for the jean wash, color, fade pattern, whiskers, and overall saturation. The jean WASH, COLOR, FADE LINES, WHISKER PATTERN, AND OVERALL SATURATION are LOCKED to this image — match the wash level (light, medium, or dark) and fade character EXACTLY as shown. Do NOT darken, do NOT saturate, do NOT shift toward a richer / deeper blue. Do NOT lighten, do NOT desaturate, do NOT shift toward white or grey. The flat front is the most accurate color reference for this product because it has no skin-tone or studio-light contamination — pull jean color from THIS image first.'));
    for (let i = 0; i < bottomAngles.length; i++) {
      refs.push(await refFromUrl(bottomAngles[i], `Fit Model Front Angle ${i + 1} — primary garment-fit AND STANCE reference. Use this image for: garment shape, fit, hem behavior, stitching, silhouette, AND THE MODEL'S STANCE — match the exact stance shown in THIS fit-model photo. Both legs drop STRAIGHT DOWN vertically from hip to floor (no outward angle from hip to ankle, legs do NOT widen or splay outward at the feet beyond the hip line), feet planted flat on the floor parallel to each other with approximately ONE FOOT-WIDTH of clear space between the inner edges of the two feet — i.e. the gap between the inner side of the left foot and the inner side of the right foot equals roughly the WIDTH (NOT the length) of one shoe (~10cm for an adult — narrow gap, feet near each other but not touching). NOT touching / sole-to-sole. NOT wider than hip-width. NOT crossed. NOT one foot in front of the other, weight 50/50 across both feet, hips centered and level (NO hip tilt, NO contrapposto, NO weight shift onto one leg), arms relaxed at the sides. The jean WASH, COLOR, FADE PATTERN, AND SATURATION shown here are the target — match the wash level seen here without darkening, saturating, lightening, or desaturating; the GARMENT FLAT FRONT above is the primary color anchor and this angle confirms the wash level on a body. SKIN TONE, COMPLEXION, BLUSH, UNDERTONE, KEY-LIGHT COLOR, AND BODY IDENTITY ARE NOT TAKEN FROM THIS IMAGE. The studio key light in this photo has its own particular color rendering — do not transfer it onto the rendered model or fabrics.`));
    }
  }
  refs.push(...(await getStylingRefs(ctx.wardrobe, 'front', ctx.focusSlot)));

  const finalPrompt = await buildPrompt(prompt, ctx.wardrobe, ctx.modelId, focusItem, 'front', ctx.silhouette, false, 'M03', ctx.model, ctx.focusSlot);
  console.log(`[Seedream] M03: ${refs.length} refs (backdrop=slot 0, focus=${ctx.focusSlot || 'none'})`);

  return generateSeedreamImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: (prompt.aspectOverride || APP_CONFIG.shots.M03.aspect) as '9:16' | '3:4' | '1:1',
    apiKey: ctx.apiKey,
    model: ctx.model,
  });
}

// ── M04 — Full body back ───────────────────────────────────────────────
//
// 2026-05-08: Switched to TWO-PASS architecture (see seedream-twopass.ts).
// Pass 1 renders model + sports bra + briefs + shoes (no jeans) as a base.
// Pass 2 paints the jeans with a simple Bruno-locked prompt that gets the
// hem-over-shoes interaction right (jeans cascade past tall boots to floor,
// jeans drape naturally over sneakers — never resting "on top" of shoes).
// The existing Gemini tee-edit step (in route.ts) runs after Pass 2 to paint
// the actual top tucked into the waistband.
//
// M03/M06 keep the original single-pass path below (front-view two-pass had
// inconsistent results in testing 2026-05-07).
async function seedreamM04(ctx: SeedreamGenerationContext, prompt: LoadedPrompt): Promise<SeedreamGenerationResult> {
  // Top-focus jobs (e.g. denim jacket as the hero) bypass the two-pass path.
  // Two-pass is built around painting the bottom as the hero garment (Pass 1
  // = bare-legs base, Pass 2 = paint jeans). When the top is the focus, we
  // need the focus garment painted directly with full ref labels and the
  // jacket-aware buildPrompt() — that's what the single-pass path does. The
  // legacy single-pass also keeps the M04 prompt-vault entry as the source
  // of truth for the back-view shot, which the two-pass dispatcher does not.
  if (ctx.focusSlot === 'top') {
    console.log(`[Seedream] M04: focus=top → routing through single-pass legacy path (skipping two-pass)`);
    return seedreamM04SinglePass(ctx, prompt);
  }

  // Debug tag for Pass 1 intermediate filename — uses the BOTTOM (pants)
  // designNumber so the debug folder reflects the actual garment being
  // rendered (focus-based naming was misleading when focus was a top).
  const bottomConfig = ctx.wardrobe['bottom' as keyof JobWardrobe];
  const bottomItem = bottomConfig?.itemId ? await getWardrobeItem(bottomConfig.itemId) as any : null;
  const debugTag = `${bottomItem?.designNumber || 'unknown'}_${ctx.modelId}_${Date.now()}`;

  const { seedreamM04TwoPass } = await import('./seedream-twopass');
  const out = await seedreamM04TwoPass({
    wardrobe: ctx.wardrobe,
    modelId: ctx.modelId,
    apiKey: ctx.apiKey,
    jobName: 'twopass',
    shotTag: debugTag,
  });
  return { imageData: out.imageData, mimeType: out.mimeType, pass1Url: out.pass1Url };
}

// ── Legacy single-pass M04 kept for reference / fallback ───────────────────
// Not currently called. Restore to seedreamM04 if two-pass needs to be rolled
// back. (Renamed to seedreamM04SinglePass; keep the body intact.)
async function seedreamM04SinglePass(ctx: SeedreamGenerationContext, prompt: LoadedPrompt): Promise<SeedreamGenerationResult> {
  const { angles: bottomAngles, flat: bottomFlat, item: focusItem } = await getFocusGarmentUrls(ctx.wardrobe, 'back');
  const model = await getModel(ctx.modelId) as any;
  const modelRefUrl = model?.referenceImageUrl || model?.cardImageUrl;
  if (!modelRefUrl) throw new Error(`Model reference image not found for ${ctx.modelId}`);
  const backRefUrl = model?.backReferenceImageUrl;

  const refs: SeedreamReferenceImage[] = [];
  // Backdrop FIRST — see comment in seedreamM03 for rationale.
  refs.push(await refFromUrl(STUDIO_BACKDROP_URL, STUDIO_BACKDROP_LABEL));
  if (backRefUrl) {
    refs.push(await refFromUrl(backRefUrl, 'MODEL CARD (BACK) — canonical, exclusive source of truth for the model\'s back-view identity. Match the model shown in this card identically: hair color and texture (back-view detail), skin tone with undertone, freckle pattern, body proportions, presence as captured here. Render the back of the model exactly as shown in this card. Lighting on the rendered model is neutral — do not transfer warm key lighting from any other reference. STANCE, FOOT POSITION, HIP TILT, WEIGHT DISTRIBUTION, AND BODY POSE are NOT taken from this card — those come from the FIT MODEL back angles. Do not copy any asymmetric or contrapposto stance shown in this card image.'));
    refs.push(await refFromUrl(modelRefUrl, 'MODEL CARD (FRONT) — canonical, exclusive source of truth for the model\'s identity. Match the model shown in this card identically: every facial feature (eye shape, eye color, nose, mouth, brow shape), the natural facial expression and presence as captured here, skin tone with undertone, freckle pattern, hair color and texture, body proportions. The face and expression in this card are exactly correct — preserve them precisely when the model\'s face is rendered. Lighting on the rendered model is neutral — do not transfer warm key lighting from any other reference. STANCE, FOOT POSITION, HIP TILT, WEIGHT DISTRIBUTION, AND BODY POSE are NOT taken from this card — those come from the FIT MODEL angles. Do not copy the contrapposto, single-leg-weight, or any asymmetric stance shown in this card image.'));
  } else {
    refs.push(await refFromUrl(modelRefUrl, 'MODEL CARD (FRONT) — canonical, exclusive source of truth for the model\'s identity. Match the model shown in this card identically: every facial feature (eye shape, eye color, nose, mouth, brow shape), the natural facial expression and presence as captured here, skin tone with undertone, freckle pattern, hair color and texture, body proportions. The face and expression in this card are exactly correct — preserve them precisely when the model\'s face is rendered. Lighting on the rendered model is neutral — do not transfer warm key lighting from any other reference. STANCE, FOOT POSITION, HIP TILT, WEIGHT DISTRIBUTION, AND BODY POSE are NOT taken from this card — those come from the FIT MODEL angles. Do not copy the contrapposto, single-leg-weight, or any asymmetric stance shown in this card image.'));
  }

  if (ctx.focusSlot === 'top') {
    // FOCUS — top garment back-view refs. Without these, Seedream has no
    // back-view visual anchor for the focus jacket and renders the front of
    // the jacket facing the camera (00472 bug — Bruno feedback May 10).
    // Per Bruno: focus garment must always have flat + all 3 fit-model angles.
    const top = await getTopGarmentUrls(ctx.wardrobe, 'back');
    if (top?.flat) {
      refs.push(await refFromUrl(top.flat, 'FOCUS TOP FLAT (BACK) — exclusive source of truth for the focus top\'s back-panel construction: back fabric, seam lines, yoke (if any), back-panel pockets, hood/collar back, branding label position, and hem position relative to the waist. Render the back of the focus top exactly as shown — every detail. Use the front-flat fallback only as a colour reference if a true back flat is not in the ref set.'));
    }
    const topAnglesToInclude = (top?.angles ?? []).slice(0, 3);
    for (let i = 0; i < topAnglesToInclude.length; i++) {
      refs.push(await refFromUrl(topAnglesToInclude[i], `FOCUS TOP FIT MODEL BACK ANGLE ${i + 1} — focus garment on a fit model from the back. Use ONLY for the focus top's back-side fit, drape, hem behaviour, sleeve back, how the top sits over the back of the body. SKIN TONE, COMPLEXION, IDENTITY, BACKDROP, FLOOR, and any garments worn below the waist are NOT taken from this image.`));
    }
    // Styling bottom — flat + 2 angles (drop 1 back angle to fit budget).
    // M04 budget: 1 backdrop + 2 models + 4 top + 3 bottom + 0 leather = 10.
    // Bruno: keep all 3 focus angles + flat; bottom takes the trim.
    refs.push(await refFromUrl(bottomFlat, 'STYLING BOTTOM FLAT — the styling bottom (pants/jeans) for color, wash, fabric, fit. Not the focus garment — render accurately in support of the focus top, no extra detail or invented hardware.'));
    const bottomAnglesToInclude = bottomAngles.slice(0, 2);
    for (let i = 0; i < bottomAnglesToInclude.length; i++) {
      refs.push(await refFromUrl(bottomAnglesToInclude[i], `STYLING BOTTOM FIT MODEL BACK ANGLE ${i + 1} — the styling bottom (pants/jeans) on a fit model from behind for fit, drape, length, hem-to-shoes interaction. SKIN TONE, COMPLEXION, IDENTITY, BACKDROP, KEY-LIGHT COLOR, and the top half of the outfit are NOT taken from this image.`));
    }
  } else {
    // BOTTOM-FOCUS (default) — bottom is the hero, full ref set.
    refs.push(await refFromUrl(bottomFlat, 'Garment Flat Back'));
    for (let i = 0; i < bottomAngles.length; i++) {
      refs.push(await refFromUrl(bottomAngles[i], `Fit Model Back Angle ${i + 1} — primary garment-fit AND STANCE reference. Use this image for: garment shape, fit, hem behavior, stitching, silhouette, AND THE MODEL'S STANCE — match the exact stance shown in THIS fit-model photo (back view). Both legs drop STRAIGHT DOWN vertically from hip to floor (no outward angle from hip to ankle, legs do NOT widen or splay outward at the feet beyond the hip line), feet planted flat on the floor parallel to each other with approximately ONE FOOT-WIDTH of clear space between the inner edges of the two feet — i.e. the gap between the inner side of the left foot and the inner side of the right foot equals roughly the WIDTH (NOT the length) of one shoe (~10cm for an adult — narrow gap, feet near each other but not touching). NOT touching / sole-to-sole. NOT wider than hip-width. NOT crossed. NOT one foot in front of the other, weight 50/50 across both feet, hips centered and level (NO hip tilt, NO contrapposto, NO weight shift onto one leg), arms relaxed at the sides. SKIN TONE, COMPLEXION, BLUSH, UNDERTONE, KEY-LIGHT COLOR, AND BODY IDENTITY ARE NOT TAKEN FROM THIS IMAGE. The studio key light in this photo has its own particular color rendering — do not transfer it onto the rendered model or fabrics.`));
    }
  }
  // M04 rev 28.1: shoes ref restored. Rev 26 had removed it because that prompt
  // said "shoes hidden behind cascading hem" and the visual ref pulled Seedream
  // toward visible-shoes (shelf-on-shoe). Rev 28.1 drops the anti-shoes prompt
  // language and defers footwear behavior to the per-garment {silhouette} —
  // the visual ref is now consistent with the prompt's "matching the shoes
  // reference imagery exactly" instruction and helps Seedream render the
  // wardrobe's specific shoe shape and color faithfully.
  refs.push(...(await getStylingRefs(ctx.wardrobe, 'back', ctx.focusSlot)));

  // Inject leather + pocket label images as additional Seedance references
  // via the labelAssets template library (alpha-masked PNGs in GCS). Falls
  // back to legacy leatherLabelImageUrl when no template is set. Same
  // pattern as M05 — visual refs make Seedance render the actual label
  // appearance (shape, embossed lettering, color) accurately rather than
  // letting it invent from text alone. M02 inherits this fidelity because
  // it's a waist-line crop of M04.
  //
  // Skipped on top-focus: the leather brand patch is on the JEANS waistband,
  // which is supporting context for a jacket-focus shot. Including the label
  // ref would burn a 10-ref budget slot on a non-hero detail (when we already
  // dropped 2 bottom angles to make room for top refs). Pocket-label warp
  // tool still runs post-generation regardless of focus.
  const labelUrls = await resolveLabelAssetUrls(focusItem);
  if (labelUrls.leatherUrl && ctx.focusSlot !== 'top') {
    refs.push(await refFromUrl(labelUrls.leatherUrl, 'LEATHER BRAND PATCH — exact appearance of the leather brand patch (shape, embossed lettering, leather grain, color, stitching). Position, size, and orientation follow the garment description / silhouette — DO NOT assume a fixed location.'));
  }
  // Pocket label intentionally NOT added as a Seedream ref. Per-Bruno
  // architecture (Apr 30, 2026): pocket labels go through the warp tool
  // (POST /api/shots/[id]/apply-pocket-label) post-generation, never via
  // Seedance. Reasons: deterministic placement, no hallucinated label
  // positions on garments without back-pocket geometry. The
  // pocketLabelTemplateId on the wardrobe item is read by the warp tool only.

  const finalPrompt = await buildPrompt(prompt, ctx.wardrobe, ctx.modelId, focusItem, 'back', ctx.silhouette, false, 'M04', ctx.model, ctx.focusSlot);
  const labelTags: string[] = [];
  if (labelUrls.leatherUrl) labelTags.push('leather');
  if (labelUrls.pocketUrl) labelTags.push('pocket');
  console.log(`[Seedream] M04 (single-pass): ${refs.length} refs${labelTags.length ? ` (incl. ${labelTags.join('+')} label)` : ''} focus=${ctx.focusSlot || 'none'}`);

  return generateSeedreamImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: (prompt.aspectOverride || APP_CONFIG.shots.M04.aspect) as '9:16' | '3:4' | '1:1',
    apiKey: ctx.apiKey,
    model: ctx.model,
  });
}

// ── M01 — Cropped front (focus-conditional crop of M03) ────────────────
// Bottom-focus (jeans / pants): waist-line crop — head removed, full torso
// + legs + feet visible, pants as the hero. (Per G-Star vault brief slide 2.)
//
// Top-focus (jacket / shirt): upper-body crop — head + torso + thighs to
// roughly mid-femur visible, jacket as the hero. The waist-line crop would
// frame out most of the focus garment.
//
// In both cases we crop from the already-finalized M03 anchor (model identity
// + correct outfit). Same pixels = guaranteed consistency with M03. No
// second Seedream gen.
async function seedreamM01(ctx: SeedreamGenerationContext, _prompt: LoadedPrompt): Promise<SeedreamGenerationResult> {
  if (!ctx.m03AnchorUrl) throw new Error('M01 requires M03 anchor — run M03 first');
  const { cropFromFullBody } = await import('./elbow-crop');
  const mode = ctx.focusSlot === 'top' ? 'upper-body' : 'waist';
  console.log(`[Seedream] M01: ${mode} crop of M03 anchor (focus=${ctx.focusSlot || 'none'})`);
  const cropped = await cropFromFullBody(ctx.m03AnchorUrl, mode);
  return { imageData: cropped.imageData, mimeType: cropped.mimeType };
}

// ── M02 — Cropped back (focus-conditional crop of M04) ─────────────────
// Mirror of M01.
async function seedreamM02(ctx: SeedreamGenerationContext, _prompt: LoadedPrompt): Promise<SeedreamGenerationResult> {
  if (!ctx.m04AnchorUrl) throw new Error('M02 requires M04 anchor — run M04 first');
  const { cropFromFullBody } = await import('./elbow-crop');
  const mode = ctx.focusSlot === 'top' ? 'upper-body' : 'waist';
  console.log(`[Seedream] M02: ${mode} crop of M04 anchor (focus=${ctx.focusSlot || 'none'})`);
  const cropped = await cropFromFullBody(ctx.m04AnchorUrl, mode);
  return { imageData: cropped.imageData, mimeType: cropped.mimeType };
}

// ── M05 — Back pocket detail ───────────────────────────────────────────
// Per Bruno: the fit model's left hip/pocket is the best reference for the
// pocket close-up — AI anchors add noise. Originally stripped to 2 refs
// (fit model back + back45Right), but that meant Seedance had no source for
// the AI model's skin tone, so M05 was rendering with the FIT model's skin
// (typically white) on jobs that selected a non-white AI model.
//
// Fix: prepend the AI model's BACK reference image when available. Adds one
// ref (3 → 4 base refs, plus 0–2 label refs). Front model ref is still
// excluded — that's the noisy one for back-pocket framing.
//
// ROLLBACK: set Cloud Run env var M05_MODEL_BACK_REF=false (no redeploy
// needed — picks up on next request). Default behavior is ON.
async function seedreamM05(ctx: SeedreamGenerationContext, prompt: LoadedPrompt): Promise<SeedreamGenerationResult> {
  const isTopFocus = ctx.focusSlot === 'top';

  // ─────────────────────────── TOP-FOCUS M05 ───────────────────────────
  // 2026-05-11: when focus = top, M05 becomes a shoulder close-up showcasing
  // the top garment's construction (collar, sleeve cap, yoke). Random pick
  // among 3 camera angles (A side-profile / B rear-side over-shoulder /
  // C front-side) per render for visual variety across the deliverable set.
  if (isTopFocus) {
    const topConfig = ctx.wardrobe['top' as keyof JobWardrobe];
    if (!topConfig?.itemId) throw new Error('M05 top-focus: no top in wardrobe');
    const topItem = await getWardrobeItem(topConfig.itemId) as any;
    if (!topItem) throw new Error(`M05 top-focus: top item not found: ${topConfig.itemId}`);
    const topNorm = normalizeWardrobeItem(topItem);

    // Variant selection: explicit override from ctx (set by /rerun-with-m05-variant
    // endpoint when user picks from the dashboard menu) wins over random pick.
    const variant = ctx.m05TopVariantId
      ? { id: ctx.m05TopVariantId, ...TOP_VARIANTS[ctx.m05TopVariantId] }
      : pickTopVariant();
    console.log(`[Seedream] M05 top-focus variant=${variant.id} (${variant.name})${ctx.m05TopVariantId ? ' [OVERRIDE]' : ' [random]'}`);

    const refs: SeedreamReferenceImage[] = [];

    // Model card FRONT — for top-focus shots that include the side/front of
    // the face, the front card is the better identity anchor than back card.
    const model = await getModel(ctx.modelId) as any;
    const modelFrontUrl = model?.referenceImageUrl || model?.cardImageUrl;
    if (modelFrontUrl) {
      refs.push(await refFromUrl(modelFrontUrl, 'MODEL CARD (FRONT) — exclusive identity source: skin tone, hair color/texture, facial features (face partially visible at shoulder crop). CAMERA ANGLE, POSE, FRAMING for THIS shot are NOT taken from this card.'));
    }

    // Top flat front + flat back — primary garment authority
    const flatFront = topNorm?.flatFrontUrl || topItem.flatFrontUrl;
    const flatBack = topNorm?.flatBackUrl || topItem.flatBackUrl;
    if (flatFront) refs.push(await refFromUrl(flatFront, 'TOP FLAT FRONT — exclusive source for the top garment: color, fabric, hardware, closure (buttons/zipper), front neckline / collar, sleeves at shoulder cap.'));
    if (flatBack) refs.push(await refFromUrl(flatBack, 'TOP FLAT BACK — back-panel construction: yoke seam, back-shoulder seam, any back labels (DO NOT render brand labels; composited post-gen).'));

    // Top fit-model angles — fit, drape, shoulder fit, sleeve cap on a body
    const tfm = topNorm?.fitModels || {};
    const angleOrder = ['front', 'front45Right', 'front45Left', 'back45Right', 'back45Left'];
    for (const key of angleOrder) {
      const url = (tfm as any)[key];
      if (url && refs.length < 9) {
        refs.push(await refFromUrl(url, `FIT MODEL ${key.toUpperCase()} (TOP) — top garment on a fit model. Use ONLY for the top's fit, drape, shoulder fit, sleeve cap. SKIN TONE, IDENTITY, BACKDROP, POSE are NOT taken from this image — identity from MODEL CARD FRONT.`));
      }
    }

    // Build prompt: feed variant.prompt through buildPrompt for {garment_type}
    // / {top_description} / {silhouette} substitution. focusSlot='top' is
    // already on ctx so buildPrompt's top-focus branches activate.
    const finalPrompt = await buildPrompt(
      { ...prompt, generationPrompt: variant.prompt },
      ctx.wardrobe, ctx.modelId, topItem, 'front', ctx.silhouette, false, 'M05', ctx.model, ctx.focusSlot,
    );

    console.log(`[Seedream] M05 top-focus: ${refs.length} refs, variant=${variant.id}`);
    return generateSeedreamImage({
      prompt: finalPrompt,
      referenceImages: refs,
      aspectRatio: (prompt.aspectOverride || APP_CONFIG.shots.M05.aspect) as '9:16' | '3:4' | '1:1',
      apiKey: ctx.apiKey,
      model: ctx.model,
    });
  }

  // ────────────────────── BOTTOM-FOCUS M05 (default) ──────────────────────
  // Single prompt (rev 33 in promptVault — upper-thigh camera, modest tilt,
  // right back pocket as hero with 3/4 rear rotation). Per Bruno 2026-05-11:
  // bottom-focus M05 stays as ONE canonical shot, no random variants.
  //
  // 2026-05-08 BUG FIX: was using `find(isFocus)` which broke when focus was
  // a non-pants item (job OxqrvYGwxKa5HedHlz7X — focus was a denim jacket).
  // M05 bottom-focus uses wardrobe.bottom always.
  const bottomConfig = ctx.wardrobe['bottom' as keyof JobWardrobe];
  if (!bottomConfig?.itemId) throw new Error('M05: no bottom (pants) in wardrobe');
  const item = await getWardrobeItem(bottomConfig.itemId) as any;
  if (!item) throw new Error(`M05: bottom garment not found: ${bottomConfig.itemId}`);
  const normalized = normalizeWardrobeItem(item);
  const fitModels = normalized?.fitModels;
  if (!fitModels?.back || !fitModels?.back45Right) {
    throw new Error('M05 Seedream requires fitModels.back + fitModels.back45Right on the bottom item');
  }

  const includeModelBackRefFlag = process.env.M05_MODEL_BACK_REF !== 'false';
  let modelBackRefAdded = false;
  const refs: SeedreamReferenceImage[] = [];

  if (includeModelBackRefFlag) {
    const model = await getModel(ctx.modelId) as any;
    const modelBackRefUrl = model?.backReferenceImageUrl;
    if (modelBackRefUrl) {
      // Track A: crop model card BACK to TOP 30% (head/shoulders) to avoid
      // copying the model card's compression-shorts styling into the lower body.
      const cropped = await cropAndCacheRef(modelBackRefUrl, 0.05, 0.30);
      refs.push(await refFromUrl(cropped, 'MODEL CARD BACK — HEAD AND SHOULDERS CROP. Source of truth for skin tone with undertone, hair color (back-view), and body proportions reference. CAMERA ANGLE, POSE, FRAMING for THIS shot are NOT taken from this card.'));
      modelBackRefAdded = true;
    }
  }

  // Track A: crop fit-model BACK 45° to vertical 25-60% (hip/buttock zone).
  const fitBack45RCropped = await cropAndCacheRef(fitModels.back45Right, 0.25, 0.60);
  refs.push(await refFromUrl(fitBack45RCropped, 'FIT MODEL BACK 45° RIGHT — HIP / BACK-POCKET CROP. Primary garment-fit reference for back-hip pocket geometry, stitching, pocket construction. The rendered M05 frame should match this crop\'s tight framing. SKIN TONE, COMPLEXION, IDENTITY, BACKDROP are NOT taken from this image.'));

  if (item.flatBackUrl) {
    refs.push(await refFromUrl(item.flatBackUrl, 'FLAT BACK — clean back-view product shot of the garment (no model). Source of truth for the garment\'s back-panel construction: fabric color, wash, seam lines, pocket construction.'));
  }

  // labelAssets resolved but NOT pushed as refs — M05 brand labels are
  // composited post-gen via warp tool. The resolve call may have side effects
  // downstream (label-resolver caches), keep it.
  const labelUrls = await resolveLabelAssetUrls(item);

  // Build prompt — use the loaded promptVault prompt (rev 33) as-is.
  let finalPrompt = await buildPrompt(
    prompt,
    ctx.wardrobe, ctx.modelId, item, 'back', ctx.silhouette, false, 'M05', ctx.model, ctx.focusSlot,
  );

  // 2026-05-13 FIX: append a no-bare-skin guard. The vault prompt says "a
  // thin slice of the tucked top is visible … no more than 10-15%" — that's
  // permissive (upper bound), not mandatory. When Seedream drifts, it goes
  // to 0% and renders bare back / nude upper torso (Bruno caught on
  // j7RnJwgHfCTfEzgTXjpI, intermittent).
  //
  // Important: this guard does NOT change framing, crop, camera, or pocket
  // hero proportions — those stay as defined by the vault prompt (back-right
  // pocket 40-50% of frame, upper-thigh bottom edge, upper body / shoulders
  // / head out of frame). The ONLY change is what fills the small space
  // above the waistband at the top edge: it must be the tucked-top's fabric
  // hem (same thin sliver the vault already allows), NEVER bare skin.
  finalPrompt += `

═══ MANDATORY — NO BARE SKIN ABOVE THE WAISTBAND ═══
This guard does NOT change the framing, crop, camera position, or pocket-hero proportions described above — those stay exactly as specified. The hero is still the back-right pocket; the bottom of frame is still upper-to-mid-thigh; upper body / shoulders / head are still out of frame. The ONLY thing this section locks down is what's rendered in the small region above the waistband at the top edge of the frame.

In that region, the visible content MUST be the fabric hem of the tucked-in top — same thin sliver the framing already allows — NOT bare skin. The model is wearing a tucked-in top throughout this shot; treat the top as long enough to reach below the waistband and be tucked in, so the only thing visible above the waistband (within the existing crop) is the top's fabric.

DO NOT zoom out, reframe, or include more of the top to satisfy this — keep the same tight crop. Just ensure the small slice above the waistband is fabric, not skin.

FAILURE MODES — ABSOLUTELY WRONG:
- bare back, bare upper torso, bare shoulders, or any nudity in the small region above the waistband.
- the model rendered topless or without any garment above the waistband.
- bare skin visible at the top of the frame instead of the tucked top's fabric.
- a gap of bare skin between the top's hem and the waistband.
- zooming out or reframing to fit more of the top — keep the same crop, just swap skin for fabric in the same region.`;

  const tagSegments: string[] = [];
  if (modelBackRefAdded) tagSegments.push('+MODEL_BACK');
  else if (!includeModelBackRefFlag) tagSegments.push('+MODEL_BACK_DISABLED');
  console.log(`[Seedream] M05 bottom-focus: ${refs.length} refs, prompt rev=${prompt.revision}${tagSegments.length ? ' ' + tagSegments.join(' ') : ''}`);

  return generateSeedreamImage({
    prompt: finalPrompt,
    referenceImages: refs,
    aspectRatio: (prompt.aspectOverride || APP_CONFIG.shots.M05.aspect) as '9:16' | '3:4' | '1:1',
    apiKey: ctx.apiKey,
    model: ctx.model,
  });
}

// ── M06 — Editorial pose generation via GEMINI-3-pro-image-preview ──────
// 2026-05-10: M06 was migrated OFF Seedream and onto Gemini-3-pro-image-preview.
// Seedream consistently failed pose-following for M06's editorial archetypes
// (4/11 pass rate after 4 prompt iterations + visual pose refs). Gemini
// reliably reproduces the team-PDF pose vocabulary (11/11 acceptable).
// Garment fit on the editorial wide shot is acceptable from Gemini — pocket
// stitching detail isn't visible at full-body scale, so Seedream's per-stitch
// strength isn't needed for M06 specifically.
//
// Function name kept for dispatcher compatibility (generateSeedreamShot
// still routes M06 here). Implementation lives in src/lib/pipeline/gemini-m06.ts
// — uses the canonical pose library (src/lib/m06-poses.ts) and respects each
// pose's `skipPoseRefImage` flag for stubborn rotation overrides (p04, p06).
async function seedreamM06(ctx: SeedreamGenerationContext, _prompt: LoadedPrompt): Promise<SeedreamGenerationResult> {
  const { generateM06WithGemini } = await import('./gemini-m06');
  const result = await generateM06WithGemini({
    wardrobe: ctx.wardrobe,
    modelId: ctx.modelId,
    m06PoseId: ctx.m06PoseId,
    // 2026-05-12: forward focusSlot + top-pose override so gemini-m06.ts can
    // branch to the top-focus path (t01-t05 vocabulary, top-as-hero refs,
    // identity-bleed-resistant ref structure).
    focusSlot: ctx.focusSlot,
    m06TopPoseId: ctx.m06TopPoseId,
  });
  return { imageData: result.imageData, mimeType: result.mimeType };
}

export async function generateSeedreamShot(
  shotType: ShotType,
  ctx: SeedreamGenerationContext,
  prompt: LoadedPrompt,
): Promise<SeedreamGenerationResult> {
  switch (shotType) {
    case 'M03': return seedreamM03(ctx, prompt);
    case 'M04': return seedreamM04(ctx, prompt);
    case 'M01': return seedreamM01(ctx, prompt);
    case 'M02': return seedreamM02(ctx, prompt);
    case 'M05': return seedreamM05(ctx, prompt);
    case 'M06': return seedreamM06(ctx, prompt);
    default: throw new Error(`Unknown shot type for Seedream: ${shotType}`);
  }
}
