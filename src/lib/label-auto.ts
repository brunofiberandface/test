/**
 * Auto hybrid-label pipeline — no-op.
 *
 * ⚠ STATUS (Apr 2026): HARD-DISABLED.
 *
 * Previously this file tied the 3-tier schema + Gemini Flash Lite pocket
 * detector + homography + shader together so generate/route.ts could apply
 * a label with a single call. That path produced visibly wrong output on
 * high-resolution renders (Flash Lite locks onto tiny non-pocket features
 * near the head, homography warps the label there). Bruno's call: drop the
 * auto path entirely and go manual-only.
 *
 * Every M04 / M02 now ships BLANK (no label). The user clicks "Map Label"
 * on the results page → LabelCornerPicker drags 4 pocket corners →
 * /api/shots/[id]/apply-label computes the homography from the wardrobe's
 * saved anchor pocket → those output pocket corners → warps the saved
 * label corners through it. See apply-label/route.ts for the live path.
 *
 * The previous auto implementation is in git history if a better detector
 * ever appears. To re-enable, reintroduce the resolver + detector call
 * chain and delete the early return in applyAutoHybridLabel.
 */

import type { ShotType } from '@/types';

interface ApplyAutoArgs {
  imageBuffer: Buffer;
  shotType: ShotType;
  job: { wardrobe?: Record<string, { itemId: string; isFocus?: boolean }> };
}

/**
 * Legacy env-check helper — kept so callers importing it don't break.
 * Always returns false now; auto is hard-disabled regardless of the env var.
 */
export function isHybridLabelAutoEnabled(): boolean {
  return false;
}

/**
 * Apply the auto hybrid label to a generated shot. Returns the original
 * buffer unchanged on ANY skip/failure — never throws.
 *
 * ⚠ HARD-DISABLED — see file header. Early-returns the input buffer before
 * any detection. The remainder of the function is preserved for reference
 * so the three-tier resolver + homography call pattern is easy to restore
 * once a better detector exists.
 */
export async function applyAutoHybridLabel(
  args: ApplyAutoArgs,
): Promise<Buffer> {
  const { imageBuffer, shotType } = args;

  // Hard-disable: manual-only workflow. M02/M04 ship blank; user clicks
  // "Map Label" on the results page to land the label via pocket homography
  // via /api/shots/[id]/apply-label. Auto detection + homography is kept in
  // git history at this path for reference if a better detector shows up.
  console.log(
    `[LabelAuto] ${shotType} — hard-disabled, shipping blank. Use "Map Label" in results UI.`,
  );
  return imageBuffer;
}
