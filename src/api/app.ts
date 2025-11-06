import express, { Express, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';

// 配置 multer 用于文件上传
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB 限制
  },
  fileFilter: (req, file, cb) => {
    // 只接受 JSON 文件
    if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('Only JSON files are allowed'));
    }
  },
});

// API Key 验证中间件
function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = process.env.API_KEY;

  // 如果未配置 API_KEY，跳过验证（开发模式）
  if (!apiKey) {
    console.warn('⚠️  API_KEY not configured, authentication disabled');
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

// 创建 Express 应用
export function createApp(): Express {
  const app = express();

  // Body parser - 用于非文件上传的请求
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // 请求日志中间件
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
    });
    next();
  });

  // 静态文件服务 - 提供视频下载
  app.use('/videos', express.static(path.join(process.cwd(), 'videos')));

  return app;
}

// 错误处理中间件
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error('Error:', err);

  // Multer 错误处理
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

  // 通用错误处理
  res.status(err.statusCode || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

// 导出 multer upload 实例和 API Key 验证中间件供路由使用
export { upload, apiKeyAuth };
