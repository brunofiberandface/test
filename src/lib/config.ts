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
  defaultAspectRatio: '9:16' as const,
  detailAspectRatio: '3:4' as const,
  imageSize: '4K' as const,

  // Shot types
  shotTypes: ['M01', 'M02', 'M03', 'M04', 'M05'] as const,

  // Shot dependency chain
  // M03 first → M04 (needs M03) → M01 (needs M03) + M02 (needs M04) → M05 (needs M03 + M04)
  shotOrder: ['M03', 'M04', 'M01', 'M02', 'M05'] as const,

  // Shot metadata
  shots: {
    M01: { name: 'Cropped Front', aspect: '9:16' as const, dependsOn: ['M03'] as const, view: 'front' as const },
    M02: { name: 'Cropped Back', aspect: '9:16' as const, dependsOn: ['M04'] as const, view: 'back' as const },
    M03: { name: 'Full Body Front', aspect: '9:16' as const, dependsOn: [] as const, view: 'front' as const },
    M04: { name: 'Full Body Back', aspect: '9:16' as const, dependsOn: ['M03'] as const, view: 'back' as const },
    M05: { name: 'Pocket Detail', aspect: '3:4' as const, dependsOn: ['M03', 'M04'] as const, view: 'back' as const },
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
