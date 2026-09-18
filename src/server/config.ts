export interface ServerSettings {
  demo: boolean;
  maxConcurrent: number;
  maxUploadBytes: number;
  maxFrames: number;
  maxDimension: number;
  maxDuration: number;
  timeoutMs: number;
  requestsPerMinute: number;
  port: number;
}

export function getSettings(env: NodeJS.ProcessEnv = process.env): ServerSettings {
  if (env.RENDER_PRESET && env.RENDER_PRESET !== 'demo') throw new Error('RENDER_PRESET must be demo or unset');
  const demo = env.RENDER_PRESET === 'demo';
  const number = (key: string, fallback: number) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer`);
    return value;
  };
  const port = number('PORT', 3000);
  if (port > 65535) throw new Error('PORT must be at most 65535');
  return { demo, port,
    maxConcurrent: number('MAX_CONCURRENT_RENDERS', demo ? 1 : 5),
    maxUploadBytes: number('MAX_UPLOAD_BYTES', demo ? 2 * 1024 * 1024 : 10 * 1024 * 1024),
    maxFrames: number('MAX_FRAMES', demo ? 300 : 6000),
    maxDimension: number('MAX_DIMENSION', demo ? 512 : 4096),
    maxDuration: number('MAX_DURATION_SECONDS', demo ? 10 : 200),
    timeoutMs: number('RENDER_TIMEOUT_MS', demo ? 60_000 : 120_000),
    requestsPerMinute: number('REQUESTS_PER_MINUTE', demo ? 5 : 60),
  };
}
