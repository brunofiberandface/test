// ── Core Types — v2 Pro Pipeline ──

export type UserRole = 'admin' | 'creator';

export interface User {
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: Date;
  lastLogin: Date;
  trustedBrowsers: string[];
  active: boolean;
}

// ── Garment Categories ──

export type GarmentCategory =
  | 'pants'
  | 'jackets'
  | 'tops'
  | 'knitwear'
  | 'dresses'
  | 'accessories';

export interface GarmentMetadata {
  category: GarmentCategory;
  waistHeight?: 'high' | 'medium' | 'low';
  floorDistance?: 0 | 1 | 2 | 3 | 4;
  fitDescription?: string;
  customFields?: Record<string, string>;
}

// ── Celebrity Check Audit ──

export interface CelebrityCheckAudit {
  timestamp: Date;
  status: 'pass' | 'review' | 'blocked' | 'error';
  facesDetected?: number;
  topMatch: string | null;
  topScore: number;
  flaggedMatches?: Array<{ name: string; score: number }>;
  modelVersion: string;
  databaseVersion: string;
  thresholds: { review: number; block: number };
  durationMs?: number;
  note?: string;
  error?: string;
}

// ── AI Models (simplified — 1 reference photo) ──

export type ModelGender = 'male' | 'female';

export interface AIModel {
  modelId: string;
  name: string;
  description: string;
  referenceImageUrl: string;      // Front 4K reference photo
  backReferenceImageUrl?: string; // Back view reference photo (auto-generated from front)
  gender: ModelGender;
  active: boolean;
  createdBy: string;
  createdAt: Date;
  celebrityCheck?: CelebrityCheckAudit;
}

// ── Jobs (v2: 3 wardrobe items + focus) ──

export type JobStatus =
  | 'pending'
  | 'generating'
  | 'review'
  | 'complete'
  | 'failed'
  // Set on job create when at least one (model × shoe) Tier-2 cell is missing.
  // process-queue checks the pending batch, flips to 'generating' once the
  // cell lands. Added 2026-05-17 with the matrix-based new-job pipeline.
  | 'awaiting-matrix';

/** Which image-generation backend to use. Defaults to 'gemini' everywhere absent. */
export type GenerationProvider = 'gemini' | 'seedream';

export interface JobWardrobe {
  shoe: { itemId: string; isFocus: boolean };
  top: { itemId: string; isFocus: boolean };
  bottom: { itemId: string; isFocus: boolean };
}

/**
 * Slot name of the focus garment in a job's wardrobe. Derived from
 * `Object.entries(wardrobe).find(([, v]) => v?.isFocus)?.[0]`.
 *
 * Used to branch generation logic when the focus is a top vs a bottom — e.g.
 * skip the Gemini tee-edit pass + let Seedream paint the real focus jacket
 * directly + crop M01/M02 upper-body when focus = 'top'.
 */
export type FocusSlot = 'top' | 'bottom' | 'shoe';

/**
 * Resolve the focus slot from a wardrobe (returns null if no slot is marked
 * isFocus — legacy jobs without explicit focus selection).
 */
export function getFocusSlot(wardrobe: JobWardrobe | undefined | null): FocusSlot | null {
  if (!wardrobe) return null;
  const entry = Object.entries(wardrobe).find(([, v]) => (v as { isFocus?: boolean })?.isFocus);
  return (entry?.[0] ?? null) as FocusSlot | null;
}

export interface Job {
  jobId: string;
  jobName: string;
  creatorEmail: string;
  status: JobStatus;

  // v2: structured wardrobe selection
  wardrobe: JobWardrobe;
  modelId: string;

  // Focus garment fields — parsed from the focus wardrobe item's name
  // ("D24461-D559-A587 KATE BOYFRIEND WMN" → designNumber="D24461-D559-A587",
  // designName="KATE BOYFRIEND WMN"). Persisted on the Job doc at creation
  // time (2026-05-26) so:
  //   1. /api/generate can build brand-spec deliverable filenames
  //      ({designNumber}-M01.jpg etc.) without re-fetching the wardrobe item
  //   2. Cross-job queries can group jobs by design number for the design-
  //      completion detection (multiple jobs may produce different shots of
  //      the same garment; the design is "complete" when all 4 shot types
  //      are approved across them).
  // Older jobs (pre-2026-05-26) have these absent — the legacy enrichment in
  // /api/jobs GET re-parses them on listing for backward compatibility.
  focusDesignNumber?: string;
  focusDesignName?: string;
  focusCategory?: string;

