/**
 * designNumber parsing — splits the freeform `designNumber` field on a
 * wardrobe item into the canonical {styleCode, colorwayCode} pair used by the
 * three-tier label schema (ADR-001 Option B).
 *
 * G-Star convention (multiple seen):
 *   3-part: `D{styleCode}-D{colorwayCode}-H{sizeCode}`
 *           e.g. `D22889-D933-H087` → style=D22889, colorway=D933, size=H087
 *   4-part: `D{styleCode}-{colorway}-{detail} {sizeCode}` (April 28 shoot onward)
 *           e.g. `D02153-6553-89 52` → style=D02153, colorway=6553, detail=89, size=52
 *
 * We tolerate:
 *   - Missing segments (colorway/size optional, styleCode required)
 *   - Lower/upper case
 *   - Extra whitespace, mixed separators ('-', '_', ' ')
 *   - Optional 4th segment used as size when present (3-segment numbers keep
 *     existing semantics — segment 3 is the size)
 *
 * We DO NOT auto-derive anything if the format doesn't match — callers get
 * null back and should fall back to the manual label picker.
 */

export interface ParsedDesignNumber {
  raw: string;
  styleCode: string;
  colorwayCode: string | null;
  sizeCode: string | null;
}

// Up to 4 alphanumeric segments separated by '-', '_', or whitespace.
const DESIGN_NUMBER_RE = /^\s*([A-Za-z0-9]+?)(?:[-_ ]+([A-Za-z0-9]+))?(?:[-_ ]+([A-Za-z0-9]+))?(?:[-_ ]+([A-Za-z0-9]+))?\s*$/;

export function parseDesignNumber(
  raw: string | undefined | null,
): ParsedDesignNumber | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = DESIGN_NUMBER_RE.exec(raw);
  if (!m) return null;
  const [, style, colorway, third, fourth] = m;
  if (!style) return null;
  // 4-part numbers: third segment is a "detail" code (sub-style or wash code),
  // fourth segment is the size. 3-part numbers: third segment IS the size.
  const sizeCode = fourth || third || null;
  return {
    raw: raw.trim(),
    styleCode: style.toUpperCase(),
    colorwayCode: colorway ? colorway.toUpperCase() : null,
    sizeCode: sizeCode ? sizeCode.toUpperCase() : null,
  };
}

/** Convenience: returns just styleCode, or null if unparseable. */
export function styleCodeOf(raw: string | undefined | null): string | null {
  return parseDesignNumber(raw)?.styleCode ?? null;
}

/** Convenience: returns {styleCode, colorwayCode} or null if either is missing. */
export function styleAndColorwayOf(
  raw: string | undefined | null,
): { styleCode: string; colorwayCode: string } | null {
  const parsed = parseDesignNumber(raw);
  if (!parsed?.styleCode || !parsed?.colorwayCode) return null;
  return {
    styleCode: parsed.styleCode,
    colorwayCode: parsed.colorwayCode,
  };
}
