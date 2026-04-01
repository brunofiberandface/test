import { describe, it, expect } from 'vitest';
import { computeWardrobeHash } from '@/lib/wardrobe-hash';

describe('computeWardrobeHash', () => {
  it('produces a 12-character hex string', () => {
    const hash = computeWardrobeHash({ shoes: 'abc123', shirt: 'def456' });
    expect(hash).toMatch(/^[a-f0-9]{12}$/);
  });

  it('is deterministic — same input always gives same hash', () => {
    const input = { shoes: 'item-1', jacket: 'item-2' };
    const hash1 = computeWardrobeHash(input);
    const hash2 = computeWardrobeHash(input);
    expect(hash1).toBe(hash2);
  });

  it('is order-independent — different key order gives same hash', () => {
    const hash1 = computeWardrobeHash({ shoes: 'a', shirt: 'b' });
    const hash2 = computeWardrobeHash({ shirt: 'b', shoes: 'a' });
    expect(hash1).toBe(hash2);
  });

  it('filters out empty values', () => {
    const hashWith = computeWardrobeHash({ shoes: 'a', shirt: '' });
    const hashWithout = computeWardrobeHash({ shoes: 'a' });
    expect(hashWith).toBe(hashWithout);
  });

  it('filters out falsy values', () => {
    const hashClean = computeWardrobeHash({ shoes: 'a' });
    // @ts-expect-error testing runtime behavior with undefined
    const hashDirty = computeWardrobeHash({ shoes: 'a', jacket: undefined });
    expect(hashClean).toBe(hashDirty);
  });

  it('different items produce different hashes', () => {
    const hash1 = computeWardrobeHash({ shoes: 'item-1' });
    const hash2 = computeWardrobeHash({ shoes: 'item-2' });
    expect(hash1).not.toBe(hash2);
  });

  it('different categories with same id produce different hashes', () => {
    const hash1 = computeWardrobeHash({ shoes: 'same-id' });
    const hash2 = computeWardrobeHash({ jacket: 'same-id' });
    expect(hash1).not.toBe(hash2);
  });

  it('handles single item', () => {
    const hash = computeWardrobeHash({ boots: 'xyz' });
    expect(hash).toHaveLength(12);
  });

  it('handles many items', () => {
    const hash = computeWardrobeHash({
      shoes: 'a', shirt: 'b', jacket: 'c', pants: 'd', belt: 'e',
    });
    expect(hash).toHaveLength(12);
  });
});
