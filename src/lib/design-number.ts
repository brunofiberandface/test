/**
 * designNumber parsing — splits the freeform `designNumber` field on a
 * wardrobe item into the canonical {styleCode, colorwayCode} pair used by the
 * three-tier label schema (ADR-001 Option B).
 *
 * G-Star convention (confirmed by Bruno): `D{styleCode}-D{colorwayCode}-H{sizeCode}`
 * Example: `D22889-D933-H087` → styleCode=D22889, colorwayCode=D933, size=H087
 *
 * We tolerate:
 *   - Missing segments (colorway/size optional, styleCode required)
 *   - Lower/upper case
 *   - Extra whitespace
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

const DESIGN_NUMBER_RE = /^\s*([A-Za-z0-9]+?)(?:[-_ ]+([A-Za-z0-9]+))?(?:[-_ ]+([A-Za-z0-9]+))?\s*$/;

export function parseDesignNumber(
  raw: string | undefined | null,
): ParsedDesignNumber | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = DESIGN_NUMBER_RE.exec(raw);
  if (!m) return null;
  const [, style, colorway, size] = m;
  if (!style) return null;
  return {
    raw: raw.trim(),
    styleCode: style.toUpperCase(),
    colorwayCode: colorway ? colorway.toUpperCase() : null,
    sizeCode: size ? size.toUpperCase() : null,
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
