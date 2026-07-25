/**
 * Frame-by-frame rendering engine.
 * Uses Playwright to screenshot each frame of a Lottie animation, then
 * composes the frame sequence into an MP4 with FFmpeg. This is the most
 * precise and controllable approach: every frame is captured deterministically
 * rather than relying on a real-time screen recording.
 */

import { chromium, Browser } from 'playwright';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { RenderOptions, RenderResult, LottieJSON, LottieMetadata } from '../types';

const execAsync = promisify(exec);

const DEFAULT_MAX_FRAMES = 6000;
const DEFAULT_MAX_DIMENSION = 4096;

/**
 * Render a Lottie animation to video, frame by frame.
 *
 * @param input Either a parsed Lottie JSON object, or a path to a Lottie
 *   JSON file on disk.
 * @param options Render options. If `options.outputPath` is given, the
 *   final MP4 is written there and `result.videoPath` points to it — the
 *   caller owns that file. Otherwise the video is written to a temp file,
 *   read into memory, and the temp file is deleted; `result.videoBuffer`
 *   holds the video bytes and no file is left behind.
 */
export async function renderLottie(
  input: LottieJSON | string,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const startTime = Date.now();
  let browser: Browser | null = null;
  let renderTempDir: string | null = null;

  const timings = {
    browserLaunch: 0,
    pageLoad: 0,
    frameCaptureTotal: 0,
    diskWrite: 0,
    ffmpeg: 0,
    cleanup: 0
  };

  try {
    // 1. Resolve the Lottie JSON, either from a file path or an object passed directly
    let lottieJson: LottieJSON;
    if (typeof input === 'string') {
      console.log(`Reading Lottie JSON from: ${input}`);
      const jsonContent = await fs.readFile(input, 'utf-8');
      lottieJson = JSON.parse(jsonContent);
    } else {
      lottieJson = input;
    }

    const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
    const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;

    // 2. Extract metadata
    const metadata = extractMetadata(lottieJson);
    console.log('Animation metadata:', metadata);

    // 3. Resolve render config
    const config = {
      width: options.width || lottieJson.w || 1920,
      height: options.height || lottieJson.h || 1080,
      fps: options.fps || metadata.fps || 30,
      backgroundColor: options.backgroundColor || 'transparent',
      quality: options.quality || 80  // JPEG quality, default 80
    };

    if (config.width <= 0 || config.width > maxDimension || config.height <= 0 || config.height > maxDimension) {
      return {
        success: false,
        error: `Requested dimensions ${config.width}x${config.height} exceed the maximum allowed dimension of ${maxDimension}px`,
        duration: Date.now() - startTime
      };
    }

    console.log('Render config:', config);

    // 4. Compute how many frames need to be captured
    const totalFrames = metadata.totalFrames;
    const duration = metadata.duration;
    console.log(`Total frames to capture: ${totalFrames} (${duration.toFixed(2)}s @ ${metadata.fps}fps)`);

    if (totalFrames > maxFrames) {
      return {
        success: false,
        error: `Animation has ${totalFrames} frames, which exceeds the maximum allowed (${maxFrames}). Raise options.maxFrames to allow this.`,
        duration: Date.now() - startTime
      };
    }

    if (totalFrames <= 0) {
      return {
        success: false,
        error: `Animation has no frames to render (ip=${lottieJson.ip}, op=${lottieJson.op})`,
        duration: Date.now() - startTime
      };
    }

    // 5. Buffer frames in memory rather than writing to disk during capture
    const frameBuffers: Buffer[] = [];
    console.log(`Using in-memory frame storage (no disk I/O during capture)`);

    // 6. Launch the browser
    console.log('\nLaunching browser...');
    const browserStartTime = Date.now();
    browser = await chromium.launch({
      headless: options.headless ?? true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const context = await browser.newContext({
      viewport: {
        width: config.width,
        height: config.height
      }
    });

    // Lottie JSON is untrusted input and may reference arbitrary asset URLs
    // (images/fonts). Block every request that isn't loading the local
    // player template or an inline data/blob URI, so a crafted animation
    // can't be used to make the process issue outbound requests (SSRF).
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')) {
        return route.continue();
      }
      console.warn(`Blocked outbound request from rendered page: ${url}`);
      return route.abort('blockedbyclient');
    });

    const page = await context.newPage();
    timings.browserLaunch = Date.now() - browserStartTime;

    // 7. Inject config and load the player page. The template is resolved
    // relative to this module's own location (not process.cwd()) so this
    // works whether running from source, compiled to dist/, or installed
    // as a dependency inside another project.
    console.log('Loading animation...');
    const pageLoadStartTime = Date.now();
    const templatePath = path.resolve(__dirname, '../../templates/lottie-player.html');
    const templateUrl = `file://${templatePath}`;

    await page.addInitScript((data) => {
      (window as any).LOTTIE_JSON = data.json;
      (window as any).WIDTH = data.width;
      (window as any).HEIGHT = data.height;
      (window as any).BG_COLOR = data.backgroundColor;
      (window as any).AUTOPLAY = false; // playback is driven manually, frame by frame
    }, {
      json: lottieJson,
      width: config.width,
      height: config.height,
      backgroundColor: config.backgroundColor
    });

    await page.goto(templateUrl, { waitUntil: 'networkidle' });

    // 8. Wait until the first frame has rendered
    await page.waitForFunction(() => {
      return (window as any).FIRST_FRAME_READY === true;
    }, { timeout: 30000 });
    timings.pageLoad = Date.now() - pageLoadStartTime;

    console.log('Animation loaded!\n');

    // 9. Capture each frame into memory
    console.log('Starting frame-by-frame capture (in-memory)...');
    const frameCaptureStartTime = Date.now();
    const progressInterval = Math.max(1, Math.floor(totalFrames / 20)); // log roughly every 5%

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      // Seek to the target frame
      await page.evaluate((frame) => {
        const animation = (window as any).LOTTIE_ANIMATION;
        if (animation) {
          animation.goToAndStop(frame, true); // true = isFrame
        }
      }, frameIndex);

      // Give the frame a moment to paint. Most frames render well within 8ms.
      await page.waitForTimeout(8);

      // Screenshot straight to a Buffer, no disk I/O
      const screenshotBuffer = await page.screenshot({
        type: 'jpeg',
        quality: config.quality,
        fullPage: false
      });

      frameBuffers.push(screenshotBuffer);

      if (frameIndex % progressInterval === 0 || frameIndex === totalFrames - 1) {
        const progress = ((frameIndex + 1) / totalFrames * 100).toFixed(1);
        const memoryMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
        console.log(`  Progress: ${progress}% (${frameIndex + 1}/${totalFrames} frames) | Memory: ${memoryMB} MB`);
      }
    }
    timings.frameCaptureTotal = Date.now() - frameCaptureStartTime;

    console.log('\n✅ All frames captured in memory!');

    // 10. Close the browser
    await page.close();
    await context.close();
    await browser.close();
    browser = null;

    // 11. Batch-write frames to a scratch temp directory (one burst of I/O)
    console.log('\nWriting frames to disk (batch write)...');
    const diskWriteStartTime = Date.now();
    renderTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lottie-render-'));
    const framesDir = path.join(renderTempDir, 'frames');
    await fs.mkdir(framesDir);

    // Write frames in parallel to speed up I/O
    const writePromises = frameBuffers.map((buffer, index) => {
      const framePath = path.join(framesDir, `frame-${String(index).padStart(5, '0')}.jpg`);
      return fs.writeFile(framePath, buffer);
    });

    await Promise.all(writePromises);
    timings.diskWrite = Date.now() - diskWriteStartTime;
    console.log(`✅ ${frameBuffers.length} frames written to disk`);

    // Free the in-memory frame buffers
    frameBuffers.length = 0;

    // 12. Compose the video with FFmpeg. If the caller gave an explicit
    // outputPath, write there directly (they own the file); otherwise
    // write into the scratch temp dir and read it back into memory below.
    console.log('\nComposing video with FFmpeg...');
    const ffmpegStartTime = Date.now();
    const finalOutputPath = options.outputPath
      ? path.resolve(options.outputPath)
      : path.join(renderTempDir, 'output.mp4');

    if (options.outputPath) {
      await fs.mkdir(path.dirname(finalOutputPath), { recursive: true });
    }

    await composeVideoFromFrames(framesDir, finalOutputPath, config.fps);
    timings.ffmpeg = Date.now() - ffmpegStartTime;

    // 13. Read the video into memory when no explicit output destination was
    // requested, then clean up the scratch temp directory either way.
    console.log('\nCleaning up temporary files...');
    const cleanupStartTime = Date.now();
    const videoBuffer = options.outputPath ? undefined : await fs.readFile(finalOutputPath);
    await fs.rm(renderTempDir, { recursive: true, force: true });
    renderTempDir = null;
    timings.cleanup = Date.now() - cleanupStartTime;

    const renderDuration = Date.now() - startTime;

    console.log('\n' + '='.repeat(60));
    console.log('📊 Performance Breakdown:');
    console.log('='.repeat(60));
    console.log(`  Browser Launch:    ${timings.browserLaunch}ms (${(timings.browserLaunch/renderDuration*100).toFixed(1)}%)`);
    console.log(`  Page Load:         ${timings.pageLoad}ms (${(timings.pageLoad/renderDuration*100).toFixed(1)}%)`);
    console.log(`  Frame Capture:     ${timings.frameCaptureTotal}ms (${(timings.frameCaptureTotal/renderDuration*100).toFixed(1)}%) - ${(timings.frameCaptureTotal/totalFrames).toFixed(1)}ms/frame`);
    console.log(`  Disk Write:        ${timings.diskWrite}ms (${(timings.diskWrite/renderDuration*100).toFixed(1)}%)`);
    console.log(`  FFmpeg Encoding:   ${timings.ffmpeg}ms (${(timings.ffmpeg/renderDuration*100).toFixed(1)}%)`);
    console.log(`  Cleanup:           ${timings.cleanup}ms (${(timings.cleanup/renderDuration*100).toFixed(1)}%)`);
    console.log('='.repeat(60));
    console.log(`  TOTAL:             ${renderDuration}ms`);
    console.log('='.repeat(60));
    console.log(`\n✅ Rendering completed!`);
    console.log(`📹 Video ${options.outputPath ? `saved to: ${finalOutputPath}` : 'ready in memory'}`);

    return {
      success: true,
      videoPath: options.outputPath ? finalOutputPath : undefined,
      videoBuffer,
      duration: renderDuration,
      // Report what was actually produced, not the source JSON's own
      // metadata — otherwise overriding width/height/fps via options would
      // make the returned metadata (and the server's X-Video-* headers)
      // silently wrong.
      metadata: {
        duration: totalFrames / config.fps,
        fps: config.fps,
        width: config.width,
        height: config.height,
        name: metadata.name
      }
    };

  } catch (error) {
    const renderDuration = Date.now() - startTime;
    console.error('Rendering failed:', error);

    if (renderTempDir) {
      try {
        await fs.rm(renderTempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error('Failed to clean up temp directory:', cleanupError);
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: renderDuration
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Compose a video from a directory of numbered JPEG frames.
 */
async function composeVideoFromFrames(
  framesDir: string,
  outputPath: string,
  fps: number
): Promise<void> {
  // -framerate: input frame rate
  // -i: input file pattern (frame-%05d.jpg)
  // -c:v libx264: H.264 encoding
  // -preset medium: better quality than "fast" at a reasonable speed cost
  // -crf 21: high-quality/visually-lossless range is roughly 18-22
  // -pix_fmt yuv420p: most broadly compatible pixel format
  // -movflags +faststart: optimizes for streaming playback
  // -y: overwrite existing output

  const inputPattern = path.join(framesDir, 'frame-%05d.jpg');

  const command = `ffmpeg -framerate ${fps} -i "${inputPattern}" -c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p -movflags +faststart -y "${outputPath}"`;

  console.log(`FFmpeg composing at ${fps} fps...`);

  try {
    const { stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024
    });

    if (stderr) {
      const lines = stderr.split('\n');
      const progressLine = lines.filter(line => line.includes('frame=')).pop();
      if (progressLine) {
        console.log('FFmpeg:', progressLine.trim());
      }
    }
  } catch (error: any) {
    throw new Error(`FFmpeg composition failed: ${error.message}`);
  }

  try {
    await fs.access(outputPath);
  } catch {
    throw new Error('Video file was not created');
  }

  console.log('✅ Video composition completed!');
}

/**
 * Extract render metadata (duration, fps, dimensions, frame count) from a
 * Lottie JSON document.
 */
export function extractMetadata(json: LottieJSON): LottieMetadata & { totalFrames: number } {
  const fps = json.fr || 30;
  const startFrame = json.ip || 0;
  const endFrame = json.op || 0;
  const totalFrames = Math.floor(endFrame - startFrame);
  const duration = totalFrames / fps;

  return {
    duration,
    fps,
    width: json.w || 0,
    height: json.h || 0,
    name: json.nm,
    totalFrames
  };
}
