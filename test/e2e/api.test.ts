import { afterEach, describe, expect, it } from 'vitest';
import path from 'path';
import request from 'supertest';
import { buildTestApp } from './helpers/build-app';

const app = buildTestApp();
const sampleFixture = path.resolve(__dirname, '../fixtures/sample.json');

describe('GET /api/health', () => {
  it('reports ok status', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });
});

describe('POST /api/render validation', () => {
  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('rejects a request with no file', async () => {
    const res = await request(app).post('/api/render');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/no file uploaded/i);
  });

  it('rejects malformed JSON content', async () => {
    const res = await request(app)
      .post('/api/render')
      .attach('file', Buffer.from('{ not valid json'), 'broken.json');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid json/i);
  });

  it('rejects a non-JSON file upload with 400', async () => {
    const res = await request(app)
      .post('/api/render')
      .attach('file', Buffer.from('hello world'), { filename: 'not-lottie.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only json files are allowed/i);
  });

  it('rejects out-of-range width', async () => {
    const res = await request(app)
      .post('/api/render')
      .field('width', '999999')
      .attach('file', sampleFixture);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid width/i);
  });
});

describe('POST /api/render authentication', () => {
  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('allows requests without a key when API_KEY is unset (dev mode)', async () => {
    delete process.env.API_KEY;

    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('rejects requests missing the API key when one is configured', async () => {
    process.env.API_KEY = 'test-secret';

    const res = await request(app)
      .post('/api/render')
      .attach('file', sampleFixture);

    expect(res.status).toBe(401);
  });

  it('rejects requests with the wrong API key', async () => {
    process.env.API_KEY = 'test-secret';

    const res = await request(app)
      .post('/api/render')
      .set('X-API-Key', 'wrong-key')
      .attach('file', sampleFixture);

    expect(res.status).toBe(403);
  });
});
