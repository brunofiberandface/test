# M02 — Matrix-paint bottom-focus back view (Seedream) — v3

## Purpose
Rev 25 of the matrix-paint M02 prompt. Bruno-authored shorter prompt focused
on the skin/identity vs fit-model-source-of-truth distinction, with a hardened
neutral-symmetric pose block. Replaces the disclaimer-heavy v2 (rev 24) which
1/3 got barrel + introduced twin risk.

Architecture context unchanged:
- IMAGE 1 = Tier-2 base (model already wearing target shoes + placeholder pants); preserve every pixel except the placeholder pants area.
- IMAGE 2 = fit-model straight back.

## Placeholders consumed
- `{garment_type}` — wardrobe item name
- `{silhouette}` — Opus silhouette+fit analysis
- `{shoes_description}` — wardrobe shoe full description

## Step 2 Prompt

```
Photorealistic studio e-commerce photograph, 1:1 SQUARE crop, 4K resolution, BACK VIEW, waist-down (legs + feet) of ONE SINGLE MODEL.


### Skin Rendering — CRITICAL
This is a documentary product photograph, not a glamour or fashion editorial. The model's face is rendered as completely natural and unretouched. NO makeup, NO blush, NO rouge, NO contour, NO bronzer, NO cosmetic color anywhere on the face. NO color grading or color enhancement applied to skin areas. The face is rendered raw, plain, and bare.

The MODEL IDENTITY REFERENCE image shows the model exactly as she should appear in this render — her actual complexion, her actual skin tone.


The MODEL IDENTITY REFERENCE is the exclusive authority for: skin tone, skin pigmentation, complexion and the model's overall coloration.

The FIT MODEL REFERENCE photographs are real studio photography with their own particular lighting and color rendering baked into the source pixels. Use the fit-model photographs ONLY for the garment's fit, drape, silhouette, pose geometry, fabric behavior, and construction details. The fit-model photographs are NOT a source for skin tone, complexion, lighting tint, color rendering, or any aspect of the model's appearance — those come exclusively from the MODEL IDENTITY REFERENCE.

The garment in the rendered output keeps its exact source colors — fabric color, contrast stitching color, hardware metal tone, and label colors are rendered exactly as shown in the garment flat and fit-model references. Skin-tone fidelity is achieved by anchoring skin to the model identity reference, NOT by shifting any garment color.

### Pose & Proportions
STRICT REQUIREMENT: Pose is strictly neutral, bilaterally symmetric, and geometrically aligned. NO CONTRAPPOSTO. NO WEIGHT SHIFT. NO HIP TILT. NO HIP POP. NO SHOULDER DROP. NO KNEE BEND. NO STAGGERED OR CROSSED FEET. NO ASYMMETRY OF ANY KIND. Do not apply default fashion-photography posing conventions or stylistic body positioning.

Core alignment: The model's body is perfectly mirrored across a vertical centerline running from the centre of the waistband, the midline between the legs, and straight down to the floor at the midpoint between both feet. Every visible feature on the left side of the body has its exact mirror equivalent on the right side — at identical height, identical distance from the centerline, and identical angle.

Weight distribution: Exactly 50/50 across both feet — neither leg carries more weight, neither leg acts as a primary support. Both feet are fully flat on the floor at the same forward depth (no foot in front of the other, no offset). Feet are perfectly parallel, toes pointing directly toward the camera, no inward or outward rotation.

Leg and hip alignment:
- The gap between the inner ankles is exactly equal to the width of the pelvis.
- A straight vertical line drawn from each hip joint passes through the matching ankle and continues to the floor — no lateral offset, no diagonal.
- Knees are at the same height; both legs are equally straight. Neither knee is bent, softened, locked, or relaxed.
- Hips perfectly square and facing forward; the belt line is completely horizontal across the entire frame, with zero tilt.

arm alignment:
- Arms hang straight down the sides with a small natural gap from the torso, equal on both sides, so the waistband and front pockets stay fully visible. The left arm and right arm mirror each other exactly in angle, distance from body, and placement along the torso.
- Hands relaxed, fingers slightly separated, in a natural resting position. Both hands match each other in shape and orientation.

Reference rule: The Fit Model Front Angle photos in the input are the SOURCE OF TRUTH for this pose. Replicate every element exactly — flat feet, vertical hip-to-ankle alignment, 50/50 weight, straight legs, level hips, level shoulders. Do not deviate from these references and do not introduce posing elements common in fashion photography (including but not limited to: contrapposto, weight shift to one leg, hip pop, shoulder tilt, knee bend, crossed feet, staggered stance, or asymmetric limb positioning).


### Garment
The model wears the {garment_type} as displayed in the fit-model front photographs and the flat-front reference. Use those photos exclusively for the garment's identity — base color, wash and finish, all front panel seam lines, fly stitching, belt loop positioning and spacing, front pocket placement, rivet positions, and overall silhouette shape. Do not carry anything else over from those photos — no studio set, no floor texture, no surface marks. {silhouette}


### Hem & Footwear
Render the garment hem exactly as the silhouette description specifies — including its finished length, opening width, and fabric behavior (stacking, breaking, draping, or cascading).

**Fabric interaction:** The fabric falls naturally **over and around** the entire shape of the shoes, draping softly to cover the ankle, heel, and topline. The hem creates smooth, natural folds that follow the contour of the footwear, resting gently on top and sides. Only the parts of the shoes that naturally extend beyond the fabric are visible — typically just the toe box and the lower edge of the sole.

The connection between pant leg and shoe must look continuous and organic, with the fabric volume fully enclosing the footwear shape as described.

Footwear is the {shoes_description}, reproduced exactly to match the shoe reference images.
```