  // Prompt versions used (for reproducibility). Partial because matrix-paint
  // shots (M01/M02) don't use the vault prompt system, and legacy jobs may
  // have any subset of M01-M05 depending on when they were created.
  promptRevisions: Partial<Record<ShotType, number>>;

  // Cached silhouette analysis results
  silhouetteAnalysis?: {
    front: string;
    back: string;
  };

  // M03 (Full Body / Functionality) pose selection — id from src/lib/m03-poses.ts
  // (e.g. 'p07'). Optional for backward compat: jobs created before the pose
  // picker shipped have this field absent → falls back to M03_DEFAULT_POSE_ID.
  // Renamed 2026-05-26 from m06PoseId (M06 was renamed platform-wide to M03
  // "Full Body / Functionality"). Migration script copies m06PoseId values
  // into m03PoseId; the legacy field is kept readable for back-compat.
  m03PoseId?: string;
  /** @deprecated Use m03PoseId. Kept for back-compat reads of pre-rename jobs. */
  m06PoseId?: string;
  /**
   * M01/M02 top-focus pose id — from src/lib/m03-top-poses.ts. Gender-specific:
   *   female top-focus → f01-f07 (WOMEN M01-M02 TOPS)
   *   male            → m01-m11 (MEN POSES; Bruno: "for man, this is the M01 pose")
   * Selected at job creation (new-job step 4) and persisted on the Job doc.
   * Consumed by the top-focus M01/M02 paint pass; absent = random pick per
   * gender at generation time (back-compat with pre-2026-05-26 jobs).
   */
  m03TopPoseId?: string;

  // Set on the job doc when status='awaiting-matrix'. Tracks which Tier-2
  // (shoe × model) cell the job is parked behind. Worker tick polls this:
  // when the cell becomes complete, the job flips to 'generating' and is
  // enqueued for normal processing. Field is cleared on resume. (Stage 4
  // missing-cell async flow, 2026-05-17.)
  awaitingCell?: {
    shoeId: string;
    modelId: string;
    /** Gemini batch resource name (e.g. "batches/abc123"), if a batch was
     *  submitted on behalf of this job. Absent when the job piggybacks on
     *  an already-in-flight batch submitted for a different job. */
    batchName?: string;
    /** When the job was first parked (ms since epoch) — used for stuck-job
     *  watchdog + UX (show "waiting for matrix render…" with elapsed time). */
    parkedAt?: number;
  };

  // M02 anchor URL — primary visual anchor for M05 (back-pocket close-up).
  // Set by /api/generate after a successful M02 matrix-paint. M05 reads this
  // off the job doc so seedreamM05 can inject the painted-back view as its
  // dominant ref. Replaces the M03/M04 anchor pattern (retired 2026-05-17).
  m02AnchorUrl?: string;

  // Legacy anchor URLs from the M03/M04 era — kept for backward-compat reads
  // of pre-2026-05-17 job docs. Not written by the current pipeline.
  m03AnchorUrl?: string;
  m04AnchorUrl?: string;
  m03WhiteAnchorUrl?: string;
  m04WhiteAnchorUrl?: string;

  // Image-generation backend for this job. Absent = 'gemini' (production default).
  provider?: GenerationProvider;

  createdAt: Date;
  updatedAt: Date;
}

// ── Shots ──

/**
 * Active shot types in the current pipeline (2026-05-26 onward).
 *   M01 — Cropped Front
 *   M02 — Cropped Back
 *   M03 — Full Body / Functionality (formerly M06; renamed platform-wide 2026-05-26)
 *   M05 — Pocket Detail
 *
 * Legacy types kept in the union so old shot docs and old jobs continue to
 * read without TS errors. They are NOT generated by the worker.
 *   M03_legacy — old "Full Body Front" (retired 2026-05-17)
 *   M04_legacy — old "Full Body Back" (retired 2026-05-17)
 *   M06_legacy — pre-rename name of current M03; held briefly during migration
 */
