// Sequential, single-render measurements. Requires FFmpeg and ffprobe on PATH.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { renderLottie } = require('../dist');

async function main() {
  const root = path.join(__dirname, '..');
  const input = path.join(root, 'assets/demo-animation.json');
  const source = await fs.readFile(input);
  const animation = JSON.parse(source);
  const outputDir = path.join(root, 'videos/benchmark');
  await fs.mkdir(outputDir, { recursive: true });

  const report = {
    measuredAt: new Date().toISOString(),
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    environment: {
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0].model,
      logicalCpus: os.cpus().length,
      systemMemoryGiB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
      node: process.version,
      playwright: require('playwright/package.json').version,
      ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0],
    },
    input: {
      path: 'assets/demo-animation.json',
      sha256: createHash('sha256').update(source).digest('hex'),
      layers: animation.layers.length,
      frames: animation.op - animation.ip,
      fps: animation.fr,
    },
    method: 'Three sequential renders per size, no warm-up, fresh Chromium per render, same Node process. Render time is result.duration (includes browser startup, capture, encoding and cleanup; excludes npm build). Peak Node RSS sampled every 50ms excludes Chromium and FFmpeg and is NOT total render memory. Videos verified with ffprobe.',
    results: [],
  };

  for (const size of [400, 1080]) {
    for (let run = 1; run <= 3; run++) {
      const outputPath = path.join(outputDir, `demo-${size}-${run}.mp4`);
      let peakNodeRss = process.memoryUsage().rss;
      const sampler = setInterval(() => {
        peakNodeRss = Math.max(peakNodeRss, process.memoryUsage().rss);
      }, 50);
      let result;
      try {
        result = await renderLottie(input, {
          width: size, height: size, backgroundColor: '#ffffff', quality: 80, outputPath,
        });
      } finally {
        peakNodeRss = Math.max(peakNodeRss, process.memoryUsage().rss);
        clearInterval(sampler);
      }
      if (!result.success) throw new Error(result.error || 'Rendering failed');
      const probe = JSON.parse(execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0', '-count_frames',
        '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames,duration,codec_name,pix_fmt',
        '-of', 'json', outputPath,
      ], { encoding: 'utf8' })).streams[0];
      if (probe.width !== size || probe.height !== size || probe.codec_name !== 'h264' ||
          probe.r_frame_rate !== `${animation.fr}/1` ||
          Number(probe.nb_read_frames) !== animation.op - animation.ip ||
          Math.abs(Number(probe.duration) - (animation.op - animation.ip) / animation.fr) > 0.001) {
        throw new Error(`Unexpected video metadata: ${JSON.stringify(probe)}`);
      }
      report.results.push({
        width: size, height: size, run, renderMs: result.duration,
        peakNodeRssMiB: Number((peakNodeRss / 1024 ** 2).toFixed(1)),
        outputBytes: (await fs.stat(outputPath)).size, video: probe,
      });
    }
  }

  const reportPath = path.join(outputDir, 'results.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.table(report.results.map(({ video, ...row }) => row));
  console.log(`Full results: ${reportPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
