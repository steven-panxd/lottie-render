import { describe, expect, it } from 'vitest';
import sample from '../fixtures/sample.json';
import { createRenderPlan } from '../../src/renderer/plan';

describe('render planning before browser launch', () => {
  it('preserves the old speed mode and makes resampling explicit', () => {
    expect(createRenderPlan(sample, { fps: 5 }).frameCount).toBe(10);
    const plan = createRenderPlan(sample, { fps: 5, frameRateMode: 'resample' });
    expect(plan.frameCount).toBe(5);
    expect(plan.sourceFrame(2)).toBe(4);
  });
  it('uses relative frames when the source has a nonzero in point', () => {
    const plan = createRenderPlan({ ...sample, ip: 10, op: 20 }, { fps: 5, frameRateMode: 'resample' });
    expect(plan.sourceFrame(0)).toBe(0);
    expect(plan.sourceFrame(4)).toBe(8);
  });
  it('counts output frames for resampling, independently caps source duration', () => {
    expect(createRenderPlan({ ...sample, fr: 60, op: 600 }, { fps: 30, frameRateMode: 'resample', maxFrames: 300 }).frameCount).toBe(300);
    expect(() => createRenderPlan({ ...sample, op: 1000 }, { fps: 1, frameRateMode: 'resample', maxDuration: 10 })).toThrow(/duration/);
  });
  it('preserves JPEG quality zero and rejects invalid numeric values', () => {
    expect(createRenderPlan(sample, { quality: 0 }).quality).toBe(0);
    for (const options of [{ fps: NaN }, { fps: Infinity }, { width: 101 }, { width: -1 }, { quality: 101 }, { maxFrames: NaN }, { threads: 0 }]) {
      expect(() => createRenderPlan(sample, options)).toThrow();
    }
  });
});
