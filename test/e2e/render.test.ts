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

  it('returns 503 when the concurrency limit is already reached', async () => {
    process.env.MAX_CONCURRENT_RENDERS = '1';

    // supertest/superagent requests are lazy: they don't actually send until
    // awaited, `.then()`-ed, or `.end()`-ed. Use `.end()` so the first
    // request is genuinely in flight while we fire the second one.
    const first = new Promise<request.Response>((resolve, reject) => {
      request(app)
        .post('/api/render')
        .attach('file', sampleFixture)
        .end((err, res) => (err && !res ? reject(err) : resolve(res)));
    });

    // Give the first request a moment to pass its own concurrency check and
    // increment the in-flight counter before firing the second.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const second = await request(app).post('/api/render').attach('file', sampleFixture);
    expect(second.status).toBe(503);
    expect(second.body.error).toMatch(/server is busy/i);

    const firstRes = await first;
    expect(firstRes.status).toBe(200);
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
