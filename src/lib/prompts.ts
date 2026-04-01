// ── Prompt Templates for Generation ──
// Incorporates ALL 43 learnings from LEARNINGS.md
// Migrated from pipeline.py universal generation system

export const ANTI_AI_RULES = `CRITICAL REALISM RULES — the model must look like a REAL person, NOT AI-generated:

ANATOMICAL PROPORTIONS — 8-head-unit system (classical standard, verified against anatomy chart):
The body is divided into 8 equal head-heights. All measurements below are % of total body height.

- HEAD: 12.5% of total height (1/8). Small. Crown to chin only. AI ALWAYS makes heads too large — actively SHRINK the head. If the head looks correct to you, make it 10% smaller. This is the #1 AI proportion failure.
- FEET (CRITICAL — #2 AI failure after heads): Natural human feet — same width as the ankle bone area. AI ALWAYS makes feet too large, especially with sandals and open-toe shoes.
  • Foot width MUST be ≤ ankle width. NEVER wider.
  • Shoe length = ~1.3 head-lengths maximum for women, ~1.5 for men.
  • SANDALS: The foot should NOT overhang the sandal edges. Toes do NOT spread wider than the sole.
  • The foot-to-calf ratio must look natural — if the foot looks even SLIGHTLY large, SHRINK it 15%.
  • DO NOT enlarge feet to "ground" the model. Feet are SMALL relative to the body.
  • If using a dressed base reference with oversized shoes/sandals, CORRECT the proportions — match real human anatomy, NOT the reference error.

- ARMS (most common AI failure — arms always too long):
  • Shoulder: 16.7% from top
  • Elbow: 37.5% from top — aligns with NATURAL WAIST (not the trouser/underwear waistband)
  • WRIST: 56.25% from top — at UPPER THIGH, halfway between crotch and mid-thigh
    → Wrist hangs ~1.5 head-heights below the underwear waistband
    → Wrist hangs ~0.5 head-heights below the crotch line
    → Wrist does NOT reach the knee (75%). If wrists are near the knee = arms too long by 2+ head-heights
  • Fingertips: 62.5% from top — MID-THIGH ONLY. Not knee, not below knee.
  • Total arm length (shoulder to fingertip) = 49% of total body height

- BODY MIDPOINT: The crotch (pubic area) falls at exactly 50% of total height — the exact center.
- WAIST (natural): 37.5% from top. The trouser/underwear waistband typically sits at ~43-44% (between waist and crotch).
- KNEES: 75% from top. Wrists must never reach this level.
- SHOULDERS: 2 head-widths wide (female), 2.5 (male). Natural, not football-player wide.
- LEGS: 50% of total height (crotch to heels).

IDENTITY — match the model card EXACTLY across ALL shots:
- HAIR: Same color, same length, same style as the model card. Do NOT change hair between shots.
- FACE: Same facial features, skin tone, face shape as the model card. One person, consistent.
- BODY TYPE: Same build, same proportions as shown in the model card.

REALISM:
- SKIN: Natural texture — visible pores, slight unevenness, natural shine. NOT airbrushed.
- EXPRESSION (G-STAR ECOM STANDARD — STRICT):
  • Relaxed, confident, with energy through the eyes. FRIENDLY AND OPEN FACE. Chin up.
  • ABSOLUTELY NO smile showing teeth. NO grinning. NO laughing. NO "happy girl next door" look.
  • Mouth: lips together, relaxed. A very subtle closed-mouth hint of warmth is OK — but NO open mouth, NO teeth visible.
  • Eyes: direct, confident, engaged. NOT bored, NOT blank, NOT aggressive/bitchy.
  • Think: cool confidence. The model is self-assured and composed. NOT trying to please the camera.
  • Reference: G-Star ECOM guidelines pages 13-14 — every single model has lips together, direct gaze, quiet confidence.
- LIGHTING (G-STAR ECOM STANDARD — STRICT):
  • BACKGROUND: Clean warm light grey (#D5D3CC) studio backdrop. Uniform and consistent across the entire frame. NO dark corners, NO dark patches at the bottom, NO visible gradient, NO vignetting, NO bright spots, NO "ironing light" effects. The background must look like a flat studio paper seamless — same tone everywhere.
  • SHADOW: ONE very soft, subtle floor shadow directly under the model. Almost invisible — just a gentle hint of shadow. NOT dramatic, NOT dark, NOT high-contrast. No additional lighting, no rim lights, no backlighting.
  • SKIN TONE: Naturally warm. NOT cool/blue/clinical.
  • Soft, even overhead studio lighting. Clean, minimal.`;

