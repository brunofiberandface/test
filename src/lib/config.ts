// ── App Configuration — v2 Pro Pipeline ──

export const APP_CONFIG = {
  name: 'G-Star AI Studio',
  description: 'AI-powered model shot generation for G-Star RAW',

  // Auth
  allowedDomain: 'gstar-raw.com',
  otpExpiryMinutes: 5,
  trustedBrowserDays: 30,

  // Generation — v2 Pro pipeline
  generationModel: 'gemini-3-pro-image-preview',
  analysisModel: 'gemini-2.5-flash-lite',
  defaultAspectRatio: '3:4' as const,
  detailAspectRatio: '3:4' as const,
  imageSize: '4K' as const,

  // Shot types
  shotTypes: ['M01', 'M02', 'M03', 'M04', 'M05', 'M06'] as const,

  // Shot dependency chain
  // M03 first → M04 (needs M03) → M01 (crops M03) + M02 (crops M04) → M05 (needs M03 + M04) → M06 (independent free pose, runs after the e-comm hero set)
  shotOrder: ['M03', 'M04', 'M01', 'M02', 'M05', 'M06'] as const,

  // Shot metadata
  shots: {
    // Aspect 1:1 (square) per G-Star brand spec — matches the gstar.com reference
    // images (e.g. 3301-regular-tapered 2000×2000 native square renders). Native
    // generation at 1:1 → upscale to 4000×4000 in the generate route. Switched
    // May 1 2026 from '3:4'.
    M01: { name: 'Cropped Front', aspect: '1:1' as const, dependsOn: ['M03'] as const, view: 'front' as const },
    M02: { name: 'Cropped Back', aspect: '1:1' as const, dependsOn: ['M04'] as const, view: 'back' as const },
    M03: { name: 'Full Body Front', aspect: '1:1' as const, dependsOn: [] as const, view: 'front' as const },
    // M04 deps were ['M03'] historically (stale — M04 generation never read m03AnchorUrl).
    // Dropped Apr 30 2026 along with the per-shot parallel refactor so M03+M04+M06
    // can all run from T=0 in parallel. Both shots share the same model identity refs
    // so identity drift is not a concern.
    M04: { name: 'Full Body Back', aspect: '1:1' as const, dependsOn: [] as const, view: 'back' as const },
    M05: { name: 'Pocket Detail', aspect: '1:1' as const, dependsOn: ['M03', 'M04'] as const, view: 'back' as const },
    M06: { name: 'Free Pose', aspect: '1:1' as const, dependsOn: [] as const, view: 'front' as const },
  },

  // Image preprocessing
  maxDimGeneration: 2000,    // max px for generation input images
  maxDimAnalysis: 1200,      // max px for silhouette analysis input images
  jpegQuality: 90,

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
// build: 1776240122
// build: 1776241977
// build: 1776243836
// build: 1776254278
// build: 1776344339
