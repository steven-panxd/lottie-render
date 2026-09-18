import { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { getSettings } from './config';

function publicUrl(): string | undefined {
  if (!process.env.PUBLIC_URL) return undefined;
  const url = new URL(process.env.PUBLIC_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_URL must be an HTTP(S) origin, without credentials, a path, query or fragment');
  }
  return url.origin + '/';
}

export function serveDemoPages(app: Express) {
  const url = publicUrl();
  const settings = getSettings();
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
  const schema = {
    '@context': 'https://schema.org', '@type': 'WebApplication', name: 'lottie-render',
    ...(url ? { url } : {}), applicationCategory: 'MultimediaApplication', operatingSystem: 'Any',
    description: 'Preview a Lottie JSON animation locally, then convert it on the server to a silent H.264 MP4 with a white background.',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    license: 'https://github.com/steven-panxd/lottie-render/blob/main/LICENSE',
    author: { '@type': 'Person', name: 'Steven Pan', url: 'https://www.xuedo.ng/' },
  };
  const discovery = url
    ? `<link rel="canonical" href="${escape(url)}">\n<meta property="og:url" content="${escape(url)}">`
    : '<meta name="robots" content="noindex">';
  const html = fs.readFileSync(path.resolve(__dirname, '../../public/index.html'), 'utf8')
    .replace('<!-- DISCOVERY -->', `${discovery}\n<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`)
    .replace(/{{MAX_UPLOAD_MIB}}/g, String(settings.maxUploadBytes / 1048576))
    .replace(/{{MAX_DURATION}}/g, String(settings.maxDuration))
    .replace(/{{MAX_DIMENSION}}/g, String(settings.maxDimension))
    .replace(/{{MAX_CONCURRENT}}/g, String(settings.maxConcurrent));
  app.get('/', (_req, res) => res.type('html').send(html));
  app.get('/index.html', (_req, res) => res.redirect(308, '/'));
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send(url
    ? `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${url}sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n'));
  app.get('/sitemap.xml', (_req, res) => {
    if (!url) return res.sendStatus(404);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escape(url)}</loc></url></urlset>`);
  });
  app.get('/preview.html', (_req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex'); next(); });
}