export const ANTI_HALLUCINATION = `FIDELITY RULES — "Reproduce ONLY what the references show" (Learning #33):

THE GOLDEN RULE: Every detail in the output MUST trace back to a reference image. If a detail appears in ANY reference angle (mannequin, flat, fit model), reproduce it faithfully. If a detail is absent from ALL reference angles, it does not exist on this garment — leave that area clean.

GARMENT FIDELITY — copy the references exactly:
- Reproduce the garment EXACTLY as shown in the reference images — every seam, pocket, rivet, and closure
- The pocket openings, shape, and placement are UNIQUE per design — copy EXACTLY from references
- BACK POCKET PROPORTIONS: MEASURE the pocket height relative to the waistband-to-crotch distance in the mannequin/fit model references and reproduce that EXACT ratio. Some designs have tall pockets, others short — always match the reference.
- The BACK PANEL is PLAIN unless the reference shows otherwise — keep it clean fabric only (Learning #34)
- For zip closures: show ONLY what is visible from the OUTSIDE. When closed, only the zip pull is visible (Learning #33)
- The model wears ONLY what is shown in the reference images — the exact garments, exact colors, exact styles. Nothing more, nothing different.
- If the dressed base reference shows a white t-shirt, the output shows that SAME white t-shirt — same color, same style, same fit.

LABEL & BRANDING FIDELITY (Learning #42 — CRITICAL):
- Labels that ARE visible in the mannequin references MUST be reproduced at the correct position, size, color, and material.
- G-Star jeans typically have: leather back waistband patch (centered on waistband, above back pockets), small woven side label (black/gold, on right hip seam), and rivets at pocket stress points.
- LABEL PLACEMENT PRECISION: The leather back patch sits centered on the waistband seam between the two back pockets. The woven side label sits at the right hip, on the outseam, at waistband height. Reproduce these landmarks exactly.
- LABEL COLOR & MATERIAL: Match the leather tone (tan, brown, black), thread color, and embossing style from the reference. If the patch is tan leather with debossed text, reproduce tan leather with debossed text — not printed, not a different shade.
- If a label is absent from ALL reference angles, it does not exist — leave that area as clean fabric.
- INTERIOR LABELS: Only show interior tags/labels if the garment is open and they are naturally visible. When closed, interior labels are hidden.

TEXT & EMBROIDERY ON FABRIC:
- Only reproduce text, embroidery, or printed patterns that are CLEARLY visible in the reference images.
- If no text/embroidery is visible on the garment in any reference angle, the fabric is clean — keep it clean.
- Match the font, size, color, and position of any visible text/embroidery exactly from the reference.

STITCHING COLOR FIDELITY (Learning #53):
- Match the stitching/topstitching color EXACTLY from the mannequin references.
- White stitching in references = white stitching in output. Brown/tan in references = brown/tan in output.
- This applies to ALL visible stitching: pocket outlines, side seams, inseams, waistband topstitching, back yoke seams.
- Verify stitching color against the closest mannequin angle for each area.

DENIM SURFACE FIDELITY (Learning #52):
- Clean denim stays CLEAN — if the mannequin shows smooth, non-distressed fabric, the output is smooth and non-distressed.
- Distressing, tears, rips, and fraying appear ONLY where they are visible in the mannequin reference photos.
- Match the location, size, and intensity of any distressing from the references.

ACCESSORIES & EXTRAS:
- The model wears ONLY the listed wardrobe items — zero accessories (belts, watches, jewelry, scarves, hats, bags, sunglasses) unless explicitly part of the wardrobe.
- Jacket/top back hems are clean — branded patches or labels appear ONLY if clearly visible in references (Learning #36).

MANNEQUIN ARTIFACTS — filter these out (Learning #24):
- Elastic bands, mounting straps, clips, pins, support structures, and the raised wheeled stand are mannequin hardware — they are NOT part of the garment.
- Shoulder straps and support bands on the mannequin torso hold the form together — they are NEVER denim straps or overall straps (Learning #55).
- The product category defines the garment type. If it says "pants" or "jeans", the garment has NO shoulder straps.`;

