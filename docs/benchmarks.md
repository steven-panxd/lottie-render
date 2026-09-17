# Rendering benchmark

Measured on 2026-09-17 using the included [demo animation](../assets/demo-animation.json): two shape layers, 90 frames, 30 fps, 3 seconds. This is a small, self-contained example, not a compatibility suite or a throughput guarantee for production files.

## Results

| Output size | Render time, runs 1 / 2 / 3 | Median | MP4 size |
|---|---|---|---|
| 400 × 400 | 5.082s / 3.379s / 3.842s | 3.842s | 112.9 KiB |
| 1080 × 1080 | 4.261s / 4.407s / 3.972s | 4.261s | 342.8 KiB |

All six outputs were checked with `ffprobe`: H.264, expected dimensions, 90 decoded frames, 30 fps and 3.000 seconds. File size was the same across the three runs at each resolution.

Environment: Apple M4, 10 logical CPU cores, 24 GiB RAM; Darwin 24.6.0 arm64; Node.js 24.18.0; Playwright 1.62.0; FFmpeg 8.0.1. Renderer source: [`6d45ee6`](https://github.com/steven-panxd/lottie-render/commit/6d45ee6d04ad2b2c5b87a90ae43d606ac4ff1717). The demo and benchmark scripts were added on top of that revision; the rendering engine was unchanged.

[Raw measurements, input hash and environment](benchmark-results.json)

## Method and limits

- Three sequential runs per resolution, 400 × 400 first, without a separate warm-up. Each render launches a new Chromium; all runs share one Node process. Installed dependencies/browser binaries and OS caches can affect the results.
- Wall time is `result.duration`: reading input, browser launch, loading, frame capture, disk writes, encoding and cleanup. Dependency installation and TypeScript compilation are excluded.
- Settings: source frame rate, white background, JPEG capture quality 80; the renderer uses H.264, CRF 21 and the medium encoding preset.
- Raw results include **Node-process RSS sampled every 50 ms**. This excludes Chromium and FFmpeg, can miss short peaks and is **not total render memory**. Do not use it to size a container; measure the full workload in your deployment.
- This sample has no text, embedded images or external assets. Complex compositions and longer animations need their own measurements. These numbers do not establish compatibility or performance relative to another renderer.

## Reproduce

Install Node.js 20+ and FFmpeg with `ffprobe`, then run from the repository:

```bash
npm ci
npm run benchmark
```

On Linux, install Playwright system dependencies if necessary with `npx playwright install --with-deps chromium`.

Outputs are written to `videos/benchmark/`: six MP4s and `results.json`. Re-running overwrites those generated files; the committed report is not changed automatically. The script exits with an error if rendering fails or the probed video metadata does not match the requested output.

To inspect an output manually:

```bash
ffprobe -v error -select_streams v:0 -count_frames \
  -show_entries stream=codec_name,width,height,r_frame_rate,nb_read_frames,duration \
  -of json videos/benchmark/demo-1080-1.mp4
```

[Back to README](../README.md)
