/**
 * 逐帧截图渲染引擎
 * 使用 Playwright 逐帧截图，然后用 FFmpeg 合成视频
 * 这是最精确和可控的方案
 */

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { RenderOptions, RenderResult, LottieJSON, LottieMetadata } from '../types';

const execAsync = promisify(exec);

/**
 * 逐帧渲染 Lottie 动画为视频
 */
export async function renderLottieToVideoFrameByFrame(
  jsonPath: string,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const startTime = Date.now();
  let browser: Browser | null = null;
  let framesDir: string | null = null;

  // 性能计时器
  const timings = {
    browserLaunch: 0,
    pageLoad: 0,
    frameCaptureTotal: 0,
    diskWrite: 0,
    ffmpeg: 0,
    cleanup: 0
  };

  try {
    // 1. 读取 Lottie JSON
    console.log(`Reading Lottie JSON from: ${jsonPath}`);
    const jsonContent = await fs.readFile(jsonPath, 'utf-8');
    const lottieJson: LottieJSON = JSON.parse(jsonContent);

    // 2. 提取元数据
    const metadata = extractMetadata(lottieJson);
    console.log('Animation metadata:', metadata);

    // 3. 应用配置
    const config = {
      width: options.width || lottieJson.w || 1920,
      height: options.height || lottieJson.h || 1080,
      fps: options.fps || metadata.fps || 30,
      backgroundColor: options.backgroundColor || 'transparent'
    };

    console.log('Render config:', config);

    // 4. 计算需要截取的帧数
    const totalFrames = metadata.totalFrames;
    const duration = metadata.duration;
    console.log(`Total frames to capture: ${totalFrames} (${duration.toFixed(2)}s @ ${metadata.fps}fps)`);

    // 5. 创建内存缓冲区存储帧数据
    const timestamp = Date.now();
    const frameBuffers: Buffer[] = [];
    console.log(`Using in-memory frame storage (no disk I/O during capture)`);

    // 6. 启动浏览器
    console.log('\nLaunching browser...');
    const browserStartTime = Date.now();
    browser = await chromium.launch({
      headless: process.env.NODE_ENV !== 'debug',
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

    const page = await context.newPage();
    timings.browserLaunch = Date.now() - browserStartTime;

    // 7. 注入配置并加载页面
    console.log('Loading animation...');
    const pageLoadStartTime = Date.now();
    const templatePath = path.resolve(process.cwd(), 'templates/lottie-player.html');
    const templateUrl = `file://${templatePath}`;

    await page.addInitScript((data) => {
      (window as any).LOTTIE_JSON = data.json;
      (window as any).WIDTH = data.width;
      (window as any).HEIGHT = data.height;
      (window as any).BG_COLOR = data.backgroundColor;
      (window as any).AUTOPLAY = false; // 不自动播放，手动控制
    }, {
      json: lottieJson,
      width: config.width,
      height: config.height,
      backgroundColor: config.backgroundColor
    });

    await page.goto(templateUrl, { waitUntil: 'networkidle' });

    // 8. 等待动画加载完成
    await page.waitForFunction(() => {
      return (window as any).FIRST_FRAME_READY === true;
    }, { timeout: 30000 });
    timings.pageLoad = Date.now() - pageLoadStartTime;

    console.log('Animation loaded!\n');

    // 9. 逐帧截图到内存
    console.log('Starting frame-by-frame capture (in-memory)...');
    const frameCaptureStartTime = Date.now();
    const progressInterval = Math.max(1, Math.floor(totalFrames / 20)); // 每5%显示进度

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      // 跳转到指定帧
      await page.evaluate((frame) => {
        const animation = (window as any).LOTTIE_ANIMATION;
        if (animation) {
          animation.goToAndStop(frame, true); // true = isFrame
        }
      }, frameIndex);

      // 等待渲染完成（优化后的等待时间）
      // 大多数动画在 8ms 内就能渲染完成
      await page.waitForTimeout(8);

      // 截图到内存（返回 Buffer，不写磁盘）
      const screenshotBuffer = await page.screenshot({
        type: 'jpeg',
        quality: 78, // 78% 质量，质量和速度的最佳平衡点
        fullPage: false
      });

      // 存入内存数组
      frameBuffers.push(screenshotBuffer);

      // 显示进度和内存使用
      if (frameIndex % progressInterval === 0 || frameIndex === totalFrames - 1) {
        const progress = ((frameIndex + 1) / totalFrames * 100).toFixed(1);
        const memoryMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
        console.log(`  Progress: ${progress}% (${frameIndex + 1}/${totalFrames} frames) | Memory: ${memoryMB} MB`);
      }
    }
    timings.frameCaptureTotal = Date.now() - frameCaptureStartTime;

    console.log('\n✅ All frames captured in memory!');

    // 10. 关闭浏览器
    await page.close();
    await context.close();
    await browser.close();
    browser = null;

    // 11. 批量写入帧到临时目录（一次性 I/O）
    console.log('\nWriting frames to disk (batch write)...');
    const diskWriteStartTime = Date.now();
    framesDir = path.resolve(process.cwd(), `temp/frames-${timestamp}`);
    await fs.mkdir(framesDir, { recursive: true });

    // 使用 Promise.all 并行写入，加速 I/O
    const writePromises = frameBuffers.map((buffer, index) => {
      const framePath = path.join(framesDir!, `frame-${String(index).padStart(5, '0')}.jpg`);
      return fs.writeFile(framePath, buffer);
    });

    await Promise.all(writePromises);
    timings.diskWrite = Date.now() - diskWriteStartTime;
    console.log(`✅ ${frameBuffers.length} frames written to disk`);

    // 清空内存中的帧数据
    frameBuffers.length = 0;

    // 12. 使用 FFmpeg 合成视频
    console.log('\nComposing video with FFmpeg...');
    const ffmpegStartTime = Date.now();
    const outputDir = path.resolve(process.cwd(), 'videos');
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `lottie-${timestamp}.mp4`);

    await composeVideoFromFrames(framesDir, outputPath, config.fps);
    timings.ffmpeg = Date.now() - ffmpegStartTime;

    // 13. 清理临时帧
    console.log('\nCleaning up temporary frames...');
    const cleanupStartTime = Date.now();
    await cleanupFrames(framesDir);
    timings.cleanup = Date.now() - cleanupStartTime;
    framesDir = null;

    const renderDuration = Date.now() - startTime;

    // 输出详细的性能分析
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
    console.log(`📹 Video saved to: ${outputPath}`);

    return {
      success: true,
      videoPath: outputPath,
      duration: renderDuration,
      metadata
    };

  } catch (error) {
    const renderDuration = Date.now() - startTime;
    console.error('Rendering failed:', error);

    // 清理
    if (framesDir) {
      try {
        await cleanupFrames(framesDir);
      } catch (cleanupError) {
        console.error('Failed to cleanup frames:', cleanupError);
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: renderDuration
    };
  } finally {
    // 确保浏览器关闭
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * 从帧序列合成视频
 */
async function composeVideoFromFrames(
  framesDir: string,
  outputPath: string,
  fps: number
): Promise<void> {
  // FFmpeg 命令:
  // -framerate: 输入帧率
  // -i: 输入文件模式 (frame-%05d.jpg)
  // -c:v libx264: H.264 编码
  // -preset medium: 编码速度（medium 比 fast 快 20-30%，质量更好）
  // -crf 21: 高质量平衡点 (18-22 是视觉无损范围)
  // -pix_fmt yuv420p: 像素格式 (兼容性最好)
  // -movflags +faststart: 优化流式播放
  // -y: 覆盖已存在文件

  const inputPattern = path.join(framesDir, 'frame-%05d.jpg');

  const command = `ffmpeg -framerate ${fps} -i "${inputPattern}" -c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p -movflags +faststart -y "${outputPath}"`;

  console.log(`FFmpeg composing at ${fps} fps...`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024
    });

    // 显示关键信息
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

  // 验证输出文件
  try {
    await fs.access(outputPath);
  } catch {
    throw new Error('Video file was not created');
  }

  console.log('✅ Video composition completed!');
}

/**
 * 清理临时帧文件
 */
async function cleanupFrames(framesDir: string): Promise<void> {
  try {
    const files = await fs.readdir(framesDir);

    // 删除所有帧文件
    for (const file of files) {
      await fs.unlink(path.join(framesDir, file));
    }

    // 删除目录
    await fs.rmdir(framesDir);

    console.log(`Deleted ${files.length} temporary frames`);
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

/**
 * 从 Lottie JSON 中提取元数据
 */
function extractMetadata(json: LottieJSON): LottieMetadata & { totalFrames: number } {
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
