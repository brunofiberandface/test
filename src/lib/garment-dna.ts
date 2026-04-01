/**
 * Garment DNA — per-product critical details for generation prompts.
 *
 * Each garment has unique construction details that Gemini MUST reproduce.
 * These are observed from mannequin + flat reference images and product descriptions.
 * Without these, the model generates generic jeans instead of the specific product.
 *
 * IMPORTANT: The zone crops feed Gemini the visual details, but the text DNA
 * tells it WHAT to look for and WHERE. Both are needed for 9+/10 quality.
 */

export interface GarmentDNA {
  designNumber: string;
  styleName: string;
  gender: 'male' | 'female';
  category: string;
  fit: string;
  /** Critical construction details — appended to every generation prompt */
  dna: string;
  /** Per-shot pose overrides (e.g., "hands behind back" for carpenter pocket visibility) */
  shotOverrides?: Record<string, string>;
  /** Special zone crops (e.g., carpenter pocket location) */
  specialZones?: Array<{
    name: string;
    y1: number; y2: number;
    x1: number; x2: number;
    upscale: number;
    angles: number[];
    label: string;
  }>;
}

/**
 * Registry of known garments with their DNA.
 * Add new garments here as they are photographed.
 */
export const GARMENT_REGISTRY: Record<string, GarmentDNA> = {

  'D27463-D945-001': {
    designNumber: 'D27463-D945-001',
    styleName: 'Carpenter Straight Jeans',
    gender: 'male',
    category: 'pants',
    fit: 'wide straight leg',
    dna: `CRITICAL GARMENT DETAILS — match EVERY detail from the reference images:

FABRIC & COLOR:
- Dark raw indigo denim — deep navy, almost black with indigo hue, UNWASHED
- NO fading, NO distressing, NO wash effects, NO whiskering
- Gold/yellow contrast topstitching on ALL major seams

WAISTBAND & FLY:
- Button fly — single metal shank button at center waist
- Mid-rise waistband with belt loops (5-6 loops)
- Gold topstitching along waistband edges

POCKETS:
- Two front slash pockets with topstitched edges
- Small coin pocket at right front (viewer's left)
- CARPENTER/TOOL POCKET on outer thigh — rectangular patch pocket with topstitching, SIGNATURE DETAIL
- Two back patch pockets
- Copper/bronze rivets at stress points

LEG SHAPE:
- Wide straight leg / relaxed fit — NOT slim, NOT skinny
- Generous through thigh, minimal taper

HEM/CUFFS:
- Selvedge turn-up cuffs at hem showing white/natural selvedge edge line
- Single fold, approximately 3-4cm deep`,
    shotOverrides: {
      M01: 'POSE: Hands clasped BEHIND BACK — arms behind body, chest open. This ensures the CARPENTER POCKET on the outer thigh is FULLY visible and unobstructed.',
    },
    specialZones: [
      {
        name: 'Carpenter Pocket',
        y1: 0.44, y2: 0.58,
        x1: 0.55, x2: 0.85,
        upscale: 2.5,
        angles: [0, 1, 2],
        label: 'CARPENTER POCKET CLOSE-UP — rectangular patch pocket on outer thigh with topstitching. This SIGNATURE DETAIL must be clearly visible.',
      },
    ],
  },

  'D28831-E358-H938': {
    designNumber: 'D28831-E358-H938',
    styleName: 'Stevey 3D Flare Jeans',
    gender: 'female',
    category: 'pants',
    fit: 'bootcut flare',
    dna: `CRITICAL GARMENT DETAILS — match EVERY detail from the reference images:

FABRIC & COLOR:
- Greencast denim — medium/vintage wash with SOFT GREEN UNDERTONE
- Indigo base with greenish cast — NOT pure blue, NOT grey, NOT black
- Heavy WHISKERING at hip/thigh — horizontal fading lines from fly/pocket area
- HONEYCOMB FADING behind knees
- Overall vintage worn-in appearance — lighter at stress points, darker in creases
- 13 oz sturdy denim

WAISTBAND & FLY:
- Zip + button fly — single metal button at center waist
- Mid-rise waistband — NOT high, NOT low
- Belt loops (5-6)

POCKETS:
- Two front slash pockets
- Small coin pocket at right front (viewer's left)
- Two back patch pockets — simple
- NO carpenter pocket

G-STAR BRANDING:
- Small yellow/gold G-STAR woven label on front left pocket area (viewer's right)
- Paper/leather-look G-STAR RAW patch on back right pocket area
- DO NOT add any branding not visible in references

LEG SHAPE — SIGNATURE FLARE:
- BOOTCUT/FLARE fit — the DEFINING feature
- Fitted through hip and thigh (3D sculpted construction)
- From the knee, the leg FLARES DRAMATICALLY outward
- At the hem, the leg opening is very wide — much wider than the knee
- Match the exact flare angle from the mannequin references

3D CONSTRUCTION:
- Sculpted fit through hip and upper thigh — shaped seaming
- Body-hugging above the knee, transitions to wide flare below

HEM:
- Clean hem — NO selvedge cuffs, NO turn-ups
- Straight cut at full length, should touch top of shoes`,
    specialZones: [
      {
        name: 'Flare Opening',
        y1: 0.65, y2: 0.88,
        x1: 0.05, x2: 0.95,
        upscale: 1.5,
        angles: [0, 2, 4],
        label: 'FLARE ZONE — the dramatic leg opening from knee to hem. This is WIDER than the hip. Copy this silhouette EXACTLY.',
      },
    ],
  },

};

/**
 * Look up garment DNA by design number.
 * Returns null if not in registry — the system still works with generic prompts.
 */
export function getGarmentDNA(designNumber: string): GarmentDNA | null {
  // Try exact match first
  if (GARMENT_REGISTRY[designNumber]) {
    return GARMENT_REGISTRY[designNumber];
  }
  // Try prefix match (e.g., "D27463" matches "D27463-D945-001")
  for (const [key, dna] of Object.entries(GARMENT_REGISTRY)) {
    if (key.startsWith(designNumber) || designNumber.startsWith(key.split('-').slice(0, 2).join('-'))) {
      return dna;
    }
  }
  return null;
}
