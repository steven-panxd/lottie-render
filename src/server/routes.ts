import { randomUUID } from 'crypto';
import { Request, Response, Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { renderLottie } from '../renderer/frame-by-frame';
import { RenderOptions } from '../types';
import { apiKeyAuth, upload } from './app';

const router = Router();

// Concurrency control
let activeRenders = 0;
function getMaxConcurrentRenders(): number {
  return process.env.MAX_CONCURRENT_RENDERS
    ? parseInt(process.env.MAX_CONCURRENT_RENDERS)
    : 5;
}

function getMaxDimension(): number {
  return process.env.MAX_DIMENSION ? parseInt(process.env.MAX_DIMENSION) : 4096;
}

function getMaxFrames(): number | undefined {
  return process.env.MAX_FRAMES ? parseInt(process.env.MAX_FRAMES) : undefined;
}

/**
 * POST /api/render
 * Submit a Lottie render job.
 *
 * Requires a multipart/form-data upload with the Lottie JSON file plus
 * optional render parameters. Responds with the rendered MP4 as the
 * response body; render metadata is returned in response headers.
 */
router.post(
  '/render',
  apiKeyAuth,
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error:
            'No file uploaded. Please upload a Lottie JSON file with key "file"',
        });
      }

      const maxConcurrentRenders = getMaxConcurrentRenders();
      if (activeRenders >= maxConcurrentRenders) {
        return res.status(503).json({
          success: false,
          error: `Server is busy. Maximum ${maxConcurrentRenders} concurrent renders allowed. Please retry later.`,
          activeRenders,
          maxConcurrent: maxConcurrentRenders,
        });
      }

      // Parse the Lottie JSON
      let lottieJson;
      try {
        lottieJson = JSON.parse(req.file.buffer.toString('utf-8'));
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: 'Invalid JSON file',
        });
      }

      const maxDimension = getMaxDimension();

      // Parse render options (from form fields)
      const options: RenderOptions = {
        width: req.body.width ? parseInt(req.body.width) : undefined,
        height: req.body.height ? parseInt(req.body.height) : undefined,
        fps: req.body.fps ? parseInt(req.body.fps) : undefined,
        backgroundColor: req.body.backgroundColor || undefined,
        quality: req.body.quality ? parseInt(req.body.quality) : undefined,
        maxFrames: getMaxFrames(),
        maxDimension,
      };

      for (const [key, value] of [
        ['width', options.width],
        ['height', options.height],
      ] as const) {
        if (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > maxDimension)) {
          return res.status(400).json({
            success: false,
            error: `Invalid ${key}: must be a positive number no greater than ${maxDimension}`,
          });
        }
      }

      const taskId = randomUUID();
      console.log(`📥 Received render task: ${taskId}`);

      activeRenders++;
      console.log(`🔢 Active renders: ${activeRenders}/${maxConcurrentRenders}`);

      // Tracks whether the sendFile callback will decrement the counter
      let decrementInCallback = false;

      try {
        console.log(`🎬 Starting render for task: ${taskId}`);
        const startTime = Date.now();

        const outputPath = path.join(process.cwd(), 'videos', `lottie-${taskId}.mp4`);
        const result = await renderLottie(lottieJson, { ...options, outputPath });

        const renderTime = Date.now() - startTime;

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

        // Render metadata is returned via response headers since the body
        // is the video file itself.
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

        decrementInCallback = true;

        res.sendFile(videoPath, async (err) => {
          activeRenders--;
          console.log(`🔢 Active renders: ${activeRenders}/${maxConcurrentRenders}`);

          if (err) {
            console.error(`❌ Error sending video file for task ${taskId}:`, err);
            if (!res.headersSent) {
              res.status(500).json({
                success: false,
                error: 'Failed to send video file',
              });
            }
          } else {
            console.log(`📤 Video file sent successfully for task ${taskId}`);
          }

          // Always delete the temporary video file, success or failure
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
      } finally {
        // If the callback above didn't run, decrement here
        if (!decrementInCallback) {
          activeRenders--;
          console.log(`🔢 Active renders: ${activeRenders}/${maxConcurrentRenders}`);
        }
      }
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
