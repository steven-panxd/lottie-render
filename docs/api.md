# Library API

```ts
const result = await renderLottie('animation.json', {
  outputPath: 'output.mp4',
  fps: 30,
  frameRateMode: 'resample',
  timeoutMs: 60000,
  signal: abortController.signal,
  onProgress: ({ phase, completedFrames, totalFrames }) => {
    console.log(phase, completedFrames, totalFrames);
  },
});
if (!result.success) throw new Error(result.error);
console.log(result.videoPath);
```

`renderLottie(input, options)` accepts a parsed Lottie object or local JSON path. It returns a discriminated `RenderResult`: successful results contain metadata and either a videoPath or videoBuffer; failures contain error and errorCode. The library is quiet by default.

| Option | Default | Description |
|---|---|---|
| width / height | source dimensions | Positive even output dimensions, required by H.264 yuv420p |
| fps | source frame rate | Output fps; see frameRateMode |
| frameRateMode | speed | `speed`: original behavior, one capture per source frame, changes playback duration. `resample`: captures `ceil(sourceDuration * fps)` frames, preserving duration within one output frame |
| backgroundColor | transparent | CSS background. MP4 is opaque; specify a color for predictable output |
| quality | 80 | JPEG capture quality, integer 0-100; zero is valid |
| outputPath | unset | Write final MP4 to this path, otherwise return videoBuffer |
| maxFrames | 6000 | Maximum OUTPUT frame count, after resampling |
| maxDimension | 4096 | Maximum width or height |
| maxDuration | unset | Maximum SOURCE duration in seconds |
| timeoutMs | 120000 | Whole-job deadline, including encoding |
| signal | unset | AbortSignal for cancellation |
| onProgress | unset | Callback with phase, completedFrames and totalFrames; phases: loading, capture, encoding, complete |
| logger | unset | Optional completion logger |
| encodingPreset | medium | medium, fast or veryfast |
| crf | 21 | H.264 quality, integer 0-51 |
| threads | 1 | FFmpeg encoder thread count |
| headless | true | Use false for browser debugging; requires a full Chromium installation |

The legacy library `fps` behavior is retained. The CLI defaults to resampling (`--legacy-speed` opts out); the public demo always resamples. Invalid inputs and numeric options are rejected before browser launch. The whole-job timeout is new; raise it explicitly for trusted long jobs.

| Result field | Description |
|---|---|
| success | true or false; narrows the TypeScript union |
| videoPath | Absolute path on success when outputPath was supplied; no videoBuffer |
| videoBuffer | MP4 Buffer on success when outputPath was omitted; no videoPath |
| metadata | Actual output duration, fps, width, height and optional name |
| duration | Job elapsed time in milliseconds, excluding final scratch cleanup |
| error | Failure message |
| errorCode | INVALID_INPUT, ABORTED, TIMEOUT or RENDER_FAILED |

## Architecture

```text
Lottie JSON -> validate and select frames -> launch Chromium
  -> capture and write ONE JPEG at a time to scratch disk
  -> close Chromium -> encode MP4 with FFmpeg
  -> copy to outputPath or read videoBuffer -> clean scratch files
```

An explicit outputPath belongs to the caller. Encoding occurs in scratch first, so encoding failure or cancellation before publication leaves an existing destination unchanged. Successful publication replaces it. Temporary frames are removed on success, failure and cancellation. Both screenshot storage and encoder threads are bounded; browser complexity and charged filesystem cache still consume memory.

## Security note for untrusted input

The browser permits only the bundled template, bundled lottie-web script, and embedded data/blob URLs. Arbitrary local files and HTTP(S) assets are blocked. This is not a complete isolation boundary for hostile animation data: use container CPU/memory limits and keep credentials out of the worker. Chromium runs with its sandbox disabled.

[Back to README](../README.md)