export type ActiveShotType = 'M01' | 'M02' | 'M03' | 'M05';
export type LegacyShotType = 'M03_legacy' | 'M04_legacy' | 'M06_legacy';
export type ShotType = ActiveShotType | LegacyShotType;
export type ShotStatus = 'pending' | 'queued' | 'generating' | 'done' | 'approved' | 'rejected' | 'failed';

export interface Shot {
  shotId: string;
  jobId: string;
  modelId: string;
  shotType: ShotType;
  version: number;
  status: ShotStatus;
  imageUrl?: string;
  prompt: string;
  promptRevision: number;  // which .md version was used
  alternativePromptId?: string;  // if set, this alternative prompt was used instead of base
  alternativePromptLabel?: string;  // label for display, e.g. "Color Fidelity"
  createdAt: Date;
  updatedAt?: Date;
  // Progress tracking
  progressStep?: string;
  progressPct?: number;
  // Version history
  previousVersions?: Array<{
    imageUrl: string;
    version: number;
    createdAt: Date;
    provider?: GenerationProvider;
  }>;
  // Per-shot provider override for one-shot reruns (e.g. "Rerun with Seedream").
  // If set, takes precedence over job.provider. Absent = use job.provider (or 'gemini').
  provider?: GenerationProvider;
  // True iff this shot was previously approved (status='approved') before
  // being reset for a rerun. UI shows a "Pre-approved — Re-approve" badge so
  // the reviewer knows the prior version was approved and can quickly re-bless
  // the new version. Cleared on next approval. (2026-05-17 with the batch-
  // rerun-last-50 backfill so approval state survives reruns.)
  wasApproved?: boolean;
  // 2026-05-27 (Phase 1 of dashboard redesign): when true, this shot's CURRENT
  // version (imageUrl) is the picked "winner" — the reviewer's chosen take
  // among all iterations of this shot type for this job. Used by the new /v2
  // views (chronological feed, tile modal, job detail) to render a ★ chip.
  // Toggle via POST /api/shots/[id]/winner. Independent of `status` —
  // a shot can be both 'approved' (legacy) and isWinner=true (new).
  isWinner?: boolean;
  // Backdrop variants (subject-matte pipeline). Set when /api/generate ran the
  // rembg matte + composite step successfully. greyMasterUrl mirrors imageUrl
  // for explicit consumption; whiteMasterUrl is the pure-white-bg deliverable.
  // Absent on shots generated before the matte pipeline shipped, and on shots
  // where matting failed at runtime.
  whiteMasterUrl?: string;
  greyMasterUrl?: string;
  // Brand-spec deliverable URLs (2026-05-26 — added wholesaleUrl).
  //   pdpUrl       — 4000×4000 square JPEG, sRGB, 300 DPI, brand-grey backdrop
  //   plpUrl       — 1500×2025 portrait JPEG, same color spec
  //   wholesaleUrl — 3200×4000 portrait JPEG, PURE WHITE background (B2B catalog)
  // Produced in /api/generate by `formatAll()` in deliverable-format.ts.
  // Filenames follow `{focusDesignNumber}-{M|E|W}{suffix}.jpg`.
  pdpUrl?: string;
  plpUrl?: string;
  wholesaleUrl?: string;
  /**
   * Pipeline-stage debug URLs (added 2026-05-13). Each key is a stage name
   * (seedream / teeedit / shoeedit / label / upscaled / matte-grey /
   * matte-white / final), each value is a GCS URL of that stage's
   * intermediate buffer. Stages that didn't run for this shot are absent.
   *
   * Populated by saveStage() in src/lib/pipeline/stage-recorder.ts. Used by
   * the results page "Stages" debug viewer to identify which step in the
   * pipeline introduces an artifact (paintbrush look, blur, color shift).
   * Absent on shots generated before this shipped.
   */
  pipelineStages?: Partial<Record<
    | 'pass1'
    | 'seedream'
    | 'teeedit'
    | 'shoeedit'
    | 'label'
    | 'upscaled'
    | 'matte-raw-grey'
    | 'matte-raw-white'
    | 'matte-grey'
    | 'matte-white'
    | 'final',
    string
  >>;
}

// ── Modifications ──

