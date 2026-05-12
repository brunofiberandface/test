/**
 * Cropped-hem detector — shared util.
 *
 * Detects whether a garment's cached silhouette description indicates an
 * intentionally cropped / cuffed / rolled / above-ankle hem. These designs
 * have the hem ending ABOVE the floor regardless of footwear, so any
 * "extend hem to floor" or "jeans go over the shoes" instruction in the
 * generation pipeline would actively destroy the design intent.
 *
 * Originally lived inline in `gemini-shoe-edit.ts` (2026-05-07, after Bruno
 * caught Kate Boyfriend Jeans 61 losing its rolled cuff on shoe-edit rerun).
 * Lifted out 2026-05-12 when the same disease was discovered in
 * `seedream-twopass.ts` PASS2_PROMPT — both call sites now share this
 * single source of truth.
 *
 * Usage:
 *   const view = shotType === 'M04' ? 'back' : 'front';
 *   const silhouette = view === 'back'
 *     ? (bottomItem.silhouetteBack || bottomItem.silhouetteFront || '')
 *     : (bottomItem.silhouetteFront || bottomItem.silhouetteBack || '');
 *   if (silhouetteIndicatesCroppedHem(silhouette)) {
 *     // switch to cuff-preserving prompt branch
 *   }
 */

export const CROPPED_HEM_PATTERNS: RegExp[] = [
  /\brolled\s+(cuff|hem|leg)/i,
  /\bcuffed\s+(hem|leg|cuff|edge)/i,
  /\bcropped\s+(length|leg|hem|pant|pants|jean|jeans|fit|cut|with)/i,
  /\babove[-\s]ankle\b/i,
  /\bankle[-\s]length\b/i,
  /\bcalf[-\s]length\b/i,
  /\bmid[-\s]calf\b/i,
  /\braw\s+selvedge/i,  // raw selvedge ~ always paired with rolled cuff
  /\bcropped[-\s]with[-\s]cuff/i,
  /\bdeliberate\s+rolled\s+cuff/i,
  /\bfolded[-\s]up\s+hem\b/i,
  /\bturned[-\s]up\s+(cuff|hem)\b/i,
];

export function silhouetteIndicatesCroppedHem(silhouette: string | undefined | null): boolean {
  if (!silhouette) return false;
  return CROPPED_HEM_PATTERNS.some(p => p.test(silhouette));
}