export const BODY_SHAPE_RULES: Record<string, string> = {
  pants: `CRITICAL — BODY SHAPE & 3D DENIM FIT (Learning #30 — "Denim starts from the back"):
- G-Star's brand DNA: "Denim starts from the back." The rear/bum MUST be visible and shape the denim.
- The 3D construction SCULPTS the seat area — fabric curves around the bum before dropping into the legs.
- Model should NOT look like a flat tube from hip to leg. Visible bum shape required.
- WOMEN: The buttocks must look FEMININE — natural curves, soft rounded shape. Women's denim sculpts a feminine rear silhouette. NOT flat, NOT masculine, NOT blocky. The seat area should show natural feminine body contour through the denim.
- MEN: The rear should show natural masculine body shape — athletic, not flat.
- From the side: clear curve at the rear, then fabric drops into legs.
- From the back: 3D seams follow body contour around the seat.
- From the front: slight 3/4 angle so body shape is visible (not dead flat).
- Keep it natural and subtle — not exaggerated, not vulgar. Real body in well-constructed denim.

CRITICAL — PANTS ALWAYS OVER SHOES (non-negotiable, every shot):
- The pant leg falls ON TOP of the shoe/boot. The fabric drapes over and rests on the shoe.
- NEVER show pants tucked INTO boots. NEVER show the boot shaft penetrating through the pant hem.
- NEVER show the pants ending mid-boot with the boot visible above the hem.
- The shoe is partially or mostly hidden under the wide leg opening — only the toe and sole visible.
- Wide-leg denim with boots: the entire boot shaft is hidden. Only the very toe of the boot shows.`,

  jackets: `CRITICAL — BODY SHAPE & FIT:
- The model should have natural body proportions visible under the jacket.
- Shoulders should match the jacket's structure.
- The jacket should show natural body movement and drape, not hang stiffly.
- Keep it natural and editorial — real body in well-constructed outerwear.
- For zip jackets: the zip goes ALL THE WAY from hem to collar — this is design-critical (Learning #33).
- PROPORTION WARNING: The jacket must NOT make the model look stocky or wide at the hips. The jacket hem sits at or slightly below the natural waist — the hip line below should be NARROWER than the jacket shoulders, creating a lean V-taper silhouette. A bomber jacket should NOT balloon or flare at the hem to make the model look pear-shaped or chubby.`,

  default: `CRITICAL — BODY SHAPE:
- Natural body proportions visible under the garment.
- Clothing should drape naturally, not stiffly.
- Keep it natural and editorial.`,
};

// Floor-length override rules (Learning #31)
export const FLOOR_LENGTH_RULES = `CRITICAL — FLOOR-LENGTH HEM OVERRIDE (Learning #31):
- IGNORE the mannequin's hem height — the mannequin has a RAISED STAND
- The denim hem sits ON TOP OF the shoe, resting on it
- You should only see the sole of the shoe and maybe 5mm of the toe cap
- The shoe is 90% hidden by denim
- Like wearing jeans that are intentionally too long — the hem breaks heavily on the shoe
- Floor-length means: hems nearly scraping the ground, shoes almost invisible under denim
- NOT ankle-length, NOT 1cm above floor. ON the floor.`;

// Ankle-length override rules (Learning #35)
export const ANKLE_LENGTH_RULES = `CRITICAL — ANKLE-LENGTH HEM PRECISION (Learning #35):
- ANKLE-LENGTH — the hem ends AT the ankle, showing the FULL SHOE
- This is NOT floor-length — there should be clear space between hem and floor
- The shoe is FULLY VISIBLE below the hem
- Do NOT make these floor-length — that is the WRONG look`;

// ── G-STAR ECOM GUIDELINES (Feb 2026) — Posing, Styling, Footwear ──

