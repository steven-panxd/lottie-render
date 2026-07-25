import express, { Express, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';

// Multer config for handling the uploaded Lottie JSON file
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only accept JSON files
    if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      const error: any = new Error('Only JSON files are allowed');
      error.statusCode = 400;
      cb(error);
    }
  },
});

/**
 * API key middleware. In production, API_KEY must be set — the server
 * refuses to start otherwise (see start.ts). Outside production, an unset
 * API_KEY disables auth for local development convenience only.
 */
function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    return next();
  }

  const requestApiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!requestApiKey) {
    return res.status(401).json({
      success: false,
      error: 'API key is required. Provide it in X-API-Key header or Authorization header',
    });
  }

  if (requestApiKey !== apiKey) {
    return res.status(403).json({
      success: false,
      error: 'Invalid API key',
    });
  }

  next();
}

// Create the Express application
export function createApp(): Express {
  const app = express();

  // Body parsers for non-file-upload requests
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
    });
    next();
  });

  // Static file serving for rendered videos
  app.use('/videos', express.static(path.join(process.cwd(), 'videos')));

  return app;
}

// Error-handling middleware
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error('Error:', err);

  // Multer-specific errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 10MB',
      });
    }
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`,
    });
  }

  // Generic error handling
  res.status(err.statusCode || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

export { upload, apiKeyAuth };
