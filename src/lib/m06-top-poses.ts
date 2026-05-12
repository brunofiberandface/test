/**
 * M06 TOP-FOCUS pose library — 5 canonical poses for when the wardrobe focus
 * is the TOP garment (jacket, shirt, tee, tank, etc.).
 *
 * Source: G-Star "tops women.pdf" slide 2 — POSE TOPS / RELAXED FEMININE MOVEMENT
 * (STRAIGHT FRONT POSE). All 5 stances share the slide's bullet guidance:
 *   • Stand tall, shoulders relaxed, head up, eyes on the camera.
 *   • Body always front facing camera.
 *   • Arms at sides, or one/both hands in pockets, minimal movement.
 *   • Keep fingers soft, posture firm but casual.
 *   • Expression relaxed, confident, with energy through the eyes.
 *
 * The 5 poses below correspond 1:1 to the 5 reference models in the slide
 * (left → right). Each pose isolates a distinct hand-placement / weight-shift
 * variation that the team has approved for top-focus product photography.
 *
 * t01 → leftmost model (grey crewneck tee, hands at sides, symmetric)
 * t02 → 2nd model (brown cropped button shirt, subtle weight shift)
 * t03 → 3rd model (beige ribbed tank, BOTH hands in front pockets w/ thumbs)
 * t04 → 4th model (brown bomber, ONE hand in pocket / other at side)
 * t05 → 5th model (oversized denim chore jacket, BOTH hands deep in pockets)
 *
 * Format matches src/lib/m06-poses.ts (canonical M06 pose vocabulary).
 * Used ONLY when ctx.focusSlot === 'top' on the parent job — bottom-focus
 * M06 still draws from M06_POSES (p01-p11).
 */

const GCS_BASE = 'https://storage.googleapis.com/gstar-ai-studio-assets/m06-top-poses';

export interface M06TopPose {
  id: string;
  label: string;          // 3 words max — shown under thumbnail
  thumbnailUrl: string;   // full slide thumb — shown in dashboard picker
  /** Body-only crop (head removed) — used as IMAGE 1 (pose ref) in Gemini.
   *  Eliminates identity bleed from the slide model's face/hair while
   *  preserving the body-language signal. */
  bodyOnlyUrl: string;
  /** Hip+arm zoom crop — used as IMAGE 1B for poses where the failure mode
   *  is "hands default to pockets" (t01, t02). Pattern mirrors the p08
   *  POSE_CROP_PATHS workaround in replay-m06-gemini.ts. */
  handcropUrl?: string;
  description: string;    // full pose block — injected into prompt
  /** When true, hidden from picker but resolvable via getM06TopPose(id). */
  hidden?: boolean;
}