// Gender-aware posing rules from official G-Star photography guidelines
export function getEcomPosingRules(gender: 'male' | 'female', garmentCategory: string): string {
  const cat = garmentCategory.toLowerCase();
  const isBottoms = ['pants', 'jeans', 'shorts', 'skirt', 'trousers'].includes(cat);

  if (gender === 'female') {
    return `G-STAR WOMEN'S POSING (ECOM STANDARD):
- Add FEMININITY: slight hip tilt to one side, soft bend in one knee, weight on one leg
- Hands: relaxed at sides or one hand lightly touching hip/thigh — NOT stiff, NOT military
- ${isBottoms ? 'For bottoms: one thumb can hook a belt loop or pocket edge for a natural look' : 'Shoulders relaxed, natural posture showing garment drape'}
- Body angle: slight 3/4 turn (not dead-on flat) to show body shape and garment fit
- CONFIDENCE + WARMTH: the pose should feel relaxed and feminine, not rigid or confrontational
- Feet: one foot slightly forward, weight shifted — NOT parallel feet, NOT at attention`;
  }

  // Male
  if (isBottoms) {
    return `G-STAR MEN'S POSING — BOTTOMS (ECOM STANDARD):
- Relaxed masculine stance: feet shoulder-width, slight weight shift to one side
- Hands: thumbs hooked in front pockets OR one hand behind/in back pocket — natural, NOT forced
- Body: slight 3/4 angle to show denim 3D construction and body shape
- NOT rigid military stance — think "editorial between shots" — relaxed but intentional
- Shoulders square, chin slightly up, confident but approachable`;
  }
  return `G-STAR MEN'S POSING (ECOM STANDARD):
- Natural masculine stance: relaxed shoulders, slight weight shift
- Arms naturally at sides or hands lightly in pockets
- Body: slight 3/4 angle preferred over dead-on flat front
- Confident, relaxed energy — not stiff, not aggressive`;
}

// Footwear matrix — maps fit type × gender to recommended shoe type
// From G-Star ECOM guidelines footwear decision tree
export function getEcomFootwear(gender: 'male' | 'female', fitDescription: string): string {
  const fit = (fitDescription || '').toLowerCase();

  if (gender === 'female') {
    // Women: ALWAYS heels or flat leather shoes. NEVER sneakers for bottoms.
    if (fit.includes('slim') || fit.includes('skinny') || fit.includes('straight')) {
      return `FOOTWEAR (ECOM MATRIX — WOMEN ${fit.toUpperCase()}): Pointed-toe heels or sleek ankle boots.
CRITICAL: Women's jeans shots NEVER use sneakers. Only heels or flat leather shoes.`;
    }
    if (fit.includes('flare') || fit.includes('bootcut')) {
      return `FOOTWEAR (ECOM MATRIX — WOMEN FLARE/BOOTCUT): Platform heels or heeled boots that add height. The flare should drape over the shoe.
CRITICAL: Women's jeans shots NEVER use sneakers. Only heels or flat leather shoes.`;
    }
    if (fit.includes('loose') || fit.includes('barrel') || fit.includes('boyfriend') || fit.includes('wide')) {
      return `FOOTWEAR (ECOM MATRIX — WOMEN LOOSE/WIDE): Flat leather sandals or minimal flat leather shoes. Clean, minimal.
CRITICAL: Women's jeans shots NEVER use sneakers. Only heels or flat leather shoes.`;
    }
    // Default women
    return `FOOTWEAR (ECOM — WOMEN DEFAULT): Heels or flat leather shoes.
CRITICAL: Women's jeans shots NEVER use sneakers. Only heels or flat leather shoes.`;
  }

  // Male footwear matrix
  if (fit.includes('slim') || fit.includes('skinny') || fit.includes('tapered')) {
    return `FOOTWEAR (ECOM MATRIX — MEN SLIM/TAPERED): Leather boots — Chelsea boots, lace-up boots, or dress boots. Clean, slim-profile footwear matching the lean silhouette.`;
  }
  if (fit.includes('straight') || fit.includes('regular')) {
    return `FOOTWEAR (ECOM MATRIX — MEN STRAIGHT/REGULAR): Leather dress shoes or clean Derby/Oxford shoes. Classic, structured footwear.`;
  }
  if (fit.includes('loose') || fit.includes('relaxed') || fit.includes('wide') || fit.includes('barrel')) {
    return `FOOTWEAR (ECOM MATRIX — MEN LOOSE/RELAXED): Clean white sneakers or chunky casual sneakers. Relaxed footwear matching the loose silhouette.`;
  }
  // Default men
  return `FOOTWEAR (ECOM — MEN DEFAULT): Clean leather boots or dress shoes. Classic, matches denim.`;
}

