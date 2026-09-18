# Rendering benchmark

## Low-memory implementation (2026-09-17)

Docker Desktop Linux arm64, one CPU, swap disabled. Peak is cgroup v2 `memory.peak`, including Node, Chromium, FFmpeg and charged filesystem cache. One run per case; timing is not a statistical throughput guarantee. These runs compare main commit `75ddefe` with the implementation in this change. Raw reports include immutable local image IDs.

| 512 MiB container, constructed 10s animation | Output frames | Render time | Peak memory |
|---|---:|---:|---:|
| Previous implementation, 60 fps | 600 | 22.413s | 201.6 MiB |
| Sequential disk capture, 60 fps | 600 | 21.014s | 172.4 MiB |
| Sequential disk capture + resample to 30 fps | 300 | 10.702s | 162.3 MiB |

All cases also passed at 1 GiB without OOM events. The included 3-second animation passed both memory limits. The longer fixture extends the bundled two-shape animation to 600 source frames; it is not a complex production animation. A full HTTP demo render of that fixture also passed at 512 MiB (peak 156.1 MiB, 300 frames, 10 seconds), using the demo's veryfast/CRF 25 encoder settings.

Local arm64 image size: 662.9 MB before, 434.9 MB after (uncompressed Docker image size, about 34% smaller; registry transfer sizes differ). A decoded-frame comparison on the 3-second fixture gave SSIM 0.996182; output is not bit-identical because encoder threading changed.

[Raw container measurements](container-benchmark-results.json)

Reproduce after building local baseline and updated images:

```bash
node scripts/benchmark-container.cjs lottie-render:baseline videos/container-benchmark
node scripts/benchmark-container.cjs lottie-render:lean videos/container-benchmark
```

The script limits CPU/memory, disables swap/networking, verifies outputs with ffprobe, captures memory events and removes each test container. It requires Docker and available image tags. CPU contention from other host workloads can affect timings. Measure your own representative files before deploying; 512 MiB is demonstrated for these fixtures, not guaranteed for every accepted JSON.

## Historical benchmark (before this change)


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
