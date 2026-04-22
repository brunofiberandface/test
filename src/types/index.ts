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

export type JobStatus = 'pending' | 'generating' | 'review' | 'complete' | 'failed';

/** Which image-generation backend to use. Defaults to 'gemini' everywhere absent. */
export type GenerationProvider = 'gemini' | 'seedream';

export interface JobWardrobe {
  shoe: { itemId: string; isFocus: boolean };
  top: { itemId: string; isFocus: boolean };
  bottom: { itemId: string; isFocus: boolean };
}

export interface Job {
  jobId: string;
  jobName: string;
  creatorEmail: string;
  status: JobStatus;

  // v2: structured wardrobe selection
  wardrobe: JobWardrobe;
  modelId: string;

  // Prompt versions used (for reproducibility)
  promptRevisions: {
    M01: number;
    M02: number;
    M03: number;
    M04: number;
    M05: number;
  };

  // Cached silhouette analysis results
  silhouetteAnalysis?: {
    front: string;
    back: string;
  };

  // M03/M04 anchor URLs (for dependency chain)
  m03AnchorUrl?: string;
  m04AnchorUrl?: string;

  // Image-generation backend for this job. Absent = 'gemini' (production default).
  provider?: GenerationProvider;

  createdAt: Date;
  updatedAt: Date;
}

// ── Shots ──

export type ShotType = 'M01' | 'M02' | 'M03' | 'M04' | 'M05';
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
