/**
 * Shared types for the v2 create-job wizard.
 *
 * The wizard threads four pieces of state from step to step. Each step
 * component reads what it needs and writes what it sets via the
 * setter callbacks. The host page (/v2/jobs/new) owns the state.
 *
 * 2026-05-27 (Phase 2 Slice 2D of dashboard redesign).
 */

import type { V2Quarter } from '@/lib/v2/wardrobe-classification';

export type SlotKey = 'shoe' | 'top' | 'bottom';

/** Maps a wardrobe-item category to its job slot. Mirrors the Classic
 *  /jobs/new SLOTS list so the resulting job is compatible with the
 *  shared backend. */
export function categoryToSlot(category?: string): SlotKey | undefined {
  if (!category) return undefined;
  const c = category.toLowerCase();
  if (c === 'shoe' || c === 'shoes') return 'shoe';
  if (['top', 'shirt', 'jacket', 'knitwear'].includes(c)) return 'top';
  if (['bottom', 'pants', 'jeans'].includes(c)) return 'bottom';
  return undefined;
}

/** User-facing slot label. */
export function slotLabel(slot: SlotKey): string {
  switch (slot) {
    case 'shoe': return 'Shoes';
    case 'top': return 'Top';
    case 'bottom': return 'Bottom';
  }
}

/** Categories accepted in each slot for the wardrobe picker query. */
export const SLOT_CATEGORIES: Record<SlotKey, string[]> = {
  shoe:   ['shoes'],
  top:    ['top', 'shirt', 'jacket', 'knitwear'],
  bottom: ['bottom', 'pants', 'jeans'],
};

/** All slots in canonical order — used to render styling sections. */
export const ALL_SLOTS: SlotKey[] = ['top', 'bottom', 'shoe'];

export type CollectionPick =
  | { kind: 'drop'; year: number; quarter: V2Quarter; dropNumber: number }
  | { kind: 'noos' };

export interface WardrobeItemRef {
  wardrobeId: string;
  name: string;
  designNumber?: string;
  category?: string;
  gender?: string;
  flatFrontUrl?: string;
  fitFrontUrl?: string;
  fitBackUrl?: string;
  fitBack45RightUrl?: string;
}

export interface ModelRef {
  modelId: string;
  name: string;
  gender?: string;
  referenceImageUrl?: string;
}

export interface WizardState {
  collection: CollectionPick | null;
  focus: WardrobeItemRef | null;
  styling: Partial<Record<SlotKey, WardrobeItemRef>>;
  model: ModelRef | null;
  /** M01/M02 top-focus pose id (e.g. f03, m07). Gender-specific. Optional —
   *  absent = backend picks a default per gender at generation time. */
  m03TopPoseId: string | null;
  /** M03 free pose id (e.g. p02). Optional — absent = backend default pose. */
  m03PoseId: string | null;
}

export const INITIAL_WIZARD_STATE: WizardState = {
  collection: null,
  focus: null,
  styling: {},
  model: null,
  m03TopPoseId: null,
  m03PoseId: null,
};

export const TOTAL_STEPS = 4;
