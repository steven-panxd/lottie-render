import { describe, expect, it } from 'vitest';
import { extractMetadata } from '../../src/renderer/frame-by-frame';
import { LottieJSON } from '../../src/types';

function baseJson(overrides: Partial<LottieJSON> = {}): LottieJSON {
  return {
    v: '5.12.2',
    fr: 30,
    ip: 0,
    op: 90,
    w: 1920,
    h: 1080,
    ...overrides,
  };
}

describe('extractMetadata', () => {
  it('computes frame count and duration from ip/op/fr', () => {
    const metadata = extractMetadata(baseJson({ fr: 30, ip: 0, op: 90 }));
    expect(metadata.totalFrames).toBe(90);
    expect(metadata.fps).toBe(30);
    expect(metadata.duration).toBeCloseTo(3, 5);
  });

  it('honors a non-zero in point', () => {
    const metadata = extractMetadata(baseJson({ fr: 24, ip: 10, op: 34 }));
    expect(metadata.totalFrames).toBe(24);
    expect(metadata.duration).toBeCloseTo(1, 5);
  });

  it('defaults fps to 30 when missing', () => {
    const metadata = extractMetadata(baseJson({ fr: 0 as any, ip: 0, op: 30 }));
    expect(metadata.fps).toBe(30);
  });

  it('carries through width, height, and name', () => {
    const metadata = extractMetadata(baseJson({ w: 640, h: 480, nm: 'My Animation' }));
    expect(metadata.width).toBe(640);
    expect(metadata.height).toBe(480);
    expect(metadata.name).toBe('My Animation');
  });

  it('produces zero/negative frame counts for a degenerate range without throwing', () => {
    const metadata = extractMetadata(baseJson({ ip: 50, op: 10 }));
    expect(metadata.totalFrames).toBeLessThanOrEqual(0);
  });
});
