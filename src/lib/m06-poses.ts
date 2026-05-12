/**
 * M06 pose library — 11 canonical poses defined by the G-Star team.
 * Source: gstar/poses M06.pdf (M06-only spec, Sun May 10 2026).
 *
 * REV 4 (2026-05-10): Per Bruno — use the team-PDF text descriptions
 * EXACTLY as written. No consolidation, no interpretation, no shortcuts.
 * Earlier rounds failed because we kept reinterpreting. The text below
 * is the canonical pose spec from the team's M06 brief.
 *
 * Each pose has:
 *   - id: stable string ID, persisted on the Job (job.m06PoseId)
 *   - label: 3-word UI label shown under the thumbnail
 *   - thumbnailUrl: GCS-hosted reference photo, ~400px tall (200px @2x)
 *   - description: EXACT text from the team-PDF — used as the
 *     POSE BLOCK injected into the M06 generation prompt
 *
 * Default: 'p01' when the job has no pose set (legacy backward-compat).
 */

const GCS_BASE = 'https://storage.googleapis.com/gstar-ai-studio-assets/m06-poses';

export interface M06Pose {
  id: string;
  label: string;          // 3 words max — shown under thumbnail
  thumbnailUrl: string;
  description: string;    // full pose block — injected into prompt
  /** When true, hidden from picker but resolvable via getM06Pose(id). */
  hidden?: boolean;
  /** When true, skip injecting the pose-ref IMAGE into the Gemini call —
   *  rely on text description only. Used for poses where the team-PDF
   *  reference image shows a strong back/profile rotation that Gemini
   *  copies regardless of "FRONT VIEW" text instruction (e.g. p04, p10
   *  whose refs are 3/4 turn / side profile but we want frontal output). */
  skipPoseRefImage?: boolean;
}

