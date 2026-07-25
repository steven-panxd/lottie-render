import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { renderLottie } from '../../src/index';
import { isValidMp4 } from './helpers/binary-parser';

const sampleJson = JSON.parse(
  readFileSync(path.resolve(__dirname, '../fixtures/sample.json'), 'utf-8')
);

describe('library entry point (src/index.ts)', () => {
  it('renders a parsed Lottie object and returns an in-memory buffer with no outputPath', async () => {
    const cwdBefore = new Set(await fs.readdir(process.cwd()));

    const result = await renderLottie(sampleJson);

    const cwdAfter = new Set(await fs.readdir(process.cwd()));
    // A few entries may legitimately appear here even though this test never
    // touches them, because vitest can run other test files concurrently in
    // the same worker (shared process cwd): `videos`/`logs` are created by
    // the e2e HTTP test files' buildTestApp(), and `dist` is (re)built by
    // package-install.test.ts's beforeAll. Ignore only these known, unrelated
    // entries — anything else appearing (e.g. a `temp/` dir) would mean the
    // library itself wrote into the caller's cwd, which is exactly the
    // regression this test guards against.
    const KNOWN_CONCURRENT_TEST_ENTRIES = new Set(['videos', 'logs', 'dist']);
    const newTopLevelEntries = [...cwdAfter].filter(
      (entry) => !cwdBefore.has(entry) && !KNOWN_CONCURRENT_TEST_ENTRIES.has(entry)
    );

    expect(result.success).toBe(true);
    expect(result.videoPath).toBeUndefined();
    expect(result.videoBuffer).toBeInstanceOf(Buffer);
    expect(isValidMp4(result.videoBuffer as Buffer)).toBe(true);
    expect(newTopLevelEntries).toEqual([]);
  });

  it('writes to an explicit outputPath and returns no buffer', async () => {
    const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lottie-render-lib-test-'));
    const outputPath = path.join(scratchDir, 'out.mp4');

    try {
      const result = await renderLottie(sampleJson, { outputPath });

      expect(result.success).toBe(true);
      expect(result.videoPath).toBe(outputPath);
      expect(result.videoBuffer).toBeUndefined();

      const written = await fs.readFile(outputPath);
      expect(isValidMp4(written)).toBe(true);
    } finally {
      await fs.rm(scratchDir, { recursive: true, force: true });
    }
  });

  it('reports metadata for the actual rendered output, not the source JSON, when options override it', async () => {
    // sample.json is authored at 10fps/200x200 (see test/fixtures/sample.json).
    // Overriding fps/width/height must be reflected back in the returned
    // metadata — otherwise a caller has no reliable way to know what was
    // actually produced.
    const result = await renderLottie(sampleJson, { fps: 20, width: 100, height: 100 });

    expect(result.success).toBe(true);
    expect(result.metadata?.fps).toBe(20);
    expect(result.metadata?.width).toBe(100);
    expect(result.metadata?.height).toBe(100);
    // 10 frames captured either way (fixed by the source ip/op range);
    // played back at 20fps instead of the source's 10fps, so the output is
    // half the original 1s duration.
    expect(result.metadata?.duration).toBeCloseTo(0.5, 5);
  });
});
