import { describe, it, expect } from 'vitest';
import {
  buildGenerationPrompt,
  buildQCPrompt,
  ZONE_DEFS,
  REF_LABELS,
} from '@/lib/prompts';
import { SHOT_DESCRIPTIONS } from '@/lib/config';

describe('buildGenerationPrompt', () => {
  const baseParams = {
    modelDescription: 'Test model',
    garmentDescription: 'Test garment',
    shotDescription: 'Test shot',
    garmentCategory: 'pants',
    metadata: {},
  };

  it('includes body shape rules for pants category', () => {
    const prompt = buildGenerationPrompt({
      ...baseParams,
      garmentCategory: 'pants',
    });
    expect(prompt).toContain('Denim starts from the back');
    expect(prompt).toContain('BODY SHAPE');
  });

  it('includes anti-hallucination rules', () => {
    const prompt = buildGenerationPrompt(baseParams);
    expect(prompt).toContain('FIDELITY RULES');
    expect(prompt).toContain('GARMENT FIDELITY');
  });

  it('includes anti-AI rules for non-cropped shots', () => {
    const prompt = buildGenerationPrompt(baseParams);
    expect(prompt).toContain('ANATOMICAL PROPORTIONS');
  });

  it('M01 shot type includes CROPPED framing rules, excludes full anti-AI rules', () => {
    const prompt = buildGenerationPrompt({
      ...baseParams,
      shotType: 'M01',
    });
    expect(prompt).toContain('CROPPED PRODUCT SHOT');
    expect(prompt).toContain('HEAD/FACE RULES SUPPRESSED');
    expect(prompt).not.toContain('ANATOMICAL PROPORTIONS');
  });

  it('M02 shot type includes CROPPED framing rules', () => {
    const prompt = buildGenerationPrompt({
      ...baseParams,
      shotType: 'M02',
    });
    expect(prompt).toContain('CROPPED PRODUCT SHOT');
  });

  it('floor-length metadata (floorDistance: 0) includes FLOOR_LENGTH_RULES', () => {
    const prompt = buildGenerationPrompt({
      ...baseParams,
      metadata: { floorDistance: '0' },
    });
    expect(prompt).toContain('FLOOR-LENGTH HEM OVERRIDE');
  });

  it('floor-length metadata (0 - touching) includes FLOOR_LENGTH_RULES', () => {
    const prompt = buildGenerationPrompt({
      ...baseParams,
      metadata: { floorDistance: '0 - touching' },
    });
    expect(prompt).toContain('FLOOR-LENGTH HEM OVERRIDE');
  });

  it('ankle-length metadata (5cm) includes ANKLE_LENGTH_RULES', () => {
    const prompt = buildGenerationPrompt({
      ...baseParams,
      metadata: { floorDistance: '5cm' },
    });
    expect(prompt).toContain('ANKLE-LENGTH HEM PRECISION');
  });

  it('includes model description', () => {
    const prompt = buildGenerationPrompt({
      ...baseParams,
      modelDescription: 'My custom model',
    });
    expect(prompt).toContain('My custom model');
  });

  it('includes garment description', () => {
    const prompt = buildGenerationPrompt({
      ...baseParams,
      garmentDescription: 'My custom garment',
    });
    expect(prompt).toContain('My custom garment');
  });

  it('includes shot description', () => {
    const prompt = buildGenerationPrompt({
      ...baseParams,
      shotDescription: 'My custom shot',
    });
    expect(prompt).toContain('My custom shot');
  });
});

describe('buildQCPrompt', () => {
  const baseParams = {
    shotType: 'M03',
    garmentCategory: 'pants',
    garmentDescription: 'Test jeans',
    metadata: {},
  };

  it('includes weighted_score in output', () => {
    const prompt = buildQCPrompt(baseParams);
    expect(prompt).toContain('weighted_score');
  });

  it('includes construction fidelity scoring', () => {
    const prompt = buildQCPrompt(baseParams);
    expect(prompt).toContain('CONSTRUCTION FIDELITY');
  });

  it('includes JSON template structure with 4 dimensions', () => {
    const prompt = buildQCPrompt(baseParams);
    expect(prompt).toContain('"color_match"');
    expect(prompt).toContain('"waist_height"');
    expect(prompt).toContain('"garment_length"');
    expect(prompt).toContain('"construction_fidelity"');
  });
});