export const M06_POSES: M06Pose[] = [
  {
    id: 'p01',
    label: 'Posing 1',
    thumbnailUrl: `${GCS_BASE}/pose-01-thumb.png`,
    description: `A confident, relaxed full-body standing pose with a natural, effortless posture. The subject stands upright with a slight asymmetry in the stance — weight shifted primarily onto one leg, creating a subtle hip tilt. The opposite leg is relaxed, slightly bent at the knee, giving a casual, lived-in feel rather than a rigid fashion pose.

One arm hangs loosely by the side with minimal tension, fingers naturally curved, while the other arm is bent at the elbow with the hand resting casually near or inside a pocket, adding a sense of ease and nonchalance. Shoulders are relaxed and slightly dropped, avoiding stiffness, with a very slight forward roll to keep the pose grounded and natural.

The torso faces mostly forward but with a faint angle, creating dimension rather than a flat, straight-on stance. The head is held level or with a subtle tilt, chin slightly lowered to convey confidence and quiet intensity. The gaze is direct and steady, not exaggerated — calm, self-assured, and composed.

Overall energy: understated confidence, minimal effort, modern editorial feel. The body language should feel organic and unforced, as if captured mid-moment rather than overly posed.`,
  },
  {
    id: 'p02',
    label: 'Posing 2',
    thumbnailUrl: `${GCS_BASE}/pose-02-thumb.png`,
    description: `A grounded, confident full-body standing pose with a subtle, fashion-forward asymmetry. The subject stands with feet placed slightly apart, one foot positioned a bit forward and angled outward, creating a natural line through the legs. The weight is distributed unevenly — primarily resting on the back leg — while the front leg remains relaxed, giving a soft bend at the knee and an easy, fluid stance.

The hips follow the weight shift, creating a gentle tilt that adds shape and dimension without exaggeration. The torso remains mostly upright but with a faint diagonal lean, avoiding stiffness and keeping the posture organic. Shoulders are relaxed and level, with a slight drop on one side to enhance the asymmetry.

One arm is bent casually at the elbow, with the hand resting at the hip or tucked into a pocket area, creating a sense of ease and quiet confidence. The other arm hangs naturally by the side with minimal tension, fingers loose and slightly curved.

The neck is elongated, with the head held straight or slightly tilted. The chin is neutral or subtly lowered, contributing to a composed, self-assured expression. The gaze is forward and steady, calm and direct without intensity.

Overall energy: relaxed control, understated confidence, modern editorial presence. The pose should feel effortless and balanced, as if the subject naturally settled into position rather than deliberately posing.`,
  },
  {
    id: 'p03',
    label: 'Posing 3',
    thumbnailUrl: `${GCS_BASE}/pose-03-thumb.png`,
    description: `The model stands in a direct front-facing position to the camera, body squared to the lens with minimal rotation. Weight is distributed evenly across both feet, which are planted roughly hip-width apart, both pointing forward or with a very slight outward angle.

One hand rests loosely in the back pocket, pulling that elbow gently back and away from the body — this creates a subtle opening of the silhouette on one side without breaking the frontal stance. The opposite arm hangs naturally at the side, close to the body, relaxed with no tension in the hand or wrist.

The torso is fully upright and elongated — spine tall, shoulders rolled back and down, chest open but not pushed forward. There is no hip pop or twist; the stance reads as still, grounded, and symmetrical.

The chin is level, gaze directed straight into the lens — steady, calm, and unsmiling. The expression carries a quiet authority: eyes engaged, jaw relaxed, no forced softness.

The overall energy is composed and minimal — a clean, neutral stance that feels natural rather than posed, strong without aggression. The body acts as a straight, confident vertical line.`,
  },
  {
    id: 'p04',
    label: 'Posing 4',
    thumbnailUrl: `${GCS_BASE}/pose-04-thumb.png`,
    description: `═══ BODY ROTATION OVERRIDE — CRITICAL ═══
IGNORE the body rotation shown in IMAGE 1 (POSE REFERENCE). The reference image shows the model in a 3/4 turn away from camera — DO NOT REPRODUCE that rotation. For this render, ROTATE the body to FRONTAL: the chest must face the camera directly. Both shoulders visible from the front at near-equal depth. The model is NOT in any 3/4 turn or back angle. From IMAGE 1, take ONLY: hand placement (both hands in back pockets), weight shift onto one leg, hip tilt, mood. Disregard all body angle/rotation from IMAGE 1.

═══ POSE — FRONT-FACING, BOTH HANDS IN BACK POCKETS ═══
Body fully FRONTAL (chest facing camera). BOTH hands are tucked into the BACK POCKETS of the jeans (left hand in left back pocket, right hand in right back pocket).

Both arms bend back at the elbows and reach BEHIND the body to the back pockets. From the camera's front view: both elbows are visibly pulled back (pointing slightly behind the body, flared out to either side at hip level), the upper arms angle back from the shoulders, and the forearms+hands are HIDDEN BEHIND the hips at the back-pocket area. The shoulders pull slightly back because both arms reach behind. This is the classic denim e-comm gesture: hands in back pockets, viewed from the front.

Weight is shifted slightly onto one leg, creating a soft natural hip tilt. Feet roughly hip-width, pointing forward or with a slight outward angle.

The torso is upright. Shoulders pulled back from the back-pocket reach. The HEAD faces the camera, chin slightly lowered. The eyes meet the lens with a calm, soft intensity.

Overall energy: front-facing classic denim back-pocket pose — both hands engaged with the back pockets, elbows visibly pulled back, weight shift adds asymmetry.`,
  },
  {
    id: 'p05',
    label: 'Posing 5',
    thumbnailUrl: `${GCS_BASE}/pose-05-thumb.png`,
    description: `The model stands in a relaxed near-frontal position, body facing the camera with just a very subtle diagonal shift — not a full three-quarter turn, but enough to avoid a completely flat, symmetrical stance. Weight is slightly favored on one leg, creating a gentle, almost imperceptible hip tilt.

Both hands are tucked into the front pockets, thumbs out or fingers loosely hooked in — this pulls both elbows slightly away from the torso, creating breathing room on either side of the body and preventing the arms from flattening against the silhouette. The gesture reads as casual and self-assured, never stiff.

The torso is tall and open — shoulders back and relaxed, chest naturally lifted without being pushed forward. There is no slouch, but the posture doesn't read as rigid or military. The waist has a very slight natural lean to one side from the weight shift.

The chin is level to very slightly raised, gaze directed straight and directly into the lens with calm, unsmiling confidence. The head sits centered over the body — no tilt, no turn.

The feet are hip-width apart or slightly narrower, one foot marginally in front of the other to break any rigid symmetry in the lower body.

The overall energy is cool, relaxed, and quietly dominant — the dual pocket hand placement grounds the pose and gives it an off-duty ease while keeping the frame clean and product-focused.`,
  },
  {
    id: 'p06',
    label: 'Posing 6',
    thumbnailUrl: `${GCS_BASE}/pose-06-thumb.png`,
    description: `FRONT-FACING POSE — the model's body and chest face the camera directly. Body is FRONTAL with at most a very slight diagonal lean (under 15° off-square). The chest faces the lens; the model is NOT rotated away from the camera, NOT in a back-shoulder turn. Both shoulders are visible from the front at near-equal depth.

ONE hand is tucked into a front pocket of the jeans (the wrist and forearm rest against the hip), the OTHER arm hangs naturally at the side of the body (close to the body, hand relaxed). Neither arm is actively posed — both feel incidental and unstudied.

Weight is shifted slightly onto one leg with a soft natural hip tilt. The other leg is slightly relaxed with a soft bend at the knee. Feet roughly hip-width, pointing forward or with a slight outward angle.

The torso is upright. Shoulders down and back, no tilt. The HEAD faces the camera. The CHIN is lowered slightly, creating a contemplative, introspective mood. The eyes look DOWN AND SLIGHTLY INWARD (not at the lens, but downward toward a point in front of the model on the floor) — gaze withdrawn, soft. The expression is soft and neutral, not intense.

Overall energy: dreamy and understated — body faces the camera but the gaze drops downward, giving a natural candid quality as if the model is momentarily lost in thought. Front-facing introspective.`,
  },
  {
    id: 'p07',
    label: 'Posing 7',
    thumbnailUrl: `${GCS_BASE}/pose-07-thumb.png`,
    description: `The model stands in a fully frontal position, body squared directly to the camera with no rotation or diagonal. The stance is symmetrical and planted — both feet are set wider than hip-width apart, parallel or with a very slight outward turn, creating a grounded, wide base that commands the frame.

Both hands are tucked behind the back or resting just behind the hips, which pulls the shoulders subtly back and opens the chest forward. The arms are not visible from the front — this keeps the silhouette clean and uncluttered on both sides, and draws all attention to the torso and face.

The torso is fully upright — spine straight, chest lifted, shoulders square and level. There is no hip tilt, no lean, no softness in the stance. The body reads as a strong, still, vertical presence. No weight shift — both legs carry equal load.

The chin is level and the gaze is direct — eyes locked straight into the lens with a cool, unflinching intensity. The expression is serious and composed, with no hint of a smile. The jaw is relaxed but set, conveying quiet strength.

The overall energy is bold, still, and confrontational in the best sense — the wide stance and hidden hands give the pose a raw, undecorated confidence. Nothing is softened or styled away. The body simply stands and owns the space.`,
  },
  {
    id: 'p08',
    label: 'Posing 8',
    thumbnailUrl: `${GCS_BASE}/pose-08-thumb.png`,
    description: `The model stands in a near-frontal position with a very subtle body shift — weight transferred onto one leg, creating a gentle, natural hip tilt to one side. The stance is soft and approachable rather than rigid or powerful. Feet are roughly hip-width apart, with the weight-bearing foot planted flat and the opposite leg slightly relaxed.

The arms are asymmetric — one hand is tucked into the front pocket with the thumb out, keeping that elbow lightly lifted away from the body. The other arm hangs completely free and natural at the side, falling straight down without tension, hand relaxed. This asymmetry between the two arms keeps the pose dynamic and prevents it from reading as stiff or mirrored.

The torso is upright but easy — shoulders are level and back, chest open, but without any military stiffness. The body has a quiet, natural ease to it. The slight hip shift introduces just enough movement to make the stance feel lived-in rather than posed.

The head is straight and centered, chin level, gaze directed directly into the lens with a calm, neutral expression. Eyes are engaged and steady — not intense, not soft — simply present. The face is relaxed, expression composed without being cold.

The overall energy is natural, clean, and quietly self-assured — the asymmetric arms and gentle weight shift give the pose just enough personality to feel human, while the frontal framing keeps it clear and product-focused.`,
  },
  {
    id: 'p09',
    label: 'Posing 9',
    thumbnailUrl: `${GCS_BASE}/pose-09-thumb.png`,
    description: `The model stands in a fully frontal position, body squared directly to the camera with no rotation. The stance is symmetrical and deliberate — feet planted roughly hip-width apart, both legs straight and evenly weighted, grounding the pose with a sense of solidity and presence.

Both hands rest firmly on the hips — fingers facing forward, thumbs pointing back, elbows pushed out to either side. The elbows are lifted and open, creating a strong, wide silhouette through the upper body. The arms form a clear, intentional frame around the waist. This is not a casual hands-on-hips — it reads as purposeful and assured.

The torso is tall and very upright — chest lifted, shoulders back and square, no tilt or lean in any direction. The openness of the elbows naturally pulls the shoulders back and broadens the upper frame, adding to the sense of confidence and structure in the pose.

The chin is level, gaze directed straight and evenly into the lens. The expression is neutral and composed — serious without being harsh, focused without being tense. Eyes are steady and direct.

The overall energy is strong, structured, and self-possessed — the double hands-on-hips creates an assertive, almost architectural quality to the stance. It is frontal and symmetrical, yet feels active rather than static. The pose communicates ease within authority — someone who takes up space naturally and without apology.`,
  },
  {
    id: 'p10',
    label: 'Posing 10',
    thumbnailUrl: `${GCS_BASE}/pose-10-thumb.png`,
    description: `The model stands in a near-full side profile, body rotated approximately 75–80 degrees away from the camera, presenting almost entirely in silhouette. This is one of the most pronounced turns in the sequence — the chest faces completely away from the lens, with only the very edge of the front shoulder visible.

Weight is evenly distributed across both feet, which are aligned one behind the other in the same diagonal direction the body faces. The stance is straight and tall through the legs — no knee bend, no hip pop — creating a clean, elongated vertical line from shoulder to floor.

One hand is placed on the back hip / back pocket area, fingers resting flat and relaxed against the body, elbow pushed gently back and behind the torso. This lifts and opens the back arm, adding a sharp, angular accent to the silhouette that prevents it from reading as flat. The front arm hangs naturally at the side, close to the body and relaxed.

The torso is fully upright — spine elongated, shoulders back, chest open in the direction the body faces. No arch, no lean forward or back. The profile line from neck to hip is straight and clean.

The head turns back toward the camera over the front shoulder, chin level, eyes meeting the lens directly with a calm, steady gaze. The neck is long and relaxed — no tension in the jaw or shoulders.

The overall energy is sleek, elongated, and quietly editorial — the deep profile turn emphasizes the full length of the body while the backward glance creates a natural, effortless tension between body and gaze.`,
  },
  {
    id: 'p11',
    label: 'Posing 11',
    thumbnailUrl: `${GCS_BASE}/pose-11-thumb.png`,
    description: `The model stands in a three-quarter turn, body rotated approximately 45–50 degrees away from the camera, with the back shoulder clearly visible and the chest angled away from the lens. The rotation is confident and committed — not a tentative diagonal, but a deliberate turn that gives the pose a strong sense of direction.

Weight is shifted onto the back leg, which is straight and load-bearing. The front leg is relaxed with a very slight bend, the front foot pointing in the same diagonal direction as the body. The overall lower body reads as still and grounded, with no exaggerated hip push.

One hand is loosely tucked into the front pocket, fingers resting naturally inside, keeping that arm close and unobtrusive against the hip. The opposite arm hangs freely at the side, relaxed and uncontrived, falling away from the body with a slight natural gap at the elbow.

The torso follows the body's diagonal cleanly — spine upright, shoulders back, no counter-twist toward the camera. The upper and lower body move as one unified line.

The head turns back toward the camera but the gaze lifts — eyes directed upward and slightly off-lens, as if the model's attention has been caught by something just above and beyond the frame. The chin is level to very slightly raised. The expression is open, calm, and quietly curious — not intense, not dreamy, simply present and distracted in a natural way.

The overall energy is light, unguarded, and effortlessly candid — the upward off-camera gaze breaks the directness of previous poses and introduces a sense of spontaneity and movement, as if a moment has been caught rather than constructed.`,
  },
];

/** Default pose used when a job has no m06PoseId set (legacy jobs). */
export const M06_DEFAULT_POSE_ID = 'p01';

export function getM06Pose(id: string | undefined | null): M06Pose {
  const found = M06_POSES.find(p => p.id === (id || M06_DEFAULT_POSE_ID));
  return found || M06_POSES[0];
}
