/**
 * Zone detection helpers — determine which body zone a garment category occupies.
 * Used for dressed-base zone-aware ignore instructions and uncovered zone rules.
 */

export const LOWER_BODY_CATEGORIES = ['pants', 'jeans', 'shorts', 'skirt', 'trousers'] as const;
export const UPPER_BODY_CATEGORIES = ['jacket', 'shirt', 'top', 'blouse', 'coat', 'bomber', 'overshirt', 'vest'] as const;

export function isLowerBodyCategory(category: string): boolean {
  return LOWER_BODY_CATEGORIES.includes(category.toLowerCase() as any);
}

export function isUpperBodyCategory(category: string): boolean {
  return UPPER_BODY_CATEGORIES.includes(category.toLowerCase() as any);
}

/**
 * Detect which body zones are covered by a set of wardrobe categories.
 */
export function detectCoveredZones(categories: string[]): { hasLowerBody: boolean; hasUpperBody: boolean } {
  const lower = categories.map(c => c.toLowerCase());
  return {
    hasLowerBody: lower.some(c => isLowerBodyCategory(c)),
    hasUpperBody: lower.some(c => isUpperBodyCategory(c)),
  };
}

/**
 * Build zone-aware ignore instructions for dressed base references.
 * Tells Gemini which clothing zone to disregard from the dressed base
 * because the focus garment will replace it.
 */
export function buildIgnoreZoneInstruction(focusCategory: string): string {
  if (isLowerBodyCategory(focusCategory)) {
    return `\n\nCRITICAL — IGNORE THE PANTS/LEGWEAR on this dressed reference. The model may appear to wear pants or trousers — these are PLACEHOLDER clothing from the base generation and MUST BE COMPLETELY REPLACED by the focus garment (the actual product being photographed). Only match: face, hair, skin tone, body type, shoes, and any UPPER BODY clothing (jacket, shirt, top). The LOWER BODY will be dressed by the focus garment from the mannequin references.`;
  }
  if (isUpperBodyCategory(focusCategory)) {
    return `\n\nCRITICAL — IGNORE THE JACKET/SHIRT/TOP on this dressed reference. The model may appear to wear an upper body garment — this is PLACEHOLDER clothing from the base generation and MUST BE COMPLETELY REPLACED by the focus garment (the actual product being photographed). Only match: face, hair, skin tone, body type, shoes, and any LOWER BODY clothing (pants, jeans). The UPPER BODY will be dressed by the focus garment from the mannequin references.`;
  }
  return '';
}

/**
 * Build uncovered zone rules for dressed base generation.
 * RAI-safe: avoids "underwear" / "briefs" / "bra" — uses "base clothing as shown in model card" instead.
 */
export function buildUncoveredZoneRules(coveredZones: { hasLowerBody: boolean; hasUpperBody: boolean }): string {
  let rules = '';
  if (!coveredZones.hasLowerBody) {
    rules += `\n- LOWER BODY: Keep the model's legs EXACTLY as shown in the model card (image 1) — same base clothing. Do NOT add any pants, jeans, trousers, shorts, or any legwear beyond what the model card shows. This is intentional.`;
  }
  if (!coveredZones.hasUpperBody) {
    rules += `\n- UPPER BODY: Keep the model's torso EXACTLY as shown in the model card (image 1) — same base clothing. Do NOT add any jacket, shirt, blouse, coat, or any upper garment beyond what the model card shows. This is intentional.`;
  }
  return rules;
}
