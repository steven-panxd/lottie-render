import { describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import sample from '../fixtures/sample.json';
import { renderLottie } from '../../src';

async function scratch() { return fs.mkdtemp(path.join(os.tmpdir(), 'lean-render-test-')); }
function probe(file: string) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames,duration,width,height', '-of', 'json', file], { encoding: 'utf8' })).streams[0];
}
describe('low-memory renderer', () => {
  it('resamples fewer frames while preserving duration; accepts shell metacharacters in output paths', async () => {
    const dir = await scratch();
    const outputPath = path.join(dir, 'a "quoted" $(touch SHOULD_NOT_EXIST).mp4');
    try {
      const events: number[] = [];
      const result = await renderLottie(sample, { fps: 5, frameRateMode: 'resample', outputPath,
        onProgress: p => { if (p.phase === 'capture') events.push(p.completedFrames); } });
      expect(result.success).toBe(true);
      const video = probe(outputPath);
      expect(Number(video.nb_read_frames)).toBe(5);
      expect(Number(video.duration)).toBeCloseTo(1, 5);
      expect(events).toEqual([1, 2, 3, 4, 5]);
      expect(await fs.readdir(dir)).toEqual([path.basename(outputPath)]);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('cancels during capture, does not overwrite an existing destination', async () => {
    const dir = await scratch();
    const outputPath = path.join(dir, 'existing.mp4');
    const controller = new AbortController();
    await fs.writeFile(outputPath, 'original');
    try {
      const result = await renderLottie(sample, { outputPath, signal: controller.signal,
        onProgress: p => { if (p.phase === 'capture') controller.abort(); } });
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('ABORTED');
      expect(await fs.readFile(outputPath, 'utf8')).toBe('original');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('enforces the total deadline without leaving a partial output', async () => {
    const dir = await scratch();
    try {
      const result = await renderLottie(sample, { timeoutMs: 1, outputPath: path.join(dir, 'out.mp4') });
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('TIMEOUT');
      expect(await fs.readdir(dir)).toEqual([]);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('cancels the encoder and removes its temporary frame directory', async () => {
    const dir = await scratch();
    const controller = new AbortController();
    const originalMkdtemp = fs.mkdtemp.bind(fs);
    const directories: string[] = [];
    const spy = vi.spyOn(fs, 'mkdtemp').mockImplementation(async (prefix: any) => {
      const directory = await originalMkdtemp(prefix);
      directories.push(directory);
      return directory;
    });
    try {
      const result = await renderLottie(sample, { outputPath: path.join(dir, 'out.mp4'), signal: controller.signal,
        onProgress: p => { if (p.phase === 'encoding') queueMicrotask(() => controller.abort()); } });
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('ABORTED');
      expect(await fs.readdir(dir)).toEqual([]);
      expect(directories.length).toBeGreaterThan(0);
      for (const directory of directories) await expect(fs.access(directory)).rejects.toThrow();
    } finally { spy.mockRestore(); await fs.rm(dir, { recursive: true, force: true }); }
  });
});