export const M06_TOP_POSES: M06TopPose[] = [
  {
    id: 't01',
    label: 'Hands at sides',
    thumbnailUrl: `${GCS_BASE}/top-pose-01-thumb.png`,
    bodyOnlyUrl: `${GCS_BASE}/top-pose-01-body.png`,
    handcropUrl: `${GCS_BASE}/top-pose-01-handcrop.png`,
    description: `STRAIGHT FRONT POSE — top-focus stance #1 of 5 (symmetric default).

═══ HAND PLACEMENT — ABSOLUTE, NON-NEGOTIABLE ═══
BOTH HANDS HANG FREELY AT THE SIDES OF THE BODY. NEITHER HAND IS IN ANY POCKET. NEITHER HAND TOUCHES ANY POCKET. THE FRONT POCKETS OF THE JEANS ARE EMPTY. THE BACK POCKETS ARE EMPTY. ZERO POCKET CONTACT.

Both hands are FULLY VISIBLE in front of the camera at hip / upper-thigh level. Fingers are visible — not hidden, not tucked, not pocketed. The visual signature: a straight vertical arm line from each shoulder, down past the elbow, ending at a visible hand near the hip. NO thumb in a pocket, NO knuckles in a pocket, NO fingers in a pocket. Hands HANG. Hands DROP. Hands DANGLE.

If the rendered output shows a hand inside a pocket, a thumb hooked over a pocket edge, or a wrist tucked behind a pocket opening, the render is WRONG and must be discarded. The pose ref IMAGE 1 clearly shows BOTH HANDS HANGING DOWN — match that hand-down-at-side silhouette literally.

═══ BODY ═══
The model stands FULLY FRONT-FACING, body squared directly to the camera with no rotation, no diagonal lean, and no three-quarter turn. Both shoulders are visible from the front at equal depth. The chest is open and faces the lens.

BOTH arms hang loose at the sides of the body, with a very slight natural bend at the elbows — the arms are NOT pressed flat against the torso, but follow the body's contour with a small natural gap at the elbow. Both hands are VISIBLE at hip level (or just above the upper-thigh), fingers SOFT and slightly curled, palms turned slightly toward the body. No clenching, no pointing, no rigid wrists — the hands read as completely at rest.

Shoulders are RELAXED and LEVEL — not pulled back into a military stance, not slumped. A very subtle forward roll keeps the posture firm-but-casual.

Weight is distributed roughly EVENLY across both feet. Feet are placed approximately hip-width apart, pointing forward or with a very slight outward angle. No contrapposto, no hip tilt — the pose reads as symmetric, planted, and grounded.

The HEAD is held LEVEL, chin neutral (neither raised nor tucked). The eyes are DIRECTED STRAIGHT INTO THE LENS — calm, confident, with quiet energy through the eyes. The expression is relaxed and unsmiling — composed without being cold.

Overall energy: clean, symmetric, neutral default. The garment is the hero — the body acts as a still vertical frame that lets the top read clearly without competing visual interest. Captured as if the model is at ease between takes, not actively posing. CRITICAL silhouette signature: arms hang DOWN, hands VISIBLE at the sides, no pocket interaction whatsoever.`,
  },
  {
    id: 't02',
    label: 'Relaxed asymmetric',
    thumbnailUrl: `${GCS_BASE}/top-pose-02-thumb.png`,
    bodyOnlyUrl: `${GCS_BASE}/top-pose-02-body.png`,
    handcropUrl: `${GCS_BASE}/top-pose-02-handcrop.png`,
    description: `STRAIGHT FRONT POSE — top-focus stance #2 of 5 (subtle asymmetry).

═══ HAND PLACEMENT — ABSOLUTE, NON-NEGOTIABLE ═══
BOTH HANDS HANG FREELY AT THE SIDES OF THE BODY. NEITHER HAND IS IN ANY POCKET. NEITHER HAND TOUCHES ANY POCKET. THE FRONT POCKETS OF THE JEANS ARE EMPTY. THE BACK POCKETS ARE EMPTY. ZERO POCKET CONTACT.

Both hands are FULLY VISIBLE in front of the camera at hip / upper-thigh level. Fingers visible — not hidden, not tucked, not pocketed. The visual signature: a straight vertical arm line from each shoulder, down past the elbow, ending at a visible hand near the hip. NO thumb in a pocket, NO knuckles in a pocket, NO fingers in a pocket. Hands HANG. Hands DROP. Hands DANGLE.

If the rendered output shows a hand inside a pocket, a thumb hooked over a pocket edge, or a wrist tucked behind a pocket opening, the render is WRONG and must be discarded. The pose ref IMAGE 1 clearly shows BOTH HANDS HANGING DOWN with a soft natural drape and slight asymmetry — match that hand-down-at-side silhouette literally.

═══ BODY ═══
The model stands FRONT-FACING — body squared to the camera with at most a very faint diagonal shift (under 10° off-square). Both shoulders are visible from the front. The chest faces the lens.

BOTH arms hang at the sides of the body with a soft natural drape — slightly looser than a perfect mirror. There is a small natural ASYMMETRY between the two arms: one wrist sits a touch forward of the other, or one elbow falls a hair closer to the body. Neither arm is in a pocket. Both hands are VISIBLE at hip level (or just above the upper-thigh), fingers SOFT, palms turned softly toward the body.

Shoulders are RELAXED and approximately level — one shoulder may sit a hair lower than the other in keeping with the weight shift, but no exaggerated tilt.

Weight is SLIGHTLY favored on one leg, creating a very subtle hip tilt to one side. The other leg is relaxed with a small bend at the knee. Feet are roughly hip-width apart, the weight-bearing foot planted flat, the opposite foot soft.

The HEAD is held LEVEL or with a very subtle natural tilt (no more than 5°), chin neutral. The eyes are DIRECTED STRAIGHT INTO THE LENS — direct, confident gaze with relaxed energy through the eyes. The lips are softly closed or barely parted — natural, unforced.

Overall energy: the subtle weight shift + arm asymmetry give the pose just enough movement to feel HUMAN rather than catalog-stiff. Captured mid-breath, as if the model has settled naturally into position. The body still presents the garment cleanly but with a touch of lived-in ease. CRITICAL silhouette signature: arms hang DOWN with subtle asymmetry, hands VISIBLE at the sides, no pocket interaction whatsoever.`,
  },
  {
    id: 't03',
    label: 'Both hands pockets',
    thumbnailUrl: `${GCS_BASE}/top-pose-03-thumb.png`,
    bodyOnlyUrl: `${GCS_BASE}/top-pose-03-body.png`,
    description: `STRAIGHT FRONT POSE — top-focus stance #3 of 5 (both hands in front pockets, contrapposto).

The model stands FRONT-FACING, body squared to the camera with a clear NATURAL CONTRAPPOSTO — weight shifted onto one leg, creating a soft but visible hip tilt to the opposite side. Both shoulders are visible from the front, the chest faces the lens.

BOTH hands are tucked into the FRONT POCKETS of the jeans (left hand in the left front pocket, right hand in the right front pocket). Thumbs are HOOKED OUT over the pocket edge (visible as a small thumb-on-denim detail), while the rest of each hand sits seated inside the pocket. Knuckles are NOT visible — the fingers are inside the pocket. Both elbows are lightly held away from the torso, creating breathing room on either side of the body and preventing the arms from flattening the silhouette.

Shoulders are RELAXED, level or with a hair of asymmetry that follows the hip tilt. No tension in the neck or trapezius.

Weight is clearly favored on ONE LEG (load-bearing, planted flat). The opposite leg is relaxed with a soft bend at the knee, that hip raised slightly. Feet are roughly hip-width apart, the weight-bearing foot planted, the opposite foot soft.

The HEAD is held LEVEL, chin neutral. The eyes are DIRECTED STRAIGHT INTO THE LENS — direct, confident, with quiet energy. The lips are softly closed or naturally parted, expression unforced.

Overall energy: casual-confident off-duty stance. The double-pocket hand placement grounds the pose and gives it an unstudied, lived-in ease while the hip tilt adds organic shape. The top garment reads clearly without arm interference — both hands are anchored at the waist, leaving the torso uninterrupted as the visual hero.`,
  },
  {
    id: 't04',
    label: 'One hand pocket',
    thumbnailUrl: `${GCS_BASE}/top-pose-04-thumb.png`,
    bodyOnlyUrl: `${GCS_BASE}/top-pose-04-body.png`,
    description: `STRAIGHT FRONT POSE — top-focus stance #4 of 5 (asymmetric: one hand in pocket, one arm hanging).

The model stands FRONT-FACING, body squared to the camera with a very subtle natural shift. Both shoulders are visible from the front, the chest faces the lens.

ONE hand is tucked into a FRONT POCKET of the jeans — the wrist rests against the hip, the thumb may sit out over the pocket edge or fully in. That elbow is lightly bent and held away from the torso, creating a small triangle of breathing room between arm and side.

The OTHER ARM hangs NATURALLY at the side of the body, falling straight down with a small natural bend at the elbow. That hand is VISIBLE at hip / upper-thigh level, fingers soft and slightly curled, palm turned softly toward the body. The two arms are clearly ASYMMETRIC — one engaged with the pocket, one at rest.

Shoulders are RELAXED. The pocket-hand side may sit a hair higher than the other (because the wrist is anchored at the hip), but no exaggerated tilt. Neck is long and relaxed.

Weight is SUBTLY shifted, often opposite the pocket hand — small natural hip tilt. Feet are roughly hip-width apart, the weight-bearing foot planted flat, the opposite foot soft with a small bend at the knee.

The HEAD is held LEVEL, chin neutral. The eyes are DIRECTED STRAIGHT INTO THE LENS — direct, confident, with quiet energy through the eyes. (Alternative editorial moment: the gaze may shift just slightly off-camera in one direction — a soft side-glance under 15° from the lens — for a candid feel; but the primary direction remains forward-confident.) The lips are softly closed or naturally parted.

Overall energy: relaxed editorial confidence. The asymmetric arms break the symmetry of a pure frontal stance and give the pose personality without theatricality. The pocket-hand grounds the lower half while the free arm keeps the silhouette open on the other side — the top garment reads cleanly across the chest and one full sleeve.`,
  },
  {
    id: 't05',
    label: 'Pockets relaxed',
    thumbnailUrl: `${GCS_BASE}/top-pose-05-thumb.png`,
    bodyOnlyUrl: `${GCS_BASE}/top-pose-05-body.png`,
    description: `STRAIGHT FRONT POSE — top-focus stance #5 of 5 (both hands deep in front pockets, oversized-garment relaxed).

The model stands FRONT-FACING, body squared to the camera. Both shoulders are visible from the front, the chest faces the lens. This stance is the most RELAXED of the 5 — the posture is slightly grounded with a natural softness through the shoulders, reading as if the garment's volume has settled organically onto the body.

BOTH hands are tucked DEEP into the FRONT POCKETS of the jeans (left hand in left pocket, right hand in right pocket). Hands are FULLY SEATED inside the pockets — thumbs are IN as well (no thumbs out), wrists pulled inside the pocket opening. Both elbows fall close to the body's sides, not flared out — the arms relax with the garment's drape rather than holding shape.

Shoulders are RELAXED with a very subtle natural slope (slightly slumped, not military-stiff). The neck is long and easy.

Weight is slightly favored on ONE LEG, creating a soft natural hip tilt — less pronounced than t03's clear contrapposto, more of a gentle settling. Feet are roughly hip-width apart, the weight-bearing foot planted, the opposite foot soft.

The HEAD is held LEVEL or with a very subtle natural tilt (under 5°), chin neutral. The eyes are DIRECTED STRAIGHT INTO THE LENS — soft direct gaze with relaxed confident energy. The lips are softly closed, expression unforced and easy.

Overall energy: relaxed-confidence within an unstudied silhouette. Where t03 reads as "casual cool with thumbs out," t05 reads as "settled in, hands fully home." The deep-pocket hand placement and softer shoulder line give the pose a worn-in, off-duty quality — ideal for OVERSIZED or LOOSE-FIT tops (oversized tees, chore jackets, bomber jackets, oversized button shirts) where the silhouette already carries its own volume.`,
  },
];

/** Default top-focus pose used when a job has no m06TopPoseId set. */
export const M06_TOP_DEFAULT_POSE_ID = 't01';

/** Stable list of all 5 ids — for random picker and UI enumeration. */
export const M06_TOP_POSE_IDS = ['t01', 't02', 't03', 't04', 't05'] as const;
export type M06TopPoseId = typeof M06_TOP_POSE_IDS[number];

export function getM06TopPose(id: string | undefined | null): M06TopPose {
  const found = M06_TOP_POSES.find(p => p.id === (id || M06_TOP_DEFAULT_POSE_ID));
  return found || M06_TOP_POSES[0];
}

/** Random-pick one of t01-t05 — used when ctx.m06TopPoseId is unset
 *  (initial top-focus M06 render). Override path: the dashboard UI sets
 *  shot.m06TopPoseId to lock a specific variant on rerun. */
export function pickM06TopPose(): M06TopPose {
  const idx = Math.floor(Math.random() * M06_TOP_POSE_IDS.length);
  return getM06TopPose(M06_TOP_POSE_IDS[idx]);
}
