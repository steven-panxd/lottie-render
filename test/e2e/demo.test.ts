import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import http from 'http';
import sample from '../fixtures/sample.json';
import { buildTestApp } from './helpers/build-app';
import { binaryParser, isValidMp4 } from './helpers/binary-parser';

afterEach(() => vi.unstubAllEnvs());
describe('public demo preset', () => {
  it('serves the UI and renders a scaled, duration-preserving MP4', async () => {
    vi.stubEnv('RENDER_PRESET', 'demo');
    const app = buildTestApp();
    expect((await request(app).get('/')).text).toContain('Convert to MP4');
    const config = await request(app).get('/api/config');
    expect(config.body.requiresApiKey).toBe(false);
    expect(config.body.maxUploadBytes).toBe(2097152);
    const res = await request(app).post('/api/render')
      .attach('file', Buffer.from(JSON.stringify({ ...sample, w: 1024, h: 512, fr: 60, op: 60 })), 'sample.json')
      .buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers['x-video-width']).toBe('512');
    expect(res.headers['x-video-height']).toBe('256');
    expect(res.headers['x-video-fps']).toBe('30');
    expect(Number(res.headers['x-video-duration'])).toBeCloseTo(1, 5);
    expect(isValidMp4(res.body)).toBe(true);
  });
  it('rejects oversized uploads and frees the admission slot', async () => {
    vi.stubEnv('RENDER_PRESET', 'demo');
    vi.stubEnv('MAX_UPLOAD_BYTES', '32');
    const app = buildTestApp();
    expect((await request(app).post('/api/render').attach('file', Buffer.alloc(33), 'large.json')).status).toBe(413);
    expect((await request(app).post('/api/render')).status).toBe(400);
    expect((await request(app).get('/api/health')).body.activeRenders).toBe(0);
  });
  it('limits repeated demo submissions without trusting spoofed forwarded IPs', async () => {
    vi.stubEnv('RENDER_PRESET', 'demo');
    vi.stubEnv('REQUESTS_PER_MINUTE', '1');
    const app = buildTestApp();
    expect((await request(app).post('/api/render')).status).toBe(400);
    const res = await request(app).post('/api/render').set('X-Forwarded-For', '8.8.8.8');
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
  it('cancels a disconnected HTTP render and releases its slot', async () => {
    vi.stubEnv('RENDER_PRESET', 'demo');
    const server = buildTestApp().listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const port = (server.address() as { port: number }).port;
    const body = '--cancel-test\r\nContent-Disposition: form-data; name="file"; filename="animation.json"\r\nContent-Type: application/json\r\n\r\n'
      + JSON.stringify({ ...sample, fr: 30, op: 300 }) + '\r\n--cancel-test--\r\n';
    const client = http.request({ port, method: 'POST', path: '/api/render', headers: {
      'Content-Type': 'multipart/form-data; boundary=cancel-test', 'Content-Length': Buffer.byteLength(body),
    } });
    client.on('error', () => {});
    client.on('response', response => response.resume());
    try {
      client.end(body);
      let active = 0;
      for (let i = 0; i < 100; i++) {
        active = (await request(server).get('/api/health')).body.activeRenders;
        if (active === 1) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(active).toBe(1);
      client.destroy();
      for (let i = 0; i < 200; i++) {
        active = (await request(server).get('/api/health')).body.activeRenders;
        if (active === 0) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(active).toBe(0);
    } finally {
      client.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
