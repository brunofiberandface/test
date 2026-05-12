/**
 * Cropped-hem detector — shared util.
 *
 * Two detectors with different precision:
 *
 *   silhouetteIndicatesCroppedHem (BROAD)
 *     Used by gemini-shoe-edit.ts to SKIP the "extend hem to floor" step.
 *     Skip is conservative — a false positive means we don't extend, which
 *     is safe. So this matches anything that even hints at a non-floor hem.
 *
 *   silhouetteHasRolledCuff (STRICT)
 *     Used by seedream-twopass.ts to APPLY the cuff-preserving Pass 2
 *     prompt. Apply is aggressive — a false positive forces a rolled cuff
 *     onto a garment that doesn't have one (Bruno caught this 2026-05-12
 *     when 3301 Flares, Culottes, RADAR, CONTOR were all rendered with
 *     unwanted cuffs because the broad detector matched "mid-calf", "raw
 *     selvedge", "cropped length"). Must require EXPLICIT rolled-cuff
 *     vocabulary.
 *
 * Originally lived inline in `gemini-shoe-edit.ts` (2026-05-07, after Bruno
 * caught Kate Boyfriend Jeans 61 losing its rolled cuff on shoe-edit rerun).
 * Lifted out 2026-05-12 + split into broad/strict variants the same day.
 */

// ── BROAD detector (for shoe-edit SKIP rule) ──────────────────────────────
export const CROPPED_HEM_PATTERNS: RegExp[] = [
  /\brolled\s+(cuff|hem|leg)/i,
  /\bcuffed\s+(hem|leg|cuff|edge)/i,
  /\bcropped\s+(length|leg|hem|pant|pants|jean|jeans|fit|cut|with)/i,
  /\babove[-\s]ankle\b/i,
  /\bankle[-\s]length\b/i,
  /\bcalf[-\s]length\b/i,
  /\bmid[-\s]calf\b/i,
  /\braw\s+selvedge/i,  // raw selvedge ~ often paired with rolled cuff
  /\bcropped[-\s]with[-\s]cuff/i,
  /\bdeliberate\s+rolled\s+cuff/i,
  /\bfolded[-\s]up\s+hem\b/i,
  /\bturned[-\s]up\s+(cuff|hem)\b/i,
];

export function silhouetteIndicatesCroppedHem(silhouette: string | undefined | null): boolean {
  if (!silhouette) return false;
  return CROPPED_HEM_PATTERNS.some(p => p.test(silhouette));
}

// ── STRICT detector (for cuff-preserving prompt branches) ─────────────────
// Must require EXPLICIT cuff vocabulary — not just generic "cropped" or
// "mid-calf" or "raw selvedge", which describe length / fabric without
// implying a cuff. Verified against the 2026-05-12 false-positive list:
// 3301 Flares (mid-calf flare progression), Culottes (cropped length),
// RADAR (raw selvedge fabric), CONTOR (mid-calf seam) — none should match
// this strict set. Kate variants (rolled cuff) + LOUX BOYFRIEND
// (deliberate rolled cuff) MUST match.
export const ROLLED_CUFF_PATTERNS: RegExp[] = [
  /\brolled\s+cuff/i,
  /\brolled\s+cuffs/i,
  /\bcuffed\s+hem/i,
  /\bsingle\s+rolled\s+cuff/i,
  /\bdouble\s+rolled\s+cuff/i,
  /\bdeliberate\s+rolled\s+cuff/i,
  /\bdeliberately\s+rolled\s+cuff/i,
  /\bthick\s+rolled\s+cuff/i,
  /\bturned[-\s]up\s+cuff/i,
  /\bfolded[-\s]up\s+cuff/i,
  /\bcuff\s+(?:at|of|height|fold)/i,  // "cuff at mid-ankle", "cuff height of"
];

export function silhouetteHasRolledCuff(silhouette: string | undefined | null): boolean {
  if (!silhouette) return false;
  return ROLLED_CUFF_PATTERNS.some(p => p.test(silhouette));
}
