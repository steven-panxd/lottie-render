import fs from 'fs';
import path from 'path';
import { createApp, errorHandler } from '../../../src/server/app';
import { createRouter } from '../../../src/server/routes';

/**
 * Builds the same Express app used in production (src/server/start.ts),
 * minus the process-level side effects (dotenv loading, production API_KEY
 * gate, process.listen) that don't belong in a test process.
 */
export function buildTestApp() {
  for (const dir of ['videos', 'logs']) {
    const dirPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  const app = createApp();
  app.use('/api', createRouter());
  app.use(errorHandler);
  return app;
}
