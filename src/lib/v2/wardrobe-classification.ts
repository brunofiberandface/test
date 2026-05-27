/**
 * v2 wardrobe classification model.
 *
 * Every wardrobe item is classified as either a Drop (time-bound merch,
 * sells out, used as focus only) or NOOS (Never Out Of Stock, always
 * available, can be focus OR styling).
 *
 * Bruno's rules:
 *   - One drop = one quarter. No spanning.
 *   - NOOS sub-buckets are fixed: denim, tops, outerwear, plus the
 *     migration-only bucket "legacy" (for pre-classification items).
 *   - Drops cannot be used as styling items.
 *   - Drop ↔ NOOS migration is NOT allowed. Separate SKUs.
 *   - Classification is locked once the wardrobe item is saved.
 *
 * 2026-05-27 (Phase 2 Slice 2A of dashboard redesign).
 */

export type V2Classification = 'drop' | 'noos';

export type V2Quarter = 1 | 2 | 3 | 4;

/** Embedded drop coordinates on a wardrobe item. */
export interface V2Drop {
  year: number;       // e.g. 2026
  quarter: V2Quarter; // 1 | 2 | 3 | 4
  dropNumber: number; // 1, 2, 3, ...
}

/**
 * Fixed NOOS sub-buckets. 'legacy' is reserved for items migrated from
 * the pre-classification era (Phase 2 Slice 2A migration script).
 */
export const NOOS_BUCKETS = ['denim', 'tops', 'outerwear', 'legacy'] as const;
export type V2NoosBucket = typeof NOOS_BUCKETS[number];

/** User-facing NOOS bucket labels for the sidebar / pickers. */
export const NOOS_BUCKET_LABELS: Record<V2NoosBucket, string> = {
  denim:     'Denim basics',
  tops:      'Tops basics',
  outerwear: 'Outerwear',
  legacy:    'Legacy',
};

/** User-facing quarter labels. */
export const QUARTER_LABELS: Record<V2Quarter, string> = {
  1: 'Q1', 2: 'Q2', 3: 'Q3', 4: 'Q4',
};

/**
 * Fields added to the wardrobe item doc.
 *
 * All three are optional in TypeScript because (a) the migration script
 * may not have run yet on every environment, and (b) Classic-path
 * uploads (deliberately not modified per Bruno's "leave it alone")
 * may still create unclassified items until /v2 is fully adopted.
 *
 * Read paths in /v2 should default unclassified items to NOOS / Legacy
 * via `coerceClassification()` below.
 */
export interface V2WardrobeClassificationFields {
  classification?: V2Classification;
  /** Set iff classification === 'drop'. */
  drop?: V2Drop;
  /** Set iff classification === 'noos'. */
  noosBucket?: V2NoosBucket;
  /** ISO timestamp of when the classification was set (audit trail). */
  classifiedAt?: string;
  /** Email of the user who classified (audit trail). */
  classifiedBy?: string;
}

/**
 * Apply the read-side default for unclassified items. Used by /v2 read
 * paths so items uploaded via Classic (which doesn't set classification)
 * still show up somewhere in the sidebar — they land in NOOS · Legacy
 * and can be reclassified manually later.
 */
export function coerceClassification(
  item: V2WardrobeClassificationFields,
): { classification: V2Classification; drop?: V2Drop; noosBucket?: V2NoosBucket } {
  if (item.classification === 'drop' && item.drop) {
    return { classification: 'drop', drop: item.drop };
  }
  if (item.classification === 'noos' && item.noosBucket) {
    return { classification: 'noos', noosBucket: item.noosBucket };
  }
  // Unclassified or partial — default to NOOS · Legacy.
  return { classification: 'noos', noosBucket: 'legacy' };
}

/**
 * Validate a proposed classification payload before writing it. Throws
 * a clear error if invalid; caller (API layer) should map to HTTP 400.
 */
export function validateClassification(input: V2WardrobeClassificationFields): void {
  if (!input.classification) {
    throw new Error('classification is required (drop | noos)');
  }
  if (input.classification === 'drop') {
    if (!input.drop) throw new Error('drop coordinates required for classification=drop');
    const { year, quarter, dropNumber } = input.drop;
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      throw new Error(`drop.year out of range: ${year}`);
    }
    if (![1, 2, 3, 4].includes(quarter)) {
      throw new Error(`drop.quarter must be 1-4, got ${quarter}`);
    }
    if (!Number.isInteger(dropNumber) || dropNumber < 1 || dropNumber > 99) {
      throw new Error(`drop.dropNumber out of range: ${dropNumber}`);
    }
    if (input.noosBucket) {
      throw new Error('noosBucket cannot be set when classification=drop');
    }
  } else if (input.classification === 'noos') {
    // 2026-05-27 — noosBucket is no longer required at validation time.
    // The /v2 sidebar derives NOOS sub-buckets from item.category (the
    // 2B-hotfix change), so the bucket field is vestigial. If present
    // it still has to be one of the known values; absent is fine.
    if (input.noosBucket !== undefined && !NOOS_BUCKETS.includes(input.noosBucket)) {
      throw new Error(`noosBucket must be one of ${NOOS_BUCKETS.join(', ')}, got ${input.noosBucket}`);
    }
    if (input.drop) {
      throw new Error('drop cannot be set when classification=noos');
    }
  } else {
    throw new Error(`classification must be 'drop' or 'noos', got ${input.classification}`);
  }
}

/** Human-readable drop label e.g. "2026 · Q3 · Drop 4". */
export function formatDrop(d: V2Drop): string {
  return `${d.year} · ${QUARTER_LABELS[d.quarter]} · Drop ${d.dropNumber}`;
}

/** Stable string key for a drop, e.g. "2026-Q3-4". Used for sidebar keys. */
export function dropKey(d: V2Drop): string {
  return `${d.year}-Q${d.quarter}-${d.dropNumber}`;
}
