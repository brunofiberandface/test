import { describe, it, expect } from 'vitest';
import { APP_CONFIG, SHOT_DESCRIPTIONS } from '@/lib/config';

describe('APP_CONFIG', () => {
  it('shotTypes has exactly 5 entries', () => {
    expect(APP_CONFIG.shotTypes).toHaveLength(5);
  });

  it('shotTypes includes M01-M05', () => {
    expect(APP_CONFIG.shotTypes).toContain('M01');
    expect(APP_CONFIG.shotTypes).toContain('M02');
    expect(APP_CONFIG.shotTypes).toContain('M03');
    expect(APP_CONFIG.shotTypes).toContain('M04');
    expect(APP_CONFIG.shotTypes).toContain('M05');
  });

  it('m03Variants has A', () => {
    expect(APP_CONFIG.m03Variants).toContain('A');
  });

  it('geminiModel is defined and non-empty', () => {
    expect(APP_CONFIG.geminiModel).toBeDefined();
    expect(typeof APP_CONFIG.geminiModel).toBe('string');
    expect(APP_CONFIG.geminiModel.length).toBeGreaterThan(0);
  });

  it('imageWidth is positive', () => {
    expect(APP_CONFIG.imageWidth).toBeGreaterThan(0);
  });

  it('imageHeight is positive', () => {
    expect(APP_CONFIG.imageHeight).toBeGreaterThan(0);
  });

  it('imageWidth and imageHeight are reasonable (typical 2K dimensions)', () => {
    expect(APP_CONFIG.imageWidth).toBeGreaterThanOrEqual(1024);
    expect(APP_CONFIG.imageHeight).toBeGreaterThanOrEqual(1024);
  });

  it('imageAspectRatio is set', () => {
    expect(APP_CONFIG.imageAspectRatio).toBeDefined();
    expect(APP_CONFIG.imageAspectRatio).toBe('3:4');
  });
});

describe('SHOT_DESCRIPTIONS', () => {
  it('M01 is defined', () => {
    expect(SHOT_DESCRIPTIONS.M01).toBeDefined();
  });

  it('M02 is defined', () => {
    expect(SHOT_DESCRIPTIONS.M02).toBeDefined();
  });

  it('M03 is defined', () => {
    expect(SHOT_DESCRIPTIONS.M03).toBeDefined();
  });

  it('M04 is defined', () => {
    expect(SHOT_DESCRIPTIONS.M04).toBeDefined();
  });

  it('M05 is defined', () => {
    expect(SHOT_DESCRIPTIONS.M05).toBeDefined();
  });

  it('M05 description mentions DETAIL SHOT', () => {
    expect(SHOT_DESCRIPTIONS.M05).toMatch(/DETAIL SHOT|CLOSE-UP|back pocket/i);
  });

  it('M03 description mentions FRONT-FACING', () => {
    expect(SHOT_DESCRIPTIONS.M03).toMatch(/FRONT-FACING|front-facing/i);
  });

  it('all shot descriptions are non-empty strings', () => {
    Object.entries(SHOT_DESCRIPTIONS).forEach(([key, description]) => {
      expect(description).toBeDefined();
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(0);
    });
  });
});