export interface Modification {
  modificationId: string;
  shotId: string;
  jobId: string;
  instruction: string;
  originalPrompt: string;
  newPrompt: string;
  approved: boolean;
  createdAt: Date;
}

export interface PromptAdjustment {
  adjustmentId: string;
  category: GarmentCategory;
  shotType: ShotType;
  adjustment: string;
  confidence: number;
  status: 'pending' | 'approved' | 'rejected';
  source: 'auto' | 'manual';
  createdAt: Date;
}

// ── Wardrobe (v2: 6 labeled fit model angles) ──

// v2 uses 'shoes' | 'top' | 'bottom'; legacy UI still sends 'shirt' | 'jacket' | 'pants'
export type WardrobeCategory = 'shoes' | 'top' | 'bottom' | 'shirt' | 'jacket' | 'pants';

/** 6 labeled fit model camera positions */
export interface FitModelAngles {
  front: string;          // straight front view
  front45Left: string;    // 45° rotated left from front
  front45Right: string;   // 45° rotated right from front
  back: string;           // straight back view
  back45Left: string;     // 45° rotated left from back
  back45Right: string;    // 45° rotated right from back
}

export interface WardrobeItem {
  wardrobeId: string;
  name: string;
  designNumber?: string;
  category: WardrobeCategory;
  description: string;

  // Flat product images
  flatFrontUrl: string;
  flatBackUrl?: string;

  // 6 labeled fit model angles
  fitModels: FitModelAngles;

  // UI thumbnail
  thumbnailUrl: string;

  createdAt: Date;
  updatedAt: Date;

  // 2026-05-27 (Phase 2 Slice 2A of dashboard redesign): collection
  // classification. Items are tagged as either a Drop (time-bound merch,
  // sells out, focus-only) or NOOS (always-on, focus or styling). All
  // three fields are OPTIONAL because the Phase 2 Slice 2A migration
  // script defaults pre-classification items to NOOS / Legacy; future
  // Classic-path uploads (deliberately not modified — see CLAUDE.md
  // dashboard redesign spec) may also create unclassified items.
  // /v2 read paths apply `coerceClassification()` defaults at read time.
  classification?: 'drop' | 'noos';
  drop?: { year: number; quarter: 1 | 2 | 3 | 4; dropNumber: number };
  noosBucket?: 'denim' | 'tops' | 'outerwear' | 'legacy';
  classifiedAt?: string;
  classifiedBy?: string;
}

// ── Prompt Vault ──

export interface PromptFile {
  id: string;              // e.g., "M03_GENERATION_GUIDE"
  filename: string;        // e.g., "M03_GENERATION_GUIDE.md"
  shotType: ShotType;      // which shot type this prompt is for
  category?: string;       // e.g., "pants", "shirts" — for future per-garment-type prompts
  revision: number;        // auto-incremented on upload
  isActive: boolean;       // true = currently used for new generations
  content: string;         // full .md file content
  gcsUrl: string;          // backup in GCS for download
  uploadedBy: string;      // admin email
  uploadedAt: Date;

  // Alternative prompt support
  isAlternative?: boolean; // true = rerun-only prompt, not used for initial generation
  label?: string;          // display label for rerun button, e.g. "Color Fidelity"

  // Extracted at upload time for quick access
  silhouettePrompt?: string;
  generationPrompt?: string;
}

// ── Category field configuration ──

export interface CategoryFieldConfig {
  key: string;
  label: string;
  type: 'select' | 'text';
  options?: string[];
  placeholder?: string;
}

export const CATEGORY_FIELDS: Record<GarmentCategory, CategoryFieldConfig[]> = {
  pants: [
    { key: 'waistHeight', label: 'Waist Height', type: 'select', options: ['high', 'medium', 'low'] },
    { key: 'floorDistance', label: 'Distance to Floor', type: 'select', options: ['0 - touching', '1', '2', '3', '4 - well above ankle'] },
  ],
  jackets: [
    { key: 'fitDescription', label: 'Fit Description', type: 'text', placeholder: 'e.g., aansluitend, regular, loose grunge woodchopper...' },
  ],
  tops: [
    { key: 'fitDescription', label: 'Fit Description', type: 'text', placeholder: 'e.g., slim, regular, oversized...' },
  ],
  knitwear: [
    { key: 'fitDescription', label: 'Fit Description', type: 'text', placeholder: 'e.g., fitted, relaxed, chunky oversized...' },
  ],
  dresses: [
    { key: 'fitDescription', label: 'Fit/Silhouette', type: 'text', placeholder: 'e.g., bodycon, A-line, oversized shift...' },
    { key: 'floorDistance', label: 'Hem Length', type: 'select', options: ['mini', 'knee', 'midi', 'maxi', 'floor'] },
  ],
  accessories: [
    { key: 'fitDescription', label: 'Item Description', type: 'text', placeholder: 'e.g., belt, bag, hat, scarf...' },
  ],
};

