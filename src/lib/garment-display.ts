/**
 * Shared helpers for rendering garment identity in the UI.
 *
 * Wardrobe item.name follows the convention:
 *   "D29953-E875-J648 LOUX BOYFRIEND WMN"
 *    └── full SKU ──┘ └─── design name ──┘
 *
 * `designNumber` on the doc is just the first segment ("D29953") in some
 * legacy items but is often the full SKU ("D29953-E875-J648") in newer items.
 *
 * UIs (wardrobe grid, new-job selection grid, style-filter dropdown) need a
 * consistent two-line display: design number on line 1, name on line 2.
 *
 * The parser is the same one used in /api/jobs/route.ts for the focus item
 * enrichment — kept in sync here.
 */

export interface GarmentNamed {
  name?: string;
  designNumber?: string;
}

export interface GarmentDisplay {
  /** Full SKU when available, otherwise whatever designNumber is on the doc. */
  designNumber: string;
  /** Human-readable design name (everything after the SKU in `name`). */
  designName: string;
}

/**
 * Parse one wardrobe item into its (designNumber, designName) display pieces.
 * Falls back gracefully when the name doesn't match the SKU + name convention.
 */
export function parseGarmentDisplay(item: GarmentNamed): GarmentDisplay {
  const fullName = item.name || '';
  // "D12345-ABC-XYZ DESIGN NAME"  → match[1]=SKU, match[2]=name
  const m = fullName.match(/^(D\d+[-\w]+)\s+(.+)$/);
  if (m) {
    return { designNumber: m[1], designName: m[2] };
  }
  if (item.designNumber) {
    return { designNumber: item.designNumber, designName: fullName || '—' };
  }
  return { designNumber: '', designName: fullName || '—' };
}

/**
 * Style-code = first hyphen-separated segment of the design number
 * (e.g., "D29953-E875-J648" → "D29953"). Empty when no design number.
 */
export function extractStyleCode(designNumber?: string): string {
  if (!designNumber) return '';
  return designNumber.split('-')[0]?.trim() || '';
}

/**
 * For a given style code, find a representative design name from the supplied
 * item list (used to label dropdown options as "D29953 — LOUX BOYFRIEND WMN").
 * Picks the first item that matches the code; returns just the code when no
 * match (defensive — should not happen since the codes come from the items).
 */
export function styleCodeLabel(code: string, items: GarmentNamed[]): string {
  const first = items.find(i => extractStyleCode(i.designNumber) === code);
  if (!first) return code;
  const { designName } = parseGarmentDisplay(first);
  if (!designName || designName === '—') return code;
  return `${code} — ${designName}`;
}
