/** Render options. Existing fps overrides retain their speed-changing behavior. */
export interface RenderOptions {
  width?: number;
  height?: number;
  fps?: number;
  /** resample preserves source duration (rounded up to an output frame); speed is the legacy default. */
  frameRateMode?: 'speed' | 'resample';
  backgroundColor?: string;
  quality?: number;
  outputPath?: string;
  maxFrames?: number;
  maxDimension?: number;
  maxDuration?: number;
  /** Deadline for the entire job, including encoding. Default: 120 seconds. */
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
  /** The library is quiet by default. */
  logger?: (message: string) => void;
  encodingPreset?: 'medium' | 'fast' | 'veryfast';
  crf?: number;
  /** FFmpeg encoder threads. Default: 1 for predictable resource use. */
  threads?: number;
  headless?: boolean;
}

export interface RenderProgress {
  phase: 'loading' | 'capture' | 'encoding' | 'complete';
  completedFrames: number;
  totalFrames: number;
}

export interface LottieMetadata {
  duration: number;
  fps: number;
  width: number;
  height: number;
  name?: string;
}

type ResultBase = { duration: number };
type SuccessBase = ResultBase & { success: true; metadata: LottieMetadata; error?: never; errorCode?: never };
export type RenderResult =
  | (SuccessBase & { videoPath: string; videoBuffer?: never })
  | (SuccessBase & { videoBuffer: Buffer; videoPath?: never })
  | (ResultBase & { success: false; error: string; errorCode: 'INVALID_INPUT' | 'ABORTED' | 'TIMEOUT' | 'RENDER_FAILED'; metadata?: never; videoPath?: never; videoBuffer?: never });

export interface LottieJSON {
  v: string;
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  nm?: string;
  assets?: any[];
  layers?: any[];
  [key: string]: any;
}
