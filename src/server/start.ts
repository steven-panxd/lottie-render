import { createApp, errorHandler } from './app';
import routes from './routes';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Refuse to start unauthenticated in production. Outside production, an
// unset API_KEY only disables auth for local development convenience.
if (process.env.NODE_ENV === 'production' && !process.env.API_KEY) {
  console.error('💥 API_KEY is required when NODE_ENV=production.');
  console.error('   Set API_KEY to a strong secret, or unset NODE_ENV for local development.');
  process.exit(1);
}

// Ensure required directories exist
const requiredDirs = ['videos', 'logs'];
for (const dir of requiredDirs) {
  const dirPath = path.join(process.cwd(), dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
}

// Create the Express app
const app = createApp();

// Register routes
app.use('/api', routes);

// Error-handling middleware (must be registered after all routes)
app.use(errorHandler);

// Port configuration
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Start the server
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
    console.log('⚠️  API Key not configured (authentication disabled — development only)');
    console.log('   Set API_KEY environment variable to enable authentication');
  }
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  console.log('');
  console.log('⏳ Received shutdown signal, closing server gracefully...');

  server.close(() => {
    console.log('✅ Server closed successfully');
    process.exit(0);
  });

  // Force-exit if shutdown takes too long (30s)
  setTimeout(() => {
    console.error('❌ Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

// Uncaught error handling
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
