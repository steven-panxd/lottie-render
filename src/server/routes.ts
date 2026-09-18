import { randomUUID } from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { renderLottie } from '../renderer/frame-by-frame';
import { RenderOptions } from '../types';
import { apiKeyAuth } from './app';
import { getSettings } from './config';

/** Each service instance owns its own admission counter. Run one replica for a global limit of one. */
export function createRouter(): Router {
  const router = Router();
  let active = 0;
  const clients = new Map<string, { count: number; reset: number }>();
  const states = new WeakMap<Request, { release: () => void; controller: AbortController; rendering: boolean }>();

  function admit(req: Request, res: Response, next: NextFunction) {
    const settings = getSettings();
    if (active >= settings.maxConcurrent) {
      res.setHeader('Retry-After', '5');
      return res.status(503).json({ success: false, error: 'Server is busy. Please retry later.' });
    }
    if (settings.demo) {
      const now = Date.now();
      for (const [ip, entry] of clients) if (entry.reset <= now) clients.delete(ip);
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const entry = clients.get(ip) || { count: 0, reset: now + 60_000 };
      if (entry.count >= settings.requestsPerMinute || (!clients.has(ip) && clients.size >= 4096)) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.reset - now) / 1000))));
        return res.status(429).json({ success: false, error: 'Too many requests. Please retry later.' });
      }
      entry.count++;
      clients.set(ip, entry);
    }
    active++;
    let released = false;
    const state = { controller: new AbortController(), rendering: false,
      release: () => { if (!released) { active--; released = true; } } };
    states.set(req, state);
    const disconnected = () => {
      if (!res.writableFinished) state.controller.abort();
      if (!state.rendering) state.release();
    };
    req.once('aborted', disconnected);
    res.once('close', disconnected);
    res.once('finish', () => { if (!state.rendering) state.release(); });
    // Reserve a slot BEFORE Multer buffers the upload. Reject stalled uploads too.
    req.setTimeout(Math.min(settings.timeoutMs, 30_000), () => req.destroy());
    next();
  }

  function upload(req: Request, res: Response, next: NextFunction) {
    multer({ storage: multer.memoryStorage(), limits: { fileSize: getSettings().maxUploadBytes, files: 1, fields: 6, parts: 7, fieldSize: 256 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) cb(null, true);
        else cb(Object.assign(new Error('Only JSON files are allowed'), { statusCode: 400 }));
      },
    }).single('file')(req, res, next);
  }

  router.post('/render', apiKeyAuth, admit, upload, async (req, res, next) => {
    const state = states.get(req)!;
    state.rendering = true;
    req.setTimeout(0);
    let scratch: string | undefined;
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded. Use field "file".' });
      let json;
      try { json = JSON.parse(req.file.buffer.toString('utf8')); }
      catch { return res.status(400).json({ success: false, error: 'Invalid JSON file' }); }
      const settings = getSettings();
      const numeric = (name: string) => {
        if (req.body[name] === undefined) return undefined;
        const value = Number(req.body[name]);
        if (!Number.isFinite(value) || value < 0 || (name !== 'quality' && value === 0)) throw new Error(`Invalid ${name}`);
        return value;
      };
      let options: RenderOptions;
      try {
        options = { width: numeric('width'), height: numeric('height'), fps: numeric('fps'), quality: numeric('quality'),
          backgroundColor: req.body.backgroundColor || (settings.demo ? '#ffffff' : undefined),
          frameRateMode: req.body.frameRateMode || 'speed',
          maxFrames: settings.maxFrames, maxDimension: settings.maxDimension, maxDuration: settings.maxDuration,
          timeoutMs: settings.timeoutMs, signal: state.controller.signal };
        for (const key of ['width', 'height'] as const) {
          if (options[key] !== undefined && (!Number.isInteger(options[key]) || options[key]! > settings.maxDimension)) throw new Error(`Invalid ${key}: maximum ${settings.maxDimension}`);
        }
        if (settings.demo) {
          // Preserve the source aspect ratio and never enlarge it.
          if (!json || !Number.isFinite(json.w) || json.w < 2 || !Number.isFinite(json.h) || json.h < 2) throw new Error('Invalid source dimensions');
          const scale = Math.min(1, (options.width ?? settings.maxDimension) / json.w, (options.height ?? settings.maxDimension) / json.h);
          options.width = Math.max(2, Math.floor(json.w * scale / 2) * 2);
          options.height = Math.max(2, Math.floor(json.h * scale / 2) * 2);
          options.fps = Math.min(options.fps ?? json.fr, json.fr, 30);
          options.frameRateMode = 'resample';
          options.encodingPreset = 'veryfast';
          options.crf = 25;
        }
      } catch (error) { return res.status(400).json({ success: false, error: (error as Error).message }); }
      scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'lottie-http-'));
      const result = await renderLottie(json, { ...options, outputPath: path.join(scratch, 'output.mp4') });
      if (res.destroyed) return;
      if (!result.success) {
        return res.status(result.errorCode === 'INVALID_INPUT' ? 400 : result.errorCode === 'TIMEOUT' ? 504 : 500)
          .json({ success: false, error: result.error, errorCode: result.errorCode });
      }
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'attachment; filename="lottie.mp4"');
      res.setHeader('X-Task-ID', randomUUID());
      res.setHeader('X-Render-Duration', String(result.duration));
      res.setHeader('X-Video-Duration', String(result.metadata.duration));
      res.setHeader('X-Video-FPS', String(result.metadata.fps));
      res.setHeader('X-Video-Width', String(result.metadata.width));
      res.setHeader('X-Video-Height', String(result.metadata.height));
      await new Promise<void>((resolve, reject) => res.sendFile(result.videoPath!, error => error ? reject(error) : resolve()));
    } catch (error) { next(error); }
    finally {
      if (scratch) await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
      state.rendering = false;
      state.release();
    }
  });
  router.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime(), activeRenders: active,
    memory: { used: Math.round(process.memoryUsage().heapUsed / 1024 ** 2), total: Math.round(process.memoryUsage().heapTotal / 1024 ** 2) } }));
  router.get('/config', (_req, res) => {
    const settings = getSettings();
    res.json({ demo: settings.demo, requiresApiKey: Boolean(process.env.API_KEY), maxUploadBytes: settings.maxUploadBytes,
      maxDimension: settings.maxDimension, maxDuration: settings.maxDuration, maxFrames: settings.maxFrames, timeoutMs: settings.timeoutMs });
  });
  return router;
}
export default createRouter();
