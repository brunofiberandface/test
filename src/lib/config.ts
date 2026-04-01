// ── App Configuration ──

export const APP_CONFIG = {
  name: 'G-Star AI Studio',
  description: 'AI-powered model shot generation for G-Star RAW',

  // Auth
  allowedDomain: 'gstar-raw.com',
  otpExpiryMinutes: 5,
  trustedBrowserDays: 30,

  // Generation
  geminiModel: 'gemini-3.1-flash-image-preview',
  imageAspectRatio: '3:4' as const,
  imageSize: '2K' as const,
  imageWidth: 1792,
  imageHeight: 2400,

  // Shot types
  shotTypes: ['M01', 'M02', 'M03', 'M04', 'M05'] as const,
  m03Variants: ['A'] as const, // Single full-body front variant

  // Drive
  driveRootFolder: 'G-Star AI Studio',

  // Branding
  colors: {
    black: '#000000',
    nearBlack: '#1A1A1A',
    darkGray: '#333333',
    medGray: '#4B555E',
    lightGray: '#CCCCCC',
    offWhite: '#F5F5F5',
    white: '#FFFFFF',
  },
} as const;

// Shot descriptions for prompt assembly
// 5 shots: M01 cropped front, M02 cropped back, M03 full body front, M04 full body back, M05 detail (back pocket/bum)
export const SHOT_DESCRIPTIONS: Record<string, string> = {
  M01: 'CROPPED FRONT — camera at WAIST LEVEL. Frame starts above the waistband (belt loops visible) and ends just below ankle. HEAD, FACE, UPPER TORSO completely outside frame. Only waistband → legs → feet visible. Front-facing stance, arms at sides. PANTS OVER SHOES: pant leg drapes OVER shoe. BODY: LEAN, ATHLETIC — narrow hips, slim thighs, long legs. NOT stocky.',
  M02: 'CROPPED BACK — camera at WAIST LEVEL, BACK VIEW. Frame starts above the waistband and ends just below ankle. HEAD, FACE, UPPER TORSO completely outside frame. Only waistband → legs → feet visible from behind. PANTS OVER SHOES: pant leg drapes OVER shoe. DO NOT add jacket/coat/hoodie — upper body is outside frame. BODY: LEAN, ATHLETIC — narrow hips, long legs. BACK POCKET PROPORTIONS — MEASURE FROM REFERENCE: Pocket length varies per design. MEASURE the pocket height relative to the waistband-to-crotch distance in the reference photos and reproduce that EXACT ratio. Do NOT default to standard short pockets when the reference shows longer ones.',
  M03: 'FULL BODY — head to toe visible. FRONT-FACING. Model looks directly into camera. Arms relaxed at sides. Feet hip-width, equal weight, confident neutral stance. PANTS OVER SHOES: pant leg falls ON TOP of shoe.',
  M04: 'FULL BODY — head to toe visible. BACK VIEW — model faces away from camera. Natural confident stance. PANTS OVER SHOES: pant leg falls ON TOP of shoe.',
  M05: 'DETAIL SHOT — TIGHT CLOSE-UP of BACK POCKET area on a real person wearing the jeans. Camera at hip height, ~40cm away. Frame: from just above the back waistband to mid-thigh ONLY. Show ONE back pocket filling most of the frame. Slight 3/4 rear angle so the pocket shape and seat construction are three-dimensional. This is PRODUCT PHOTOGRAPHY — like a detail zoom on a product page. ACCURACY IS SACRED: reproduce the pocket EXACTLY as it appears in the reference photos. The pocket stitching pattern, arc shape, rivets, and denim texture must match the references precisely. Do NOT invent, add, or hallucinate ANY details not visible in the references — no extra stitch lines, no horizontal lines across the pocket, no extra creases, no labels, no patches, no branding. If the reference pocket has a clean curved arc stitch and nothing else, the output must show ONLY that curved arc stitch and nothing else. Every stitch line in the output must have a matching stitch line in the reference. POCKET PROPORTIONS — MEASURE FROM REFERENCE: Pocket length varies per design. MEASURE the pocket height relative to the waistband-to-crotch distance in the reference photos and reproduce that EXACT ratio. Do NOT shorten or compact the pocket compared to the reference.',
};
