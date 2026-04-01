import { describe, it, expect } from 'vitest';
import {
  isLowerBodyCategory,
  isUpperBodyCategory,
  detectCoveredZones,
  buildIgnoreZoneInstruction,
  buildUncoveredZoneRules,
} from '@/lib/zone-detection';

describe('isLowerBodyCategory', () => {
  it('returns true for pants', () => {
    expect(isLowerBodyCategory('pants')).toBe(true);
  });

  it('returns true for jeans', () => {
    expect(isLowerBodyCategory('jeans')).toBe(true);
  });

  it('returns true for shorts', () => {
    expect(isLowerBodyCategory('shorts')).toBe(true);
  });

  it('returns true for skirt', () => {
    expect(isLowerBodyCategory('skirt')).toBe(true);
  });

  it('returns true for trousers', () => {
    expect(isLowerBodyCategory('trousers')).toBe(true);
  });

  it('returns true for uppercase PANTS', () => {
    expect(isLowerBodyCategory('PANTS')).toBe(true);
  });

  it('returns false for jacket', () => {
    expect(isLowerBodyCategory('jacket')).toBe(false);
  });

  it('returns false for shirt', () => {
    expect(isLowerBodyCategory('shirt')).toBe(false);
  });

  it('returns false for shoes', () => {
    expect(isLowerBodyCategory('shoes')).toBe(false);
  });

  it('returns false for belt', () => {
    expect(isLowerBodyCategory('belt')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isLowerBodyCategory('Pants')).toBe(true);
    expect(isLowerBodyCategory('JEANS')).toBe(true);
    expect(isLowerBodyCategory('Shorts')).toBe(true);
  });
});

describe('isUpperBodyCategory', () => {
  it('returns true for jacket', () => {
    expect(isUpperBodyCategory('jacket')).toBe(true);
  });

  it('returns true for shirt', () => {
    expect(isUpperBodyCategory('shirt')).toBe(true);
  });

  it('returns true for top', () => {
    expect(isUpperBodyCategory('top')).toBe(true);
  });

  it('returns true for blouse', () => {
    expect(isUpperBodyCategory('blouse')).toBe(true);
  });

  it('returns true for coat', () => {
    expect(isUpperBodyCategory('coat')).toBe(true);
  });

  it('returns true for bomber', () => {
    expect(isUpperBodyCategory('bomber')).toBe(true);
  });

  it('returns true for overshirt', () => {
    expect(isUpperBodyCategory('overshirt')).toBe(true);
  });

  it('returns true for vest', () => {
    expect(isUpperBodyCategory('vest')).toBe(true);
  });

  it('returns false for pants', () => {
    expect(isUpperBodyCategory('pants')).toBe(false);
  });

  it('returns false for shoes', () => {
    expect(isUpperBodyCategory('shoes')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isUpperBodyCategory('JACKET')).toBe(true);
    expect(isUpperBodyCategory('Shirt')).toBe(true);
  });
});

describe('detectCoveredZones', () => {
  it('jacket and shoes: hasUpperBody true, hasLowerBody false', () => {
    const result = detectCoveredZones(['jacket', 'shoes']);
    expect(result.hasUpperBody).toBe(true);
    expect(result.hasLowerBody).toBe(false);
  });

  it('pants and shirt: both true', () => {
    const result = detectCoveredZones(['pants', 'shirt']);
    expect(result.hasUpperBody).toBe(true);
    expect(result.hasLowerBody).toBe(true);
  });

  it('shoes and belt: both false', () => {
    const result = detectCoveredZones(['shoes', 'belt']);
    expect(result.hasUpperBody).toBe(false);
    expect(result.hasLowerBody).toBe(false);
  });

  it('handles empty array', () => {
    const result = detectCoveredZones([]);
    expect(result.hasUpperBody).toBe(false);
    expect(result.hasLowerBody).toBe(false);
  });

  it('is case insensitive', () => {
    const result = detectCoveredZones(['PANTS', 'JACKET']);
    expect(result.hasUpperBody).toBe(true);
    expect(result.hasLowerBody).toBe(true);
  });
});

describe('buildIgnoreZoneInstruction', () => {
  it('pants returns instruction containing IGNORE THE PANTS/LEGWEAR', () => {
    const instruction = buildIgnoreZoneInstruction('pants');
    expect(instruction).toContain('IGNORE THE PANTS/LEGWEAR');
  });

  it('jeans returns instruction containing IGNORE THE PANTS/LEGWEAR', () => {
    const instruction = buildIgnoreZoneInstruction('jeans');
    expect(instruction).toContain('IGNORE THE PANTS/LEGWEAR');
  });

  it('jacket returns instruction containing IGNORE THE JACKET/SHIRT/TOP', () => {
    const instruction = buildIgnoreZoneInstruction('jacket');
    expect(instruction).toContain('IGNORE THE JACKET/SHIRT/TOP');
  });

  it('shirt returns instruction containing IGNORE THE JACKET/SHIRT/TOP', () => {
    const instruction = buildIgnoreZoneInstruction('shirt');
    expect(instruction).toContain('IGNORE THE JACKET/SHIRT/TOP');
  });

  it('shoes returns empty string', () => {
    const instruction = buildIgnoreZoneInstruction('shoes');
    expect(instruction).toBe('');
  });

  it('belt returns empty string', () => {
    const instruction = buildIgnoreZoneInstruction('belt');
    expect(instruction).toBe('');
  });
});

describe('buildUncoveredZoneRules', () => {
  it('both uncovered: has both LOWER and UPPER instructions', () => {
    const rules = buildUncoveredZoneRules({ hasLowerBody: false, hasUpperBody: false });
    expect(rules).toContain('LOWER BODY');
    expect(rules).toContain('UPPER BODY');
  });

  it('only upper covered: has LOWER instruction, no UPPER', () => {
    const rules = buildUncoveredZoneRules({ hasLowerBody: false, hasUpperBody: true });
    expect(rules).toContain('LOWER BODY');
    expect(rules).not.toContain('UPPER BODY');
  });

  it('only lower covered: has UPPER instruction, no LOWER', () => {
    const rules = buildUncoveredZoneRules({ hasLowerBody: true, hasUpperBody: false });
    expect(rules).not.toContain('LOWER BODY');
    expect(rules).toContain('UPPER BODY');
  });

  it('both covered: returns empty string', () => {
    const rules = buildUncoveredZoneRules({ hasLowerBody: true, hasUpperBody: true });
    expect(rules).toBe('');
  });
});
