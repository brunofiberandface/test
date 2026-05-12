import { describe, it, expect } from 'vitest';
import { APP_CONFIG } from '@/lib/config';

describe('APP_CONFIG', () => {
  it('shotTypes has exactly 6 entries', () => {
    expect(APP_CONFIG.shotTypes).toHaveLength(6);
  });

  it('shotTypes includes M01-M06', () => {
    expect(APP_CONFIG.shotTypes).toContain('M01');
    expect(APP_CONFIG.shotTypes).toContain('M02');
    expect(APP_CONFIG.shotTypes).toContain('M03');
    expect(APP_CONFIG.shotTypes).toContain('M04');
    expect(APP_CONFIG.shotTypes).toContain('M05');
    expect(APP_CONFIG.shotTypes).toContain('M06');
  });

  it('generationModel is defined', () => {
    expect(APP_CONFIG.generationModel).toBeDefined();
    expect(APP_CONFIG.generationModel).toBe('gemini-3-pro-image-preview');
  });

  it('analysisModel is defined', () => {
    expect(APP_CONFIG.analysisModel).toBeDefined();
    expect(APP_CONFIG.analysisModel).toBe('gemini-2.5-flash-lite');
  });

  it('imageSize is 4K', () => {
    expect(APP_CONFIG.imageSize).toBe('4K');
  });

  it('shotOrder defines dependency chain starting with M03', () => {
    expect(APP_CONFIG.shotOrder[0]).toBe('M03');
    expect(APP_CONFIG.shotOrder).toHaveLength(6);
  });

  it('shot metadata defines dependencies correctly', () => {
    // M03/M04/M06 are independent (parallelized 2026-04-30 — see LEARNINGS).
    expect(APP_CONFIG.shots.M03.dependsOn).toHaveLength(0);
    expect(APP_CONFIG.shots.M04.dependsOn).toHaveLength(0);
    expect(APP_CONFIG.shots.M06.dependsOn).toHaveLength(0);
    // M01/M02 crop their parents.
    expect(APP_CONFIG.shots.M01.dependsOn).toContain('M03');
    expect(APP_CONFIG.shots.M02.dependsOn).toContain('M04');
    // M05 depends on both anchors (M03 + M04).
    expect(APP_CONFIG.shots.M05.dependsOn).toContain('M03');
    expect(APP_CONFIG.shots.M05.dependsOn).toContain('M04');
  });
});
