/**
 * M05 prompt library — TOP-FOCUS camera variations only.
 *
 * BOTTOM-focus M05 is a single canonical shot (rev 33 in promptVault —
 * upper-thigh camera, right back pocket hero with 3/4 rear rotation).
 * No random variants for bottom per Bruno 2026-05-11.
 *
 * TOP-focus M05 has 3 camera variations because the top showcase needs
 * variety across deliverables (shoulder seam / yoke / collar etc.):
 *   A — Side profile shoulder (90°, profile silhouette)
 *   B — 3/4 rear-side over-the-shoulder (135°, back yoke + sleeve)
 *   C — 3/4 front-side shoulder (45°, front collar + chest detail)
 *
 * seedreamM05() picks ONE randomly per render. User can override via
 * the dashboard "Rerun with variant X" menu (sets ctx.m05TopVariantId).
 */

const STUDIO_LIGHTING = `Backdrop and floor: clean light-grey studio sweep (#D9DAD2). Studio lighting is soft, fully diffused, white-balanced to 5500K. Even illumination. No backdrop variation, scuffs, marks.`;

const NO_LABELS = `Render the back-hip and pocket area as CLEAN unbranded garment fabric. Do NOT render any brand labels, leather patches, woven patches, embossed labels, printed labels of any kind anywhere in the frame. Brand labels are composited post-generation via a separate pipeline step.`;

// ───────────────────── TOP-FOCUS (3 variants) ─────────────────────

const TOP_A_SIDE_PROFILE_SHOULDER = `Tight product-photography close-up framing on the model's shoulder area to showcase the {garment_type}. Photorealistic, sharp focus, ultra-high detail, color accurate, neutral white-balanced, commercial studio quality.

═══ CAMERA POSITION — SIDE PROFILE (90°) ═══
The camera is positioned at the model's SIDE — approximately 90° from a front-facing position. The model's body faces left or right (perpendicular to the camera). We see the model's profile silhouette. Camera height: at shoulder level. Lens horizontal, no upward or downward tilt. Lens: 85-100mm equivalent. The composition shows the SIDE PROFILE of the shoulder: shoulder seam in clear profile, sleeve cap visible in profile, neckline edge in profile, side of the face partially visible.

═══ FRAME — TIGHT ON SHOULDER ═══
- TOP edge: just above the shoulder line, top of head visible as small slice OR cropped above ear.
- BOTTOM edge: at mid-chest / upper-rib area.
- Shoulder fills ~40-50% of frame.
- NO waist, NO hips, NO arms below the elbow, NO hands.

═══ GARMENT STATE — TOP IS WORN ON THE BODY ═══
The top is worn on the body normally and completely. BOTH shoulders are fully covered by the top's fabric. The shoulder seam of the top sits at the natural top of the shoulder. The neckline sits at its designed position at the base of the neck. The sleeves are on the arms at their full length. Any closures (buttons, zippers) are at their designed positions. The visible material from the neckline outward through the shoulder, sleeve cap, and upper chest is the top's fabric — its color, weave, stitching, collar, and any hardware.

═══ HERO — top garment's shoulder construction ═══
Visual hero is the side of the model's shoulder showing: shoulder seam stitching, sleeve cap fit, top fabric texture and color at the shoulder, neckline edge in profile, any visible collar / lapel.

═══ Outfit ═══
The model wears the {top_description} (FOCUS) as shown in the FIT MODEL angles / FLAT references. Color, fabric, fit match exactly.

${STUDIO_LIGHTING}

{silhouette}`;

