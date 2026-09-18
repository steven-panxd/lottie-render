import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { buildTestApp } from './helpers/build-app';
import { binaryParser, isValidMp4 } from './helpers/binary-parser';

const app = buildTestApp();
const sampleFixture = path.resolve(__dirname, '../fixtures/sample.json');
const ssrfFixture = path.resolve(__dirname, '../fixtures/ssrf-image-asset.json');

afterEach(() => {
  delete process.env.API_KEY;
  delete process.env.MAX_CONCURRENT_RENDERS;
});

describe('POST /api/render (real render)', () => {
  it('renders a valid MP4 with correct metadata headers', async () => {
    const res = await request(app)
      .post('/api/render')
      .attach('file', sampleFixture)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['x-video-fps']).toBe('10');
    expect(res.headers['x-video-width']).toBe('200');
    expect(res.headers['x-video-height']).toBe('200');
    expect(Number(res.headers['x-video-duration'])).toBeCloseTo(1, 1);

    expect(isValidMp4(res.body as Buffer)).toBe(true);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
  });

  it('succeeds with a valid API key when one is configured', async () => {
    process.env.API_KEY = 'test-secret';

    const res = await request(app)
      .post('/api/render')
      .set('X-API-Key', 'test-secret')
      .attach('file', sampleFixture)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(isValidMp4(res.body as Buffer)).toBe(true);
  });

  it('reserves capacity before buffering an unfinished upload', async () => {
    process.env.MAX_CONCURRENT_RENDERS = '1';
    const server = buildTestApp().listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as { port: number };
    const first = http.request({ port: address.port, path: '/api/render', method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=held-upload' } });
    const completed = new Promise<number | undefined>((resolve, reject) => {
      first.on('response', response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
      first.on('error', reject);
    });
    try {
      first.write('--held-upload\r\nContent-Disposition: form-data; name="file"; filename="sample.json"\r\nContent-Type: application/json\r\n\r\n');
      for (let i = 0; i < 100; i++) {
        const health = await request(server).get('/api/health');
        if (health.body.activeRenders === 1) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect((await request(server).get('/api/health')).body.activeRenders).toBe(1);
      const second = await request(server).post('/api/render').attach('file', sampleFixture);
      expect(second.status).toBe(503);
      expect(second.headers['retry-after']).toBe('5');
      first.end((await fs.readFile(sampleFixture, 'utf8')) + '\r\n--held-upload--\r\n');
      expect(await completed).toBe(200);
    } finally {
      first.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('never contacts a remote URL referenced by an untrusted Lottie asset (SSRF protection)', async () => {
    let contacted = false;
    const canary = http.createServer((_req, res) => {
      contacted = true;
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });

    await new Promise<void>((resolve) => canary.listen(0, '127.0.0.1', resolve));
    const address = canary.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const rawFixture = await fs.readFile(ssrfFixture, 'utf-8');
      const withRealUrl = rawFixture.replace('__ASSET_URL__', `http://127.0.0.1:${port}/evil.png`);

      const tmpFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'lottie-ssrf-')), 'animation.json');
      await fs.writeFile(tmpFile, withRealUrl);

      const res = await request(app)
        .post('/api/render')
        .attach('file', tmpFile)
        .buffer(true)
        .parse(binaryParser);

      // The render should still succeed (a missing image just doesn't draw),
      // but the canary server must never have been contacted.
      expect(res.status).toBe(200);
      expect(contacted).toBe(false);
    } finally {
      await new Promise((resolve) => canary.close(resolve));
    }
  });
});