describe('SHOT_DESCRIPTIONS', () => {
  it('has entry for M01', () => {
    expect(SHOT_DESCRIPTIONS.M01).toBeDefined();
    expect(typeof SHOT_DESCRIPTIONS.M01).toBe('string');
    expect(SHOT_DESCRIPTIONS.M01.length).toBeGreaterThan(0);
  });

  it('has entry for M02', () => {
    expect(SHOT_DESCRIPTIONS.M02).toBeDefined();
    expect(SHOT_DESCRIPTIONS.M02.length).toBeGreaterThan(0);
  });

  it('has entry for M03', () => {
    expect(SHOT_DESCRIPTIONS.M03).toBeDefined();
    expect(SHOT_DESCRIPTIONS.M03.length).toBeGreaterThan(0);
  });

  it('has entry for M04', () => {
    expect(SHOT_DESCRIPTIONS.M04).toBeDefined();
    expect(SHOT_DESCRIPTIONS.M04.length).toBeGreaterThan(0);
  });

  it('has entry for M05', () => {
    expect(SHOT_DESCRIPTIONS.M05).toBeDefined();
    expect(SHOT_DESCRIPTIONS.M05.length).toBeGreaterThan(0);
  });

  it('M01 mentions CROPPED', () => {
    expect(SHOT_DESCRIPTIONS.M01).toContain('CROPPED');
  });

  it('M05 mentions detail shot', () => {
    const m05 = SHOT_DESCRIPTIONS.M05;
    expect(m05).toMatch(/DETAIL SHOT|CLOSE-UP|back pocket/i);
  });
});

describe('ZONE_DEFS', () => {
  it('pants has hip zone', () => {
    expect(ZONE_DEFS.pants.hip).toBeDefined();
    expect(ZONE_DEFS.pants.hip.y1).toBeGreaterThanOrEqual(0);
    expect(ZONE_DEFS.pants.hip.y2).toBeLessThanOrEqual(1);
  });

  it('pants has knee zone', () => {
    expect(ZONE_DEFS.pants.knee).toBeDefined();
    expect(ZONE_DEFS.pants.knee.name).toContain('Knee');
  });

  it('pants has ankle zone', () => {
    expect(ZONE_DEFS.pants.ankle).toBeDefined();
    expect(ZONE_DEFS.pants.ankle.name).toContain('Ankle');
  });

  it('pants has back zone', () => {
    expect(ZONE_DEFS.pants.back).toBeDefined();
    expect(ZONE_DEFS.pants.back.name).toContain('Back');
  });

  it('hip zone has angles array', () => {
    expect(Array.isArray(ZONE_DEFS.pants.hip.angles)).toBe(true);
    expect(ZONE_DEFS.pants.hip.angles.length).toBeGreaterThan(0);
  });
});

describe('REF_LABELS', () => {
  it('has modelCard label', () => {
    expect(REF_LABELS.modelCard).toBeDefined();
    expect(typeof REF_LABELS.modelCard).toBe('string');
  });

  it('has flatImage label', () => {
    expect(REF_LABELS.flatImage).toBeDefined();
    expect(typeof REF_LABELS.flatImage).toBe('string');
  });

  it('has mannequinFront label', () => {
    expect(REF_LABELS.mannequinFront).toBeDefined();
    expect(typeof REF_LABELS.mannequinFront).toBe('string');
  });

  it('zoneGrid is a function', () => {
    expect(typeof REF_LABELS.zoneGrid).toBe('function');
  });

  it('zoneGrid returns formatted string', () => {
    const result = REF_LABELS.zoneGrid('test zone', 1, 5);
    expect(result).toContain('CONSTRUCTION DETAIL GRID');
    expect(result).toContain('test zone');
  });
});
