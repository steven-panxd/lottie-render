#!/usr/bin/env node
import { parseArgs } from 'util';
import { execFileSync } from 'child_process';
import { chromium } from 'playwright';
import { renderLottie } from './index';

const help = `lottie-render — Lottie JSON to MP4

  lottie-render doctor
  lottie-render render animation.json -o output.mp4 [--fps 30] [--width 512] [--height 512]
  lottie-render serve --preset demo [--port 3000]

Render flags: --fps, --width, --height, --background, --timeout (seconds), --legacy-speed
CLI fps changes preserve duration; --legacy-speed opts into the library's original behavior.
Server settings can also be supplied via environment variables. Demo mode is intentionally public.
`;

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, output: { type: 'string', short: 'o' },
    fps: { type: 'string' }, width: { type: 'string' }, height: { type: 'string' },
    background: { type: 'string' }, timeout: { type: 'string' }, 'legacy-speed': { type: 'boolean' },
    preset: { type: 'string' }, port: { type: 'string' },
  } });
  if (values.help || positionals.length === 0) { console.log(help); return; }
  const [command, input, ...extra] = positionals;
  if (extra.length) throw new Error('Unexpected positional arguments');
  if (command === 'doctor') {
    if (input) throw new Error('doctor takes no input file');
    let ok = true;
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'pipe', timeout: 5000 }); console.log('OK: FFmpeg'); }
    catch { console.error('Missing FFmpeg. macOS: brew install ffmpeg; Debian/Ubuntu: sudo apt-get install ffmpeg'); ok = false; }
    try {
      const browser = await chromium.launch({ args: ['--no-sandbox'], timeout: 10_000 });
      await browser.close();
      console.log('OK: Chromium launches');
    } catch (error) {
      console.error(`Chromium cannot launch: ${(error as Error).message}`);
      console.error('Install Chromium with: npx playwright install chromium');
      ok = false;
    }
    if (!ok) console.error('On Linux, browser libraries may need: npx playwright install --with-deps chromium');
    process.exitCode = ok ? 0 : 1;
    return;
  }
  if (command === 'serve') {
    if (input) throw new Error('serve takes no input file');
    if (values.preset) process.env.RENDER_PRESET = values.preset;
    if (values.port) process.env.PORT = values.port;
    try { await import('./server/start'); }
    catch (error: any) {
      if (error.code === 'MODULE_NOT_FOUND') throw new Error('Server dependencies were omitted. Install them with: npm install express@4 multer@2 dotenv@16');
      throw error;
    }
    return;
  }
  if (command !== 'render') throw new Error(`Unknown command: ${command}`);
  if (!input || !values.output) throw new Error('Usage: lottie-render render animation.json -o output.mp4');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const result = await renderLottie(input, {
      outputPath: values.output, fps: values.fps === undefined ? undefined : Number(values.fps),
      width: values.width === undefined ? undefined : Number(values.width),
      height: values.height === undefined ? undefined : Number(values.height),
      timeoutMs: values.timeout === undefined ? undefined : Number(values.timeout) * 1000,
      backgroundColor: values.background ?? '#ffffff', frameRateMode: values['legacy-speed'] ? 'speed' : 'resample',
      signal: controller.signal,
      onProgress: p => { if (process.stderr.isTTY) process.stderr.write(`\r${p.phase}: ${p.completedFrames}/${p.totalFrames} frames   `); },
    });
    if (process.stderr.isTTY) process.stderr.write('\n');
    if (!result.success) throw new Error(result.error);
    console.log(`Saved ${result.videoPath} (${result.metadata.duration.toFixed(2)}s, ${result.metadata.fps} fps; rendered in ${result.duration}ms)`);
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
