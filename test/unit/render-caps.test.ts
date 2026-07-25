import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { renderLottie } from '../../src/renderer/frame-by-frame';

// These tests exercise the fast-fail validation paths (frame count / dimension
// caps) which run before the browser is launched, so they stay quick even
// though they live alongside the renderer.

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lottie-render-caps-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeFixture(json: object): Promise<string> {
  const file = path.join(tmpDir, 'animation.json');
  await fs.writeFile(file, JSON.stringify(json));
  return file;
}

describe('render resource caps', () => {
  it('rejects animations with more frames than MAX_FRAMES allows', async () => {
    const jsonPath = await writeFixture({
      v: '5.12.2',
      fr: 30,
      ip: 0,
      op: 10_000_000,
      w: 100,
      h: 100,
      layers: [],
    });

    const result = await renderLottie(jsonPath);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exceeds the maximum allowed/i);
  });

  it('rejects a zero-frame animation', async () => {
    const jsonPath = await writeFixture({
      v: '5.12.2',
      fr: 30,
      ip: 0,
      op: 0,
      w: 100,
      h: 100,
      layers: [],
    });

    const result = await renderLottie(jsonPath);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no frames to render/i);
  });

  it('rejects dimensions larger than MAX_DIMENSION', async () => {
    const jsonPath = await writeFixture({
      v: '5.12.2',
      fr: 30,
      ip: 0,
      op: 10,
      w: 100,
      h: 100,
      layers: [],
    });

    const result = await renderLottie(jsonPath, { width: 999_999, height: 100 });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exceed the maximum allowed dimension/i);
  });
});
