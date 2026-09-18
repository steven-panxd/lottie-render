import express, { Express, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { getSettings } from './config';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return next();
  const provided = req.headers['x-api-key'] || req.headers.authorization?.replace('Bearer ', '');
  if (!provided) return res.status(401).json({ success: false, error: 'API key is required. Provide it in X-API-Key or Authorization' });
  if (provided !== apiKey) return res.status(403).json({ success: false, error: 'Invalid API key' });
  next();
}

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  // Do not trust forwarded IP headers from arbitrary clients. A proxy may opt in to a known hop count.
  if (process.env.TRUST_PROXY_HOPS) {
    const hops = Number(process.env.TRUST_PROXY_HOPS);
    if (!Number.isSafeInteger(hops) || hops < 1) throw new Error('TRUST_PROXY_HOPS must be a positive integer');
    app.set('trust proxy', hops);
  }
  if (getSettings().demo) app.use(express.static(path.resolve(__dirname, '../../public'), { index: 'index.html' }));
  return app;
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent || res.destroyed) return;
  const uploadError = err instanceof multer.MulterError;
  const status = uploadError ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : err.statusCode || 500;
  res.status(status).json({ success: false, error: uploadError ? `Upload rejected: ${err.message}` : err.message || 'Internal server error' });
}
