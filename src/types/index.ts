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

// ── AI Models (simplified — 1 reference photo) ──

export type ModelGender = 'male' | 'female';

export interface AIModel {
  modelId: string;
  name: string;
  description: string;
  referenceImageUrl: string;  // Single 4K reference photo (was: cardImageUrl)
  gender: ModelGender;
  active: boolean;
  createdBy: string;
  createdAt: Date;
}

// ── Jobs (v2: 3 wardrobe items + focus) ──

export type JobStatus = 'pending' | 'generating' | 'review' | 'complete' | 'failed';

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
  }>;
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