// Top/styling rules for bottoms shoots — from ECOM guidelines
export function getEcomStylingTop(gender: 'male' | 'female'): string {
  if (gender === 'female') {
    return `STYLING TOP (ECOM STANDARD): Simple fitted top in a NEUTRAL color — white, off-white, beige, light grey, or black ONLY. No prints, no stripes, no bright colors, no logos. The top MUST be TUCKED INTO the jeans showing the full waistband, belt loops, and button/fly. The jeans waistband is the hero — it must be fully visible. A cropped fitted top that ends at the waist is also acceptable as long as the waistband is visible.`;
  }
  return `STYLING TOP (ECOM STANDARD): Simple fitted t-shirt or top in a NEUTRAL color — white, off-white, beige, light grey, or black ONLY. No prints, no stripes, no bright colors, no logos. The top MUST be TUCKED INTO the jeans showing the full waistband, belt loops, and button/fly. The waistband is the hero — it must be fully visible.`;
}

// ECOM no-go rules
export const ECOM_NO_GOS = `ECOM NO-GO RULES (STRICT):
- NO logos, NO branding, NO text, NO watermarks anywhere in the image — not on clothing, not on the background, not in corners. The image must be completely clean and unbranded.
- NO sneakers on women for any bottoms/jeans shot — heels or flat leather ONLY
- NO caps or sunglasses combined with shirts/tops
- NO matching color sets (top and bottom same color creating a "suit" look)
- NO too-tonal styling (everything same shade — needs contrast between top and bottom)
- NO bright/neon/printed tops for bottoms shoots — neutral basics ONLY
- NO visible underwear, bra straps, or undergarments above the waistband`;

// Shots that require CROPPED framing (waist-to-ankle, no head)
const CROPPED_SHOT_TYPES = new Set(['M01', 'M02']);
// Detail shots (close-up on garment construction — back pocket/bum area)
const DETAIL_SHOT_TYPES = new Set(['M05']);

