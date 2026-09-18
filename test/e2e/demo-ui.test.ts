import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import fs from 'fs/promises';
import request from 'supertest';
import { buildTestApp } from './helpers/build-app';

afterEach(() => vi.unstubAllEnvs());

describe('demo browser workflow', () => {
  it('only exposes the bundled preview player in demo mode', async () => {
    vi.stubEnv('RENDER_PRESET', '');
    expect((await request(buildTestApp()).get('/vendor/lottie.min.js')).status).toBe(404);
    vi.stubEnv('RENDER_PRESET', 'demo');
    const app = buildTestApp();
    expect((await request(app).get('/vendor/lottie.min.js')).status).toBe(200);
    expect((await request(app).get('/templates/vendor/lottie.min.js')).status).toBe(404);
  });

  it('previews locally, rejects invalid uploads, then renders and downloads a real MP4', async () => {
    vi.stubEnv('RENDER_PRESET', 'demo');
    vi.stubEnv('API_KEY', '');
    const server = buildTestApp().listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const port = (server.address() as { port: number }).port;
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
      const errors: string[] = [];
      const renderRequests: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', req => { if (req.url().endsWith('/api/render')) renderRequests.push(req.url()); });
      await page.goto(`http://127.0.0.1:${port}`);
      await page.waitForFunction(() => !(document.getElementById('play') as HTMLButtonElement).disabled);
      await page.getByRole('button', { name: 'Play animation', exact: true }).click();
      await page.waitForFunction(() => Number((document.getElementById('seek') as HTMLInputElement).value) > .1);
      await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
      expect(renderRequests).toHaveLength(0);
      expect(await page.locator('#animation').getAttribute('sandbox')).toBe('allow-scripts');

      await page.locator('#file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') });
      await page.waitForFunction(() => document.getElementById('status')?.dataset.error === 'true');
      expect(await page.locator('#status').textContent()).toContain('not valid JSON');
      expect(await page.locator('#filename').textContent()).toBe('sample.json');
      await page.getByRole('button', { name: 'Try a sample' }).click();
      await page.waitForFunction(() => !(document.getElementById('render') as HTMLButtonElement).disabled);
      expect(renderRequests).toHaveLength(0);

      await page.getByRole('button', { name: 'Convert to MP4', exact: true }).click();
      await page.getByRole('link', { name: 'Download MP4' }).waitFor();
      await page.waitForFunction(() => (document.getElementById('video') as HTMLVideoElement).readyState >= 2);
      expect(renderRequests).toHaveLength(1);
      expect(await page.locator('#preview-type').textContent()).toBe('MP4 preview');
      const downloadEvent = page.waitForEvent('download');
      await page.getByRole('link', { name: 'Download MP4' }).click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toBe('sample.mp4');
      const bytes = await fs.readFile((await download.path())!);
      expect(bytes.subarray(4, 8).toString()).toBe('ftyp');

      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
