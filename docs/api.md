# Library API

```ts
function renderLottie(
  input: LottieJSON | string,
  options?: RenderOptions
): Promise<RenderResult>
```

`input` — a parsed Lottie JSON object, or a path to a Lottie JSON file on disk.

`options`:

| Option | Default | Description |
|---|---|---|
| `width` | the JSON's own width, else 1920 | Output width in px |
| `height` | the JSON's own height, else 1080 | Output height in px |
| `fps` | the JSON's own frame rate, else 30 | Output frame rate. The same number of frames is always captured from the source animation (its own `ip`/`op` range); overriding `fps` changes how fast those frames play back, and thus the output's duration, rather than resampling to a different frame count |
| `backgroundColor` | transparent | CSS background used during capture, e.g. `#ffffff`. The H.264 MP4 output is always opaque; it does not preserve alpha |
| `quality` | 80 | JPEG quality 0-100 used for intermediate frame capture |
| `outputPath` | - | Write the final MP4 here instead of returning it in memory. When set, **you own that file** — it isn't deleted. When omitted, the video is written to a temp file, read into memory, and the temp file is deleted automatically |
| `maxFrames` | 6000 | Reject animations requesting more frames than this |
| `maxDimension` | 4096 | Reject a resolved width/height larger than this, in px |
| `headless` | `true` | Set to `false` to watch the capture browser render (debugging) |

`RenderResult`:

| Field | Description |
|---|---|
| `success` | `boolean` |
| `videoBuffer` | The rendered MP4 as a `Buffer`, present when `outputPath` was **not** given |
| `videoPath` | Absolute path to the rendered MP4, present when `outputPath` was given |
| `metadata` | `{ duration, fps, width, height, name? }` describing the *actual rendered output* (reflecting any `options` overrides), not necessarily the source JSON's own values |
| `duration` | Wall-clock render time, ms |
| `error` | Failure reason, present when `success` is `false` |

## Architecture

```text
Lottie object or JSON file
  → launch Chromium and load the bundled lottie-web player
  → seek each source frame and capture a JPEG into memory
  → write captured frames to a temporary directory
  → encode an H.264 MP4 with FFmpeg
  → return videoPath or videoBuffer, then remove temporary files
```

An explicit `outputPath` is owned by the caller and is not removed. See the [renderer implementation](../src/renderer/frame-by-frame.ts) for details.

## Security note for untrusted input

Lottie JSON can reference external images and fonts. The rendering browser blocks HTTP(S) requests and allows `file://`, `data:` and `blob:` URLs. Remote assets will not load; embed assets and test the result with your actual animations. Request filtering is not a complete isolation boundary for hostile files, especially because local file URLs remain allowed.

`maxFrames` and `maxDimension` reject inputs exceeding the configured limits. They are not a timeout or a memory budget: rendering still buffers captured frames in memory.

[Back to the quick start](../README.md#quick-start)
