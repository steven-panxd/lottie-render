import { chromium, Browser } from 'playwright';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { spawn } from 'child_process';
import { RenderOptions, RenderResult, LottieJSON, RenderProgress } from '../types';
import { createRenderPlan } from './plan';
export { extractMetadata } from './plan';

/** Capture one JPEG at a time; close Chromium before starting the encoder. */
export async function renderLottie(input: LottieJSON | string, options: RenderOptions = {}): Promise<RenderResult> {
  const start = Date.now();
  let browser: Browser | undefined;
  let scratch: string | undefined;
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  let validated = false;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const closeOnAbort = () => { void browser?.close().catch(() => {}); };
  const checkAbort = () => { if (controller.signal.aborted) throw new Error(timedOut ? 'Render timed out' : 'Render cancelled'); };
  options.signal?.addEventListener('abort', abort, { once: true });
  controller.signal.addEventListener('abort', closeOnAbort);
  if (options.signal?.aborted) abort();

  try {
    checkAbort();
    const json: LottieJSON = typeof input === 'string' ? JSON.parse(await fs.readFile(input, 'utf8')) : input;
    const plan = createRenderPlan(json, options);
    validated = true;
    // Account for input loading time as part of the deadline.
    timer = setTimeout(() => { timedOut = true; abort(); }, Math.max(1, plan.timeoutMs - (Date.now() - start)));
    const progress = (phase: RenderProgress['phase'], completedFrames = 0) => {
      checkAbort();
      options.onProgress?.({ phase, completedFrames, totalFrames: plan.frameCount });
      checkAbort();
    };
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'lottie-render-'));
    const framesDir = path.join(scratch, 'frames');
    await fs.mkdir(framesDir);
    progress('loading');
    browser = await chromium.launch({ headless: options.headless ?? true,
      timeout: Math.max(1, plan.timeoutMs - (Date.now() - start)),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    checkAbort();
    const context = await browser.newContext({ viewport: { width: plan.width, height: plan.height }, serviceWorkers: 'block' });
    const templatePath = path.resolve(__dirname, '../../templates/lottie-player.html');
    const allowedFiles = new Set([pathToFileURL(templatePath).href,
      pathToFileURL(path.join(path.dirname(templatePath), 'vendor/lottie.min.js')).href]);
    // Only the bundled player may load local files; user assets must be embedded.
    await context.route('**/*', route => {
      const url = route.request().url();
      return allowedFiles.has(url) || url.startsWith('data:') || url.startsWith('blob:')
        ? route.continue() : route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    await page.addInitScript(data => {
      Object.assign(window, { LOTTIE_JSON: data.json, WIDTH: data.width, HEIGHT: data.height,
        BG_COLOR: data.backgroundColor, AUTOPLAY: false });
    }, { json, width: plan.width, height: plan.height, backgroundColor: plan.backgroundColor });
    await page.goto(pathToFileURL(templatePath).href, { waitUntil: 'load' });
    await page.waitForFunction(() => (window as any).FIRST_FRAME_READY || (window as any).ANIMATION_ERROR);
    const animationError = await page.evaluate(() => (window as any).ANIMATION_ERROR);
    if (animationError) throw new Error(String(animationError));
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    for (let index = 0; index < plan.frameCount; index++) {
      checkAbort();
      await page.evaluate(frame => (window as any).LOTTIE_ANIMATION.goToAndStop(frame, true), plan.sourceFrame(index));
      const buffer = await page.screenshot({ type: 'jpeg', quality: plan.quality });
      // Await each write: no frame array and no unbounded Promise.all.
      await fs.writeFile(path.join(framesDir, `frame-${String(index).padStart(6, '0')}.jpg`), buffer);
      progress('capture', index + 1);
    }
    await browser.close();
    browser = undefined;
    progress('encoding', plan.frameCount);
    const temporaryVideo = path.join(scratch, 'output.mp4');
    await encode(framesDir, temporaryVideo, plan, controller.signal);
    checkAbort();
    const metadata = { duration: plan.frameCount / plan.fps, fps: plan.fps, width: plan.width, height: plan.height, name: plan.source.name };
    if (options.outputPath) {
      const videoPath = path.resolve(options.outputPath);
      await fs.mkdir(path.dirname(videoPath), { recursive: true });
      // Encode in scratch first so failed jobs never leave a partial destination MP4.
      await fs.copyFile(temporaryVideo, videoPath);
      progress('complete', plan.frameCount);
      options.logger?.(`Rendered ${plan.frameCount} frames in ${Date.now() - start}ms`);
      return { success: true, videoPath, metadata, duration: Date.now() - start };
    }
    const videoBuffer = await fs.readFile(temporaryVideo);
    progress('complete', plan.frameCount);
    return { success: true, videoBuffer, metadata, duration: Date.now() - start };
  } catch (error) {
    return { success: false,
      error: timedOut ? 'Render timed out' : controller.signal.aborted ? 'Render cancelled' : error instanceof Error ? error.message : String(error),
      errorCode: timedOut ? 'TIMEOUT' : controller.signal.aborted ? 'ABORTED' : validated ? 'RENDER_FAILED' : 'INVALID_INPUT',
      duration: Date.now() - start };
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', closeOnAbort);
    await browser?.close().catch(() => {});
    if (scratch) await fs.rm(scratch, { recursive: true, force: true });
  }
}

function encode(framesDir: string, output: string, plan: ReturnType<typeof createRenderPlan>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Render cancelled'));
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-framerate', String(plan.fps),
      '-i', path.join(framesDir, 'frame-%06d.jpg'), '-c:v', 'libx264', '-preset', plan.encodingPreset,
      '-crf', String(plan.crf), '-threads', String(plan.threads), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', output],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const stop = () => { child.kill('SIGKILL'); };
    signal.addEventListener('abort', stop, { once: true });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
    child.once('error', error => { signal.removeEventListener('abort', stop); reject(new Error(`Cannot start FFmpeg: ${error.message}. Run lottie-render doctor.`)); });
    child.once('close', code => {
      signal.removeEventListener('abort', stop);
      if (signal.aborted) reject(new Error('Render cancelled'));
      else if (code === 0) resolve();
      else reject(new Error(`FFmpeg failed (${code}): ${stderr.trim()}`));
    });
  });
}
