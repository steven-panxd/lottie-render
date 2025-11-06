import { createApp, errorHandler } from './api/app';
import routes from './api/routes';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// 加载环境变量
dotenv.config();

// 确保必要的目录存在
const requiredDirs = ['videos', 'temp', 'logs'];
for (const dir of requiredDirs) {
  const dirPath = path.join(process.cwd(), dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
}

// 创建 Express 应用
const app = createApp();

// 注册路由
app.use('/api', routes);

// 错误处理中间件（必须在所有路由之后）
app.use(errorHandler);

// 端口配置
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// 启动服务器
const server = app.listen(PORT, () => {
  console.log('');
  console.log('🎬 Lottie Render Service');
  console.log('========================');
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`✅ API endpoint: http://localhost:${PORT}/api/render`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
  console.log('');

  if (process.env.API_KEY) {
    console.log('🔐 API Key authentication enabled');
  } else {
    console.log('⚠️  API Key not configured (authentication disabled)');
    console.log('   Set API_KEY environment variable to enable authentication');
  }
  console.log('');
});

// 优雅关闭处理
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  console.log('');
  console.log('⏳ Received shutdown signal, closing server gracefully...');

  server.close(() => {
    console.log('✅ Server closed successfully');
    process.exit(0);
  });

  // 强制关闭超时（30秒）
  setTimeout(() => {
    console.error('❌ Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

// 未捕获异常处理
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