export function buildGenerationPrompt(params: {
  modelDescription: string;
  garmentDescription: string;
  shotDescription: string;
  garmentCategory: string;
  metadata: Record<string, string>;
  modifications?: string[];
  productCritical?: string;
  shotType?: string;
  gender?: 'male' | 'female';
}): string {
  const { modelDescription, garmentDescription, shotDescription, garmentCategory, metadata, modifications, productCritical, shotType, gender } = params;

  const bodyRules = BODY_SHAPE_RULES[garmentCategory as keyof typeof BODY_SHAPE_RULES] || BODY_SHAPE_RULES.default;

  let metadataStr = '';
  if (metadata.waistHeight) metadataStr += `\nWaist height: ${metadata.waistHeight}.`;
  if (metadata.waistHeight === 'low') {
    metadataStr += `\nLOW-RISE WAISTBAND RULE (CRITICAL): These are low-rise jeans. The waistband sits LOW on the hip. The jeans waistband is the TOPMOST visible garment at the hip. NO underwear waistband, NO boxer brief elastic, NO undergarment of any kind should be visible above the jeans waistband. If the jeans waistband is low, show bare skin above it — not underwear. Any visible underwear waistband above the jeans is a critical failure.`;
  }
  if (metadata.fitDescription) metadataStr += `\nFit: ${metadata.fitDescription}.`;

  // Floor distance determines hem rules (Learning #31, #35)
  let hemRules = '';
  const floorDist = metadata.floorDistance;
  if (floorDist === '0' || floorDist === '0 - touching') {
    hemRules = `\n${FLOOR_LENGTH_RULES}`;
    metadataStr += `\nHem: FLOOR-LENGTH — hems touch/nearly touch the ground.`;
  } else if (floorDist) {
    hemRules = `\n${ANKLE_LENGTH_RULES}`;
    metadataStr += `\nHem distance to floor: ${floorDist}.`;
  }

  let modStr = '';
  if (modifications?.length) {
    modStr = `\n\nADDITIONAL MODIFICATIONS (apply these adjustments):\n${modifications.map((m, i) => `${i + 1}. ${m}`).join('\n')}`;
  }

  let productStr = '';
  if (productCritical) {
    productStr = `\n\nPRODUCT-SPECIFIC CRITICAL RULES:\n${productCritical}`;
  }

  return [
    `Generate a fashion editorial photograph for G-Star RAW e-commerce.`,
    `\nIMPORTANT: The garment reference images above are the SINGLE SOURCE OF TRUTH. The model wears THIS SPECIFIC GARMENT — reproduce every detail exactly: fabric, color, fit, seams, pockets, closures, stitching. Every element in the output must trace back to a reference image.`,
    `\nGARMENT WIDTH/FIT — CRITICAL: The FLAT IMAGE shows the TRUE width and silhouette of this garment. If the flat image shows WIDE legs, the generated image MUST show WIDE legs. If it shows a BAGGY/LOOSE fit, it MUST be BAGGY/LOOSE on the model — NOT skinny, NOT fitted, NOT tapered. The flat image is the DEFINITIVE reference for garment width and shape. A boyfriend/barrel/wide-leg jean that appears skinny on the model is a CRITICAL FAILURE. Match the width ratio visible in the flat image.`,
    `\nFABRIC COLOR — CRITICAL (Learning #44): The color/wash of the garment is defined by the mannequin reference images ONLY. Do NOT shift, lighten, darken, or reinterpret the color. If the mannequin shows dark indigo denim, render dark indigo. If it shows light grey, render light grey. Match the exact shade and wash as photographed. The text description is secondary — the images are the truth.`,
    `\nIMAGE-DRIVEN GENERATION (Learning #1 — THE #1 LESSON):`,
    `The reference images ARE the specification. Minimize reliance on text description.`,
    `Copy EXACTLY what you see in the images. DO NOT describe garment hardware in text — let the images specify buttons, zips, rivets, labels.`,
    `\nMODEL: ${modelDescription}`,
    `\nGARMENT (text supplements reference images): ${garmentDescription}${metadataStr}`,
    `\nPOSE & FRAMING: ${shotDescription}`,
    CROPPED_SHOT_TYPES.has(shotType || '')
      ? `CRITICAL FRAMING — THIS IS A CROPPED PRODUCT SHOT, NOT A PORTRAIT:
The camera is positioned at WAIST HEIGHT and frames ONLY the lower half of the body.
WHAT IS VISIBLE: waistband → legs → feet/shoes. That is ALL.
WHAT IS NOT VISIBLE: head, face, shoulders, chest, arms — they are ABOVE the camera frame and do not appear.
Imagine a photographer kneeling and photographing only from the waist down. The head is cut off by the top of the frame.
The garment (jeans/pants) fills the full height of the image from waistband to ankle.
If a head appears in this image it is a critical failure.

CRITICAL — TOP OF FRAME POSITION:
The TOP EDGE of the image MUST show the WAISTBAND of the jeans/pants. The waistband button must be visible at or near the top of the frame. If the image starts at mid-thigh or below the waistband, the framing is WRONG — the waistband MUST be visible. The top 5-10% of the image should show the waistband area, belt loops, and possibly a sliver of the shirt/jacket hem above it.

CRITICAL — LEAN BODY PROPORTIONS FOR CROPPED SHOTS:
The model is a LEAN, ATHLETIC fashion model — NOT stocky, NOT heavyset, NOT chubby.
- Hip width must be NARROW — this is a slim fashion model, not a regular person.
- The waist-to-hip transition must be smooth and slim. NO wide hips. NO pear shape.
- If a jacket or top is partially visible at the top of the frame, it should NOT make the model look wider or bulkier.
- The jacket hem should hug the body — NOT balloon outward at the hip line.
- Thighs should be lean and proportional to a tall, slim model (175-185cm, athletic build).
- Think runway model proportions: narrow hips, long legs, lean silhouette.
- If in doubt, make the model SLIMMER rather than wider. An overly wide hip/bottom is a critical failure for fashion e-commerce.`
      : `Full body visible from top of head to shoes/feet.`,
    `BACKGROUND — STRICT RULE: Clean warm light grey (#D5D3CC) studio backdrop — uniform, consistent, same tone everywhere. NO dark corners, NO dark patches, NO visible gradient, NO vignetting. ONE very soft, subtle floor shadow — barely visible, NOT dramatic. NO extra lighting on the ground, NO rim lights, NO backlighting.`,
    CROPPED_SHOT_TYPES.has(shotType || '')
      ? `\nCROPPED SHOT — HEAD/FACE RULES SUPPRESSED: This is a waist-to-ankle product shot. No head, face, or expression rules apply. Focus only on: leg proportions, fabric drape, garment fit, and shoe style.\nCROPPED SHOT FOOT SIZE WARNING: In cropped shots the feet are highly visible and prominent. AI ALWAYS makes feet too large in cropped shots. Actively SHRINK feet — foot width must be ≤ ankle width. Sandals must not look oversized. If the dressed base reference shows large feet/sandals, CORRECT them to natural proportions.`
      : `\n${ANTI_AI_RULES}`,
    `\n${bodyRules}`,
    hemRules,
    `\n${ANTI_HALLUCINATION}`,
    `\nHARDWARE COLOR (Learning #37): Snap buttons, rivets, and zip pulls match the EXACT color shown in the mannequin reference. Dark hardware stays dark. Silver stays silver. Match the reference precisely.`,
    // G-Star ECOM Guidelines injection (gender-aware when available)
    gender ? `\n${getEcomPosingRules(gender, garmentCategory)}` : '',
    gender && metadata.fitDescription ? `\n${getEcomFootwear(gender, metadata.fitDescription)}` : '',
    gender && ['pants', 'jeans', 'shorts', 'skirt', 'trousers'].includes(garmentCategory.toLowerCase()) ? `\n${getEcomStylingTop(gender)}` : '',
    `\n${ECOM_NO_GOS}`,
    productStr,
    modStr,
  ].filter(Boolean).join('\n');
}

