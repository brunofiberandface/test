import { describe, it, expect } from 'vitest';
import { getGarmentDNA } from '@/lib/garment-dna';

describe('getGarmentDNA (legacy)', () => {
  it('returns null for any design number (registry removed, dynamic analysis replaces it)', () => {
    expect(getGarmentDNA('D27463-D945-001')).toBeNull();
    expect(getGarmentDNA('D28831-E358-H938')).toBeNull();
    expect(getGarmentDNA('D99999-X999-999')).toBeNull();
  });
});

// analyzeGarmentConstruction() requires GEMINI_API_KEY and real images,
// so it's tested via the /api/test-garment-dna endpoint on Cloud Run.
