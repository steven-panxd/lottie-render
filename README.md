# lottie-render

[![CI](https://github.com/steven-panxd/lottie-render/actions/workflows/ci.yml/badge.svg)](https://github.com/steven-panxd/lottie-render/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/lottie-render.svg)](https://www.npmjs.com/package/lottie-render)
[![license](https://img.shields.io/npm/l/lottie-render.svg)](LICENSE)

Render [Lottie](https://lottiefiles.com/) animations (After Effects / bodymovin JSON) to MP4 video, frame by frame, using headless Chromium (via [Playwright](https://playwright.dev/)) and FFmpeg — as a library you `import`, or as a self-hosted HTTP service.

![lottie-render turning a Lottie animation into an MP4, frame by frame](assets/demo.gif)

Rather than capturing a real-time screen recording of the animation playing, this renderer pauses playback and screenshots one exact frame at a time, then composes the frame sequence into a video. That trades a bit of raw speed for deterministic output: no dropped frames, no white-flash-on-load, and video duration accurate to a single frame. The animation above is [assets/demo-animation.json](assets/demo-animation.json), rendered by this library.

## Install

```bash
npm install lottie-render
```

This also downloads a Playwright Chromium build on install (needed for rendering) — expect the first `npm install` to take a minute and ~300MB. You'll also need `ffmpeg` on your `PATH`.

## Usage

```ts
import { renderLottie } from 'lottie-render';
import fs from 'fs';

const lottieJson = JSON.parse(fs.readFileSync('animation.json', 'utf-8'));

const result = await renderLottie(lottieJson, {
  width: 1080,
  height: 1080,
  backgroundColor: '#ffffff',
});

if (result.success) {
  fs.writeFileSync('out.mp4', result.videoBuffer!);
} else {
  console.error(result.error);
}
```

`renderLottie` also accepts a file path instead of a parsed object:

```ts
await renderLottie('animation.json', { width: 1080, height: 1080 });
```

### API

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
| `backgroundColor` | transparent | e.g. `#ffffff` |
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
| `videoPath` | Path to the rendered MP4, present when `outputPath` **was** given (equal to it) |
| `metadata` | `{ duration, fps, width, height, name? }` describing the *actual rendered output* (reflecting any `options` overrides), not necessarily the source JSON's own values |
| `duration` | Wall-clock render time, ms |
| `error` | Failure reason, present when `success` is `false` |

### Security note for untrusted input

If you render Lottie files from a source you don't fully trust, be aware: a Lottie JSON can reference external image/font assets by URL. This library blocks every outbound network request the rendering browser makes except `file://`/`data:`/`blob:` URIs — so remote asset URLs simply won't load (this also prevents the render process from being used for SSRF). If you need images or fonts, embed them as base64 in the Lottie JSON, which is how most real-world exports already work. `maxFrames`/`maxDimension` further guard against a crafted animation with an enormous frame range or resolution tying up a render indefinitely.

## Architecture

```
input (object or file path) → launch headless Chromium
  → load templates/lottie-player.html (lottie-web, vendored locally — no CDN dependency)
  → for each frame: goToAndStop(frame) → screenshot → buffer in memory
  → batch-write frames to a scratch temp dir → ffmpeg -framerate ... → MP4
  → outputPath given? write there and return videoPath : read into memory, delete temp dir, return videoBuffer
```

Frame rate, duration, and dimensions default to the Lottie JSON's own metadata (`fr`/`ip`/`op`/`w`/`h`) unless overridden by `options`.

## Optional: run as an HTTP service

The repo also ships an Express-based HTTP service built on top of the library, for cases where you want a shared rendering endpoint instead of embedding the library directly (e.g. multiple apps/languages calling one central renderer). It is **not** required to use `lottie-render` as a library — skip this section if `renderLottie()` is all you need.

### Docker (recommended)

```bash
git clone https://github.com/steven-panxd/lottie-render.git
cd lottie-render
cp .env.example .env
# edit .env and set API_KEY to a strong secret

docker-compose up -d
curl http://localhost:3000/api/health
```

See [DOCKER.md](DOCKER.md) for more deployment detail (resource limits, troubleshooting, updates).

### Local development

```bash
npm install
cp .env.example .env
npm run dev
```

### `POST /api/render`

`multipart/form-data` request:

| Field | Required | Description |
|---|---|---|
| `file` | yes | The Lottie JSON file |
| `width` / `height` / `fps` / `backgroundColor` / `quality` | no | Same meaning as the library options above |

The response **body is the rendered MP4 file itself**, not JSON — render metadata comes back in response headers: `X-Task-ID`, `X-Render-Duration`, `X-Video-Duration`, `X-Video-FPS`, `X-Video-Width`, `X-Video-Height`. Error responses (4xx/5xx) are JSON: `{ "success": false, "error": "..." }`. A `503` means the server is at its concurrency limit — retry later.

```bash
curl -X POST http://localhost:3000/api/render \
  -H "X-API-Key: your-api-key" \
  -F "file=@animation.json" \
  -F "width=1080" \
  -F "height=1080" \
  -o output.mp4
```

### `GET /api/health`

Unauthenticated liveness/readiness check — returns process uptime and memory usage.

### Server-mode configuration (env vars)

These set server-only concerns, or provide the env-var equivalent of the library options above:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | - | Set to `production` to enable the production auth gate below |
| `API_KEY` | - | Shared secret required in the `X-API-Key` or `Authorization: Bearer` header. **Required when `NODE_ENV=production`** — the server refuses to start without it. Outside production, an unset key disables auth for local development convenience only |
| `MAX_CONCURRENT_RENDERS` | `5` | Requests beyond this are rejected with `503` rather than queued (server-only, no library equivalent) |
| `MAX_FRAMES` | `6000` | Sets the `maxFrames` library option for every render this server handles |
| `MAX_DIMENSION` | `4096` | Sets the `maxDimension` library option for every render this server handles |

### Security

- **Auth is fail-closed in production.** If `NODE_ENV=production` and `API_KEY` is unset, the server exits at startup instead of silently running unauthenticated.
- **No built-in rate limiting** beyond the in-process concurrency counter. If you expose this service publicly, put it behind a reverse proxy or gateway that rate-limits by client.
- See the library's security note above — it applies identically in server mode.

## Limitations / Roadmap

- Installing this package pulls in `express`/`multer` even if you only use the library and never touch the HTTP server — acceptable for this project's size, flagged here rather than engineered around with optional/peer dependencies.
- Server-mode concurrency limiting is a per-process in-memory counter — it does not coordinate across multiple replicas/instances.
- No built-in job queue in server mode; the request blocks until the render finishes.
- No audio support.
- Rendering is CPU/memory-bound (one headless Chromium instance per concurrent render).

## Testing

```bash
npm test        # unit tests + real end-to-end tests (headless browser + ffmpeg)
npm run typecheck
```

The suite (`test/e2e/`) runs real renders — through the library entry point directly, the HTTP API, and (via `npm pack` → `npm install` into a scratch directory → `require('lottie-render')` from a separate process) the actual published package — no mocking of the browser or FFmpeg. This includes a test that the library never writes files into the caller's working directory, and a test that verifies the SSRF protection by asserting a local canary server is never contacted. See [.github/workflows/ci.yml](.github/workflows/ci.yml) for how this runs in CI.

## License

[MIT](LICENSE)
