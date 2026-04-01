// ── Core Types ──

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

export type GarmentCategory =
  | 'pants'
  | 'jackets'
  | 'tops'
  | 'knitwear'
  | 'dresses'
  | 'accessories';

export interface GarmentMetadata {
  category: GarmentCategory;
  // Pants-specific
  waistHeight?: 'high' | 'medium' | 'low';
  floorDistance?: 0 | 1 | 2 | 3 | 4;
  // Jackets/tops
  fitDescription?: string; // free text: "aansluitend" to "loose grunge woodchopper"
  // General
  customFields?: Record<string, string>;
}

export type ModelGender = 'male' | 'female';

export interface AIModel {
  modelId: string; // M1, F3, etc.
  name: string; // "Classic Chiseled"
  description: string; // Full prompt description
  cardImageUrl: string;
  gender: ModelGender;
  active: boolean;
  createdBy: string;
  createdAt: Date;
}

export type JobStatus = 'uploading' | 'generating' | 'review' | 'complete';

export interface Job {
  jobId: string;
  designNumber: string; // G-Star product code
  creatorEmail: string;
  status: JobStatus;
  garmentCategory: GarmentCategory;
  description: string;
  metadata: GarmentMetadata;
  modelIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type ShotType = 'M01' | 'M02' | 'M03' | 'M04' | 'M05';
export type ShotVariant = 'A' | 'B';
export type ShotStatus = 'queued' | 'generating' | 'done' | 'approved' | 'rejected';

export interface Shot {
  shotId: string;
  jobId: string;
  modelId: string;
  shotType: ShotType;
  variant: ShotVariant;
  version: number;
  status: ShotStatus;
  imageUrl?: string;
  driveFileId?: string;
  prompt: string;
  createdAt: Date;
}

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

// ── Wardrobe (stock items for dressing models) ──

export type WardrobeCategory = 'shoes' | 'shirt' | 'jacket' | 'pants';

export interface WardrobeItem {
  wardrobeId: string;
  name: string;               // "Black Chelsea Boot"
  category: WardrobeCategory;
  gender: 'male' | 'female' | 'unisex'; // Target gender (shoes default to 'unisex')
  description: string;         // Brief description for AI prompt
  imageUrls: string[];         // 360° mannequin images in GCS
  fitModelUrls?: string[];     // Fit model images (real human wearing garment) — used for drape/silhouette reference
  flatImageUrl?: string;       // Optional flat image
  thumbnailUrl: string;        // First image for UI picker
  isPrimary: boolean;          // true = focus garment (step 1), false = styling item (step 3)
  createdAt: Date;
  updatedAt: Date;
}

// Which wardrobe categories can be selected per garment category
export const WARDROBE_OPTIONS: Record<GarmentCategory, WardrobeCategory[]> = {
  pants: ['shoes', 'shirt', 'jacket'],
  jackets: ['pants', 'shoes'],
  tops: ['pants', 'shoes'],
  knitwear: ['pants', 'shoes'],
  dresses: ['shoes', 'jacket'],
  accessories: [],
};

// ── Category metadata config ──
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

export interface CategoryFieldConfig {
  key: string;
  label: string;
  type: 'select' | 'text';
  options?: string[];
  placeholder?: string;
}
