import { randomUUID } from 'crypto';
import { Request, Response, Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { renderLottieToVideoFrameByFrame } from '../renderer/frame-by-frame';
import { RenderOptions } from '../types';
import { apiKeyAuth, upload } from './app';

const router = Router();

/**
 * POST /api/render
 * 提交 Lottie 渲染任务
 *
 * 需要上传 JSON 文件，可选的渲染参数
 */
router.post(
  '/render',
  apiKeyAuth,
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      // 检查文件是否上传
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error:
            'No file uploaded. Please upload a Lottie JSON file with key "file"',
        });
      }

      // 解析 Lottie JSON
      let lottieJson;
      try {
        lottieJson = JSON.parse(req.file.buffer.toString('utf-8'));
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: 'Invalid JSON file',
        });
      }

      // 解析渲染参数（从 form fields 或 query params）
      const options: RenderOptions = {
        width: req.body.width ? parseInt(req.body.width) : undefined,
        height: req.body.height ? parseInt(req.body.height) : undefined,
        fps: req.body.fps ? parseInt(req.body.fps) : undefined,
        backgroundColor: req.body.backgroundColor || undefined,
        quality: req.body.quality ? parseInt(req.body.quality) : undefined,
      };

      // 生成任务 ID
      const taskId = randomUUID();
      console.log(`📥 Received render task: ${taskId}`);

      // 保存临时 JSON 文件
      const tempJsonPath = path.join(process.cwd(), 'temp', `${taskId}.json`);
      await fs.mkdir(path.join(process.cwd(), 'temp'), { recursive: true });
      await fs.writeFile(tempJsonPath, JSON.stringify(lottieJson));

      // 执行渲染（同步方式，Phase 3 将改为异步队列）
      console.log(`🎬 Starting render for task: ${taskId}`);
      const startTime = Date.now();

      const result = await renderLottieToVideoFrameByFrame(
        tempJsonPath,
        options
      );

      const renderTime = Date.now() - startTime;

      // 清理临时 JSON 文件
      await fs.unlink(tempJsonPath).catch(() => {});

      if (!result.success) {
        console.error(`❌ Render failed for task ${taskId}:`, result.error);
        return res.status(500).json({
          success: false,
          taskId,
          error: result.error,
        });
      }

      console.log(`✅ Render completed for task ${taskId} in ${renderTime}ms`);

      const videoPath = result.videoPath!;

      // 设置响应头 - 将元数据放在 header 中
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="lottie-${taskId}.mp4"`
      );
      res.setHeader('X-Task-ID', taskId);
      res.setHeader('X-Render-Duration', renderTime.toString());
      res.setHeader(
        'X-Video-Duration',
        result.metadata?.duration.toString() || '0'
      );
      res.setHeader('X-Video-FPS', result.metadata?.fps.toString() || '0');
      res.setHeader('X-Video-Width', result.metadata?.width.toString() || '0');
      res.setHeader(
        'X-Video-Height',
        result.metadata?.height.toString() || '0'
      );

      // 发送视频文件
      res.sendFile(videoPath, async (err) => {
        if (err) {
          console.error(`❌ Error sending video file for task ${taskId}:`, err);
          // 如果还没发送响应头，发送错误
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: 'Failed to send video file',
            });
          }
        } else {
          console.log(`📤 Video file sent successfully for task ${taskId}`);
        }

        // 无论成功还是失败，都删除临时视频文件
        try {
          await fs.unlink(videoPath);
          console.log(`🗑️  Deleted temporary video: ${videoPath}`);
        } catch (cleanupError) {
          console.error(
            `⚠️  Failed to delete temporary video: ${videoPath}`,
            cleanupError
          );
        }
      });
    } catch (error: any) {
      console.error('Render error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error',
      });
    }
  }
);

/**
 * GET /api/health
 * 健康检查端点
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  });
});

export default router;
