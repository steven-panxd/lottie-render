import { createApp, errorHandler } from './app';
import { createRouter } from './routes';
import { getSettings } from './config';
import dotenv from 'dotenv';

dotenv.config();
const settings = getSettings();
if (process.env.NODE_ENV === 'production' && !process.env.API_KEY && !settings.demo) {
  console.error('API_KEY is required in production. For a deliberately public, limited demo, set RENDER_PRESET=demo.');
  process.exit(1);
}
const app = createApp();
app.use('/api', createRouter());
app.use(errorHandler);
const server = app.listen(settings.port, () => console.log(`lottie-render ${settings.demo ? 'demo' : 'API'}: http://localhost:${settings.port}`));
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 30_000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
