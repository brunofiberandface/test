import crypto from 'crypto';

/**
 * Compute a deterministic 12-char hash from a wardrobe combo.
 * Sorting ensures { shoes: "a", shirt: "b" } === { shirt: "b", shoes: "a" }
 * Used in both generate-dressed and generate routes — must stay in sync.
 */
export function computeWardrobeHash(wardrobeItemIds: Record<string, string>): string {
  const sorted = Object.fromEntries(
    Object.entries(wardrobeItemIds)
      .filter(([, v]) => v)
      .sort(([a], [b]) => a.localeCompare(b))
  );
  return crypto
    .createHash('md5')
    .update(JSON.stringify(sorted))
    .digest('hex')
    .substring(0, 12);
}
