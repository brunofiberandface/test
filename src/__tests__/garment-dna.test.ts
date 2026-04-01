import { describe, it, expect } from 'vitest';
import { getGarmentDNA } from '@/lib/garment-dna';

describe('getGarmentDNA', () => {
  it('returns exact match for full design number D27463-D945-001', () => {
    const dna = getGarmentDNA('D27463-D945-001');
    expect(dna).not.toBeNull();
    expect(dna?.styleName).toBe('Carpenter Straight Jeans');
  });

  it('returns match for prefix D27463', () => {
    const dna = getGarmentDNA('D27463');
    expect(dna).not.toBeNull();
    expect(dna?.styleName).toBe('Carpenter Straight Jeans');
  });

  it('returns null for unknown design number', () => {
    const dna = getGarmentDNA('D99999-X999-999');
    expect(dna).toBeNull();
  });

  it('returns DNA with all required fields for D27463-D945-001', () => {
    const dna = getGarmentDNA('D27463-D945-001');
    expect(dna).not.toBeNull();
    expect(dna?.designNumber).toBe('D27463-D945-001');
    expect(dna?.styleName).toBe('Carpenter Straight Jeans');
    expect(dna?.gender).toBe('male');
    expect(dna?.category).toBe('pants');
    expect(dna?.fit).toBe('wide straight leg');
    expect(dna?.dna).toBeDefined();
    expect(typeof dna?.dna).toBe('string');
    expect(dna?.dna.length).toBeGreaterThan(0);
  });

  it('returns DNA for D28831-E358-H938 (Stevey 3D Flare)', () => {
    const dna = getGarmentDNA('D28831-E358-H938');
    expect(dna).not.toBeNull();
    expect(dna?.styleName).toBe('Stevey 3D Flare Jeans');
    expect(dna?.gender).toBe('female');
    expect(dna?.category).toBe('pants');
    expect(dna?.fit).toBe('bootcut flare');
  });

  it('includes specialZones for Carpenter Straight Jeans', () => {
    const dna = getGarmentDNA('D27463-D945-001');
    expect(dna?.specialZones).toBeDefined();
    expect(Array.isArray(dna?.specialZones)).toBe(true);
    expect(dna?.specialZones?.length).toBeGreaterThan(0);
  });

  it('includes specialZones for Stevey 3D Flare', () => {
    const dna = getGarmentDNA('D28831-E358-H938');
    expect(dna?.specialZones).toBeDefined();
    expect(Array.isArray(dna?.specialZones)).toBe(true);
    expect(dna?.specialZones?.length).toBeGreaterThan(0);
  });

  it('Carpenter pocket zone has correct structure', () => {
    const dna = getGarmentDNA('D27463-D945-001');
    const carpenterZone = dna?.specialZones?.find(z => z.name === 'Carpenter Pocket');
    expect(carpenterZone).toBeDefined();
    expect(carpenterZone?.y1).toBeGreaterThanOrEqual(0);
    expect(carpenterZone?.y2).toBeLessThanOrEqual(1);
    expect(carpenterZone?.x1).toBeGreaterThanOrEqual(0);
    expect(carpenterZone?.x2).toBeLessThanOrEqual(1);
    expect(carpenterZone?.upscale).toBeGreaterThan(0);
    expect(Array.isArray(carpenterZone?.angles)).toBe(true);
    expect(carpenterZone?.label).toBeDefined();
  });

  it('Flare opening zone has correct structure', () => {
    const dna = getGarmentDNA('D28831-E358-H938');
    const flareZone = dna?.specialZones?.find(z => z.name === 'Flare Opening');
    expect(flareZone).toBeDefined();
    expect(flareZone?.y1).toBeGreaterThanOrEqual(0);
    expect(flareZone?.y2).toBeLessThanOrEqual(1);
    expect(flareZone?.x1).toBeGreaterThanOrEqual(0);
    expect(flareZone?.x2).toBeLessThanOrEqual(1);
  });

  it('Carpenter jeans have shot overrides', () => {
    const dna = getGarmentDNA('D27463-D945-001');
    expect(dna?.shotOverrides).toBeDefined();
    expect(dna?.shotOverrides?.M01).toBeDefined();
    expect(dna?.shotOverrides?.M01).toContain('BEHIND BACK');
  });
});
