import { LottieJSON, LottieMetadata, RenderOptions } from '../types';

export function extractMetadata(json: LottieJSON): LottieMetadata & { totalFrames: number } {
  const fps = json.fr || 30;
  const totalFrames = Math.floor((json.op || 0) - (json.ip || 0));
  return { fps, totalFrames, duration: totalFrames / fps, width: json.w || 0, height: json.h || 0, name: json.nm };
}

function positive(name: string, value: number, integer = false): number {
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`Invalid ${name}: must be a finite positive${integer ? ' integer' : ' number'}`);
  }
  return value;
}

/** Resolve all limits before launching Chromium. Source frame indices are relative to ip in lottie-web. */
export function createRenderPlan(json: LottieJSON, options: RenderOptions = {}) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Invalid Lottie JSON: expected an object');
  positive('source fps', json.fr);
  if (!Number.isFinite(json.ip) || !Number.isFinite(json.op)) throw new Error('Invalid Lottie frame range');
  const source = extractMetadata(json);
  if (source.totalFrames <= 0) throw new Error('Animation has no frames to render');
  const maxFrames = positive('maxFrames', options.maxFrames ?? 6000, true);
  const maxDimension = positive('maxDimension', options.maxDimension ?? 4096, true);
  const fps = positive('fps', options.fps ?? source.fps);
  const width = positive('width', options.width ?? json.w ?? 1920, true);
  const height = positive('height', options.height ?? json.h ?? 1080, true);
  if (width > maxDimension || height > maxDimension) {
    throw new Error(`Requested dimensions ${width}x${height} exceed the maximum allowed dimension of ${maxDimension}px`);
  }
  if (width % 2 || height % 2) throw new Error('Invalid dimensions: H.264 MP4 requires even width and height');
  const quality = options.quality ?? 80;
  if (!Number.isInteger(quality) || quality < 0 || quality > 100) throw new Error('Invalid quality: must be an integer from 0 to 100');
  const frameRateMode = options.frameRateMode ?? 'speed';
  if (!['speed', 'resample'].includes(frameRateMode)) throw new Error('Invalid frameRateMode: use speed or resample');
  const frameCount = frameRateMode === 'resample' ? Math.max(1, Math.ceil(source.duration * fps)) : source.totalFrames;
  if (frameCount > maxFrames) throw new Error(`Animation has ${frameCount} output frames, which exceeds the maximum allowed (${maxFrames})`);
  if (options.maxDuration !== undefined && source.duration > positive('maxDuration', options.maxDuration)) {
    throw new Error(`Animation duration exceeds the maximum allowed (${options.maxDuration}s)`);
  }
  const timeoutMs = positive('timeoutMs', options.timeoutMs ?? 120_000, true);
  const encodingPreset = options.encodingPreset ?? 'medium';
  if (!['medium', 'fast', 'veryfast'].includes(encodingPreset)) throw new Error('Invalid encodingPreset');
  const crf = options.crf ?? 21;
  if (!Number.isInteger(crf) || crf < 0 || crf > 51) throw new Error('Invalid crf: must be an integer from 0 to 51');
  const threads = positive('threads', options.threads ?? 1, true);
  return { source, fps, width, height, quality, frameCount, timeoutMs, encodingPreset, crf, threads,
    backgroundColor: options.backgroundColor ?? 'transparent',
    sourceFrame: (index: number) => frameRateMode === 'resample' ? Math.min(index * source.fps / fps, source.totalFrames - 0.000001) : index,
  };
}