const TOP_B_REAR_SIDE_OVER_SHOULDER = `Tight product-photography close-up framing on the back-side of the model's shoulder showcasing the back yoke and sleeve construction of the {garment_type}. Photorealistic, sharp focus, ultra-high detail, color accurate, neutral white-balanced, commercial studio quality.

═══ CAMERA POSITION — BEHIND THE MODEL — 3/4 REAR-SIDE (135°) ═══
The camera is positioned BEHIND the model, offset to one side — approximately 135° from a front-facing position (i.e. 45° past pure side, rotated toward the back of the model). The lens points forward toward the model's upper back and rear shoulder. Camera height: at shoulder level. Lens horizontal. Lens: 85-100mm equivalent. The composition shows: the back-side of the shoulder, the back yoke of the top, the side of the sleeve cap as it joins the shoulder seam, and a sliver of the side of the face.

═══ FRAME — TIGHT ON SHOULDER (BACK + SIDE) ═══
- TOP edge: just above the shoulder line, top of head as small slice OR cropped above ear.
- BOTTOM edge: at upper back / mid-shoulder-blade area.
- Back of shoulder and sleeve fill ~40-50% of frame.
- NO waist, NO hips, NO arms below the elbow, NO hands.

═══ GARMENT STATE — TOP IS WORN ON THE BODY ═══
The top is worn on the body normally and completely. BOTH shoulders are fully covered by the top's fabric. The back yoke seam of the top sits at the natural top of the upper back. The shoulder seam sits at the natural top of the shoulder. The neckline sits at its designed position at the base of the neck. The visible material from the neckline outward through the back yoke, shoulder, and sleeve cap is the top's fabric — its color, weave, stitching, and back-panel construction.

═══ HERO — top garment's back yoke + sleeve cap ═══
Visual hero is the BACK + SIDE of the shoulder: shoulder yoke seam, back-side of the sleeve cap, upper back fabric, side of neckline going around (collar from back-side angle).

═══ Outfit ═══
The model wears the {top_description} (FOCUS) as shown in the FIT MODEL angles / FLAT references. Color, fabric, fit match exactly.

${STUDIO_LIGHTING}

{silhouette}`;

const TOP_C_FRONT_SIDE_SHOULDER = `Tight product-photography close-up framing on the front-side of the model's shoulder showcasing the collar/neckline and shoulder construction of the {garment_type}. Photorealistic, sharp focus, ultra-high detail, color accurate, neutral white-balanced, commercial studio quality.

═══ CAMERA POSITION — 3/4 FRONT-SIDE (45°) ═══
The camera is positioned to the FRONT-AND-SIDE of the model — approximately 45° from a pure front-facing position. The model's body is mostly facing the camera with a soft 45° rotation. We see the front-side of the shoulder: collar / neckline visible from a soft diagonal, front-side of the sleeve cap, side of the face partially visible. Camera height: at shoulder level. Lens horizontal. Lens: 85-100mm equivalent.

═══ FRAME — TIGHT ON SHOULDER (FRONT + SIDE) ═══
- TOP edge: just above the shoulder line, top of head as small slice OR cropped above ear.
- BOTTOM edge: at mid-chest / upper-rib area.
- Shoulder + front collar fills ~40-50% of frame.
- NO waist, NO hips, NO arms below the elbow, NO hands.

═══ GARMENT STATE — TOP IS WORN ON THE BODY ═══
The top is worn on the body normally and completely. BOTH shoulders are fully covered by the top's fabric. The shoulder seam of the top sits at the natural top of the shoulder. The front collar / neckline sits at its designed position at the base of the neck. The sleeves are on the arms at their full length. Any front closures (buttons, zippers) are at their designed positions and fastened normally. The visible material from the neckline outward through the front collar, shoulder, sleeve cap, and upper chest is the top's fabric — its color, weave, stitching, collar, and any hardware.

═══ HERO — top garment's front collar + shoulder seam ═══
Visual hero is the FRONT + SIDE of the shoulder: front collar / neckline from a diagonal, shoulder seam at 45° angle, front-side of the sleeve cap, any visible closure (buttons, zipper) at the chest.

═══ Outfit ═══
The model wears the {top_description} (FOCUS) as shown in the FIT MODEL angles / FLAT references. Color, fabric, fit match exactly.

${STUDIO_LIGHTING}

{silhouette}`;

// ───────────────────── Exports ─────────────────────

export const TOP_VARIANTS = {
  A: { name: 'Side profile (90°)', prompt: TOP_A_SIDE_PROFILE_SHOULDER },
  B: { name: 'Over-shoulder (135°)', prompt: TOP_B_REAR_SIDE_OVER_SHOULDER },
  C: { name: 'Front 3/4 (45°)', prompt: TOP_C_FRONT_SIDE_SHOULDER },
} as const;

export type TopVariantId = keyof typeof TOP_VARIANTS;
export const TOP_VARIANT_IDS: TopVariantId[] = ['A', 'B', 'C'];

export function pickTopVariant(): { id: TopVariantId; name: string; prompt: string } {
  const id = TOP_VARIANT_IDS[Math.floor(Math.random() * TOP_VARIANT_IDS.length)];
  return { id, ...TOP_VARIANTS[id] };
}