// ── Reference Image Labels (Learning #28 feed order) ──
export const REF_LABELS = {
  modelCard: 'MODEL IDENTITY REFERENCE. The person in the generated image MUST be this exact same person — same face, same features, same body type, same skin tone.',
  flatImage: 'GARMENT FLAT IMAGE — #1 reference for width and proportions. This shows the TRUE garment width without mannequin distortion. Reproduce this width/fit EXACTLY.',
  mannequinFront: 'GARMENT ON MANNEQUIN (front view). Copy every visible detail: seams, pockets, hardware, stitching.',
  mannequinSide: 'GARMENT ON MANNEQUIN (side view). Shows 3D construction and sculptured seat shape.',
  mannequinBack: 'GARMENT ON MANNEQUIN (back view). The BACK PANEL is PLAIN unless shown otherwise here.',
  zoneGrid: (zone: string, n: number, total: number) =>
    `CONSTRUCTION DETAIL GRID ${n}/${total}: ${zone} zone from multiple angles. Copy seam patterns, hardware, and trim EXACTLY as shown.`,
} as const;

// ── QC Prompt v4 — 4 focused dimensions (added construction fidelity for seams, labels, details) ──
export function buildQCPrompt(params: {
  shotType: string;
  garmentCategory: string;
  garmentDescription: string;
  metadata: Record<string, string>;
  wardrobeDescriptions?: string[];
}): string {
  const { shotType, garmentCategory, garmentDescription, metadata } = params;
  const floorDist = metadata.floorDistance || '';
  const isFloorLength = floorDist === '0' || floorDist === '0 - touching' || floorDist === 'floor';
  const isCropped = shotType === 'M01' || shotType === 'M02';

  return `You are a Quality Control auditor for G-Star RAW AI-generated e-commerce photography.
Compare the AI-generated image against the reference images. Score ONLY these 4 dimensions.

GARMENT: ${garmentDescription}
CATEGORY: ${garmentCategory}
SHOT TYPE: ${shotType}${isCropped ? ' (CROPPED — waist to ankle)' : ''}

SCORE THESE 4 DIMENSIONS (1-10 each, with a short note):

1. COLOR MATCH — Is the garment color/wash matching the original mannequin reference?
   - Compare against the FRONT MANNEQUIN image (COLOR ANCHOR) — exact shade, wash intensity, fading pattern.
   - Slightly off = 6-7. Completely wrong color = 1-4. Perfect match = 8-10.

2. WAIST HEIGHT — Is the waistband sitting at the correct height on the body?
   - Compare waist position against fit model photos (if provided) or mannequin references.
   - The rise (low/mid/high) must match the original garment. Wrong rise = 1-4.
   - Score 8-10 if waistband height looks correct relative to body proportions.

3. GARMENT LENGTH — Is the hem length correct compared to the fit model / mannequin?
   - Check where the hem falls: ankle, floor, mid-calf, above-knee — must match reference.
   ${isFloorLength ? '- FLOOR-LENGTH: Hems MUST touch ground. Shoes 90% hidden.' : ''}
   - Too long or too short vs reference = 4-6. Way off = 1-3. Correct = 8-10.

4. CONSTRUCTION FIDELITY — Are construction details preserved from the reference images?
   - Check: seam lines (especially knee articulation seams, side seams), pocket shape and placement, topstitching patterns.
   - Check: labels/patches — leather back patch, woven side labels, any branded tabs visible in references MUST appear in the AI image.
   - Check: hardware — rivets, buttons, zip pulls must match reference.
   - Check: leg shape/silhouette — if the reference shows a barrel/wide/tapered/flared leg, the AI image must match that exact shape.
   - Missing knee seams or construction details = 4-6. Missing labels/patches = 3-5. Smoothed-over details everywhere = 1-3. All details preserved = 8-10.

RESPOND IN EXACT JSON (no markdown, no backticks):
{"color_match":{"score":0,"note":""},"waist_height":{"score":0,"note":""},"garment_length":{"score":0,"note":""},"construction_fidelity":{"score":0,"note":""},"weighted_score":0,"pass":false,"critical_issues":[],"summary":""}

weighted_score = (color_match + waist_height + garment_length + construction_fidelity) / 4
pass = true if weighted_score >= 7.0 AND no dimension below 4`;
}

