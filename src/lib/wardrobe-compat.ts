/**
 * Backward compatibility bridge for v1 → v2 wardrobe items.
 *
 * v1 items have: fitModelUrls (array), flatFrontUrl/flatBackUrl or imageUrls/flatImageUrl
 * v2 items have: fitModels (labeled object with 6 named angles), flatFrontUrl, flatBackUrl
 *
 * This normalizes any wardrobe item to v2 shape so the pipeline always sees
 * fitModels + flatFrontUrl.
 */
import type { FitModelAngles } from '@/types';

interface NormalizedWardrobe {
  fitModels: FitModelAngles;
  flatFrontUrl: string;
  flatBackUrl?: string;
}

/**
 * Normalize a wardrobe item (from Firestore, could be v1 or v2) to v2 shape.
 * Returns null if the item has no usable fit model images.
 */
export function normalizeWardrobeItem(item: any): NormalizedWardrobe | null {
  // Already v2 — has fitModels object with at least front
  if (item.fitModels?.front) {
    return {
      fitModels: item.fitModels,
      flatFrontUrl: item.flatFrontUrl || '',
      flatBackUrl: item.flatBackUrl,
    };
  }

  // v1 — has fitModelUrls array
  const urls: string[] = item.fitModelUrls || [];
  if (urls.length === 0) return null;

  // Map array indices to named angles.
  // v1 used 8 angles in 360° rotation (45° increments):
  //   [0]=front, [1]=front-45-left, [2]=side-left, [3]=back-45-left,
  //   [4]=back, [5]=back-45-right, [6]=side-right, [7]=front-45-right
  // For fewer images, we do best-effort mapping.
  let fitModels: FitModelAngles;

  if (urls.length >= 8) {
    fitModels = {
      front: urls[0],
      front45Left: urls[1],
      front45Right: urls[7],
      back: urls[4],
      back45Left: urls[3],
      back45Right: urls[5],
    };
  } else if (urls.length >= 6) {
    // 6 images — assume they map 1:1 in upload order
    fitModels = {
      front: urls[0],
      front45Left: urls[1],
      front45Right: urls[2],
      back: urls[3],
      back45Left: urls[4],
      back45Right: urls[5],
    };
  } else if (urls.length >= 4) {
    // 4 images — front, back, and 2 diagonals
    fitModels = {
      front: urls[0],
      front45Left: urls[1],
      front45Right: urls[urls.length - 1],
      back: urls[2],
      back45Left: urls[1],
      back45Right: urls[3] || urls[2],
    };
  } else {
    // 1-3 images — reuse what we have
    fitModels = {
      front: urls[0],
      front45Left: urls[1] || urls[0],
      front45Right: urls[urls.length - 1] || urls[0],
      back: urls[Math.min(2, urls.length - 1)] || urls[0],
      back45Left: urls[1] || urls[0],
      back45Right: urls[Math.min(2, urls.length - 1)] || urls[0],
    };
  }

  // Flat images — v1 had flatFrontUrl / flatBackUrl or sometimes flatImageUrl / imageUrl
  const flatFrontUrl = item.flatFrontUrl || item.flatImageUrl || item.imageUrl || '';
  const flatBackUrl = item.flatBackUrl || '';

  return { fitModels, flatFrontUrl, flatBackUrl };
}