// ══════════════════════════════════════════════════════════════════════════
// Leather label — three-tier schema (ADR-001 Option B, v1 2026-04-11)
// ══════════════════════════════════════════════════════════════════════════
//
// Tier 1: labelTemplates/{templateId}     — artwork (shared across styles)
// Tier 2: labelStyles/{styleCode}         — geometry (shared across colorways)
// Tier 3: labelColorways/{styleCode}_{colorwayCode} — color-only delta
//
// At generation time the three tiers are merged into a single LabelRenderConfig
// passed to applyHybridLabel().
// ══════════════════════════════════════════════════════════════════════════

export type GrainVariant = 'pebbled' | 'smooth' | 'coarse';

export interface ColorRGB {
  r: number;
  g: number;
  b: number;
  hex: string;
}

export interface Point2D {
  x: number;
  y: number;
}

/** Tier 1 — physical label artwork. One doc per templateId (e.g. "L2936-8.0"). */
export interface LabelTemplate {
  templateId: string;          // doc id
  name?: string;               // friendly name
  artworkUrl: string;          // full-resolution template PNG (height map)
  materialTileUrls: Partial<Record<GrainVariant, string>>; // plain-leather tiles per grain
  aspectRatio: number;         // width / height of physical label
  createdAt: Date;
  updatedAt: Date;
}

/** Tier 2 — per-style geometry. One doc per styleCode (e.g. "D22889"). */
export interface LabelStyle {
  styleCode: string;           // doc id
  templateId: string;          // ref → labelTemplates/{templateId}

  // Which fit-model photo we annotated on
  anchorPhoto: {
    wardrobeItemId: string;    // source of truth for the photo
    photoKey: keyof FitModelAngles | 'flatBack'; // which angle was used
    url: string;               // cached url for display
    width: number;             // natural dimensions
    height: number;
  };

  // All corners are in NATURAL PIXEL coordinates on the anchor photo.
  // Order is canonical: TL, TR, BR, BL (post-sortQuad).
  labelCorners: [Point2D, Point2D, Point2D, Point2D];
  pocketCorners: [Point2D, Point2D, Point2D, Point2D];

  updatedBy: string;           // admin email
  updatedAt: Date;
}

/** Tier 3 — per-colorway color-only delta. Doc id: `${styleCode}_${colorwayCode}`. */
export interface LabelColorway {
  styleCode: string;
  colorwayCode: string;
  colorwayName?: string;       // friendly, e.g. "grey Judee loose"

  baseColor: ColorRGB;         // leather body — sampled from reference
  stitchColor?: ColorRGB;      // optional contrast thread
  embossStrength: number;      // 0..1 — shader deboss strength (tan 0.85, black 0.35)
  grainVariant: GrainVariant;  // which material tile to use from the template

  sampledFromPhoto?: string;   // url of the photo color was sampled from (audit)
  updatedBy: string;
  updatedAt: Date;
}

/** Fully-resolved config handed to the hybrid-label shader at generation time. */
export interface LabelRenderConfig {
  templateId: string;
  artworkUrl: string;
  materialTileUrl: string;
  baseColor: ColorRGB;
  stitchColor?: ColorRGB;
  embossStrength: number;
  grainVariant: GrainVariant;
  // Geometry — natural-pixel corners on the anchor photo
  labelCorners: [Point2D, Point2D, Point2D, Point2D];
  pocketCorners: [Point2D, Point2D, Point2D, Point2D];
  anchorPhotoWidth: number;
  anchorPhotoHeight: number;
}