// ── Label QC Prompt (Learning #42) ──
export function buildLabelQCPrompt(): string {
  return `You are a label/branding QC expert for G-Star RAW.
Compare AI image against ALL mannequin reference images.

1. Inventory EVERY label/patch/tab on the REAL garment (from mannequin photos)
2. Inventory EVERY label/patch/tab in the AI image
3. Flag any in AI that doesn't exist on the real garment

COMMON HALLUCINATIONS: leather back patches, paper waistband labels, wrong patch styles, invented front tabs.

RESPOND IN JSON (no markdown):
{"real_labels":[],"ai_labels":[],"invented_labels":[],"label_score":0,"pass":true}
Score: 10=clean, 4-6=one invented, 1-3=multiple invented. pass=true if score>=7`;
}

// ── Zone Grid Definitions — CALIBRATED from strip analysis on 8256×5504 mannequin images ──
// After 90° CW rotation to vertical (~5504×8256), Y-axis maps as:
//   0.00-0.30 = mannequin rod + upper torso (above garment)
//   0.38-0.55 = HIP ZONE (waistband, button, pockets, fly, rivets)
//   0.50-0.70 = KNEE ZONE (mid-thigh through knee, seam construction)
//   0.68-0.85 = ANKLE ZONE (below knee, cuffs, hem)
//   0.85-1.00 = mannequin stand (ignore)
// Previous values (0.0-0.35 for hip) were cropping mannequin torso, not garment.
export const ZONE_DEFS = {
  pants: {
    hip:   { y1: 0.38, y2: 0.55, x1: 0.15, x2: 0.85, angles: [0, 1, 2, 4], name: 'Hip Zone — waistband, pockets, rivets, topstitching' },
    knee:  { y1: 0.50, y2: 0.70, x1: 0.15, x2: 0.85, angles: [0, 1, 2, 4], name: 'Knee Zone — thigh to knee, seam construction' },
    ankle: { y1: 0.68, y2: 0.85, x1: 0.15, x2: 0.85, angles: [0, 1, 2, 4], name: 'Ankle Zone — hem, cuffs, leg opening' },
    back:  { y1: 0.38, y2: 0.55, x1: 0.15, x2: 0.85, angles: [3, 4, 5], name: 'Back Hip Zone — back pockets, yoke, labels' },
  },
  jackets: {
    collar:   { y1: 0.0, y2: 0.2, x1: 0.15, x2: 0.85, angles: [0, 1, 6], name: 'Collar Zone' },
    chest:    { y1: 0.15, y2: 0.5, x1: 0.15, x2: 0.85, angles: [0, 1, 6, 9], name: 'Chest Zone' },
    sleeve:   { y1: 0.2, y2: 0.6, x1: 0.0, x2: 0.4, angles: [3, 9], name: 'Sleeve Zone' },
    back:     { y1: 0.0, y2: 0.5, x1: 0.15, x2: 0.85, angles: [5, 6, 7], name: 'Back Zone' },
  },
  default: {
    upper: { y1: 0.0, y2: 0.4, x1: 0.15, x2: 0.85, angles: [0, 1, 6], name: 'Upper Zone' },
    lower: { y1: 0.4, y2: 1.0, x1: 0.15, x2: 0.85, angles: [0, 1, 6], name: 'Lower Zone' },
  },
} as const;
