import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';

afterEach(() => vi.unstubAllEnvs());

describe('demo discovery pages', () => {
  it('serves crawlable metadata and real configured limits without trusting request host headers', async () => {
    vi.stubEnv('RENDER_PRESET', 'demo');
    vi.stubEnv('PUBLIC_URL', 'https://demo.example.com');
    vi.stubEnv('MAX_DURATION_SECONDS', '5');
    const app = createApp();
    const page = await request(app).get('/').set('Host', 'untrusted.example');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<link rel="canonical" href="https://demo.example.com/">');
    expect(page.text).toContain('MiB and 5 seconds long');
    expect(page.text).not.toContain('untrusted.example');
    expect(page.text).not.toContain('{{MAX_');
    const schema = JSON.parse(page.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]);
    expect(schema.url).toBe('https://demo.example.com/');
    expect(schema['@type']).toBe('WebApplication');
    expect(schema).not.toHaveProperty('aggregateRating');
    expect((await request(app).get('/robots.txt')).text).toContain('Sitemap: https://demo.example.com/sitemap.xml');
    expect((await request(app).get('/sitemap.xml')).text).toContain('<loc>https://demo.example.com/</loc>');
    expect((await request(app).get('/index.html')).headers.location).toBe('/');
    expect((await request(app).get('/preview.html')).headers['x-robots-tag']).toBe('noindex');
    expect((await request(app).get('/llms.txt')).text).toContain('Chromium');
  });

  it('keeps an unconfigured demo unindexed and rejects invalid public origins', async () => {
    vi.stubEnv('RENDER_PRESET', 'demo');
    vi.stubEnv('PUBLIC_URL', '');
    const app = createApp();
    expect((await request(app).get('/')).text).toContain('name="robots" content="noindex"');
    expect((await request(app).get('/robots.txt')).text).toBe('User-agent: *\nDisallow: /\n');
    expect((await request(app).get('/sitemap.xml')).status).toBe(404);
    for (const url of ['javascript:alert(1)', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com/?query=yes']) {
      vi.stubEnv('PUBLIC_URL', url);
      expect(() => createApp()).toThrow('PUBLIC_URL');
    }
  });
});
