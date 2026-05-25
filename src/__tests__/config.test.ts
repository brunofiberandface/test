import { describe, it, expect } from 'vitest';
import { APP_CONFIG } from '@/lib/config';

describe('APP_CONFIG', () => {
  it('shotTypes lists the 4 active shots (M01/M02/M05/M06)', () => {
    expect(APP_CONFIG.shotTypes).toHaveLength(4);
    expect(APP_CONFIG.shotTypes).toEqual(expect.arrayContaining(['M01', 'M02', 'M05', 'M06']));
  });

  it('shotTypes does NOT include retired M03/M04', () => {
    expect(APP_CONFIG.shotTypes).not.toContain('M03');
    expect(APP_CONFIG.shotTypes).not.toContain('M04');
  });

  it('shots map still defines M03/M04 entries for legacy job display', () => {
    expect(APP_CONFIG.shots.M03).toBeDefined();
    expect(APP_CONFIG.shots.M04).toBeDefined();
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

  it('shotOrder matches the active shotTypes', () => {
    expect(APP_CONFIG.shotOrder).toHaveLength(4);
    expect(APP_CONFIG.shotOrder).toEqual(expect.arrayContaining(['M01', 'M02', 'M05', 'M06']));
  });

  it('shot dependency graph reflects the matrix-paint pipeline', () => {
    // M01 and M02 are independent matrix-paint operations (no deps).
    expect(APP_CONFIG.shots.M01.dependsOn).toHaveLength(0);
    expect(APP_CONFIG.shots.M02.dependsOn).toHaveLength(0);
    // M06 is the independent free pose.
    expect(APP_CONFIG.shots.M06.dependsOn).toHaveLength(0);
    // M05 depends on M02 (anchor for the back-pocket close-up).
    expect(APP_CONFIG.shots.M05.dependsOn).toEqual(['M02']);
  });
});
