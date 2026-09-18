# lottie-render

[Live Lottie to MP4 demo](https://lottie.xuedo.ng/) — preview locally, convert on the server, and download a real MP4.

**Convert Lottie animations to MP4 in your Node.js backend or through a self-hosted HTTP API.**

[![CI](https://github.com/steven-panxd/lottie-render/actions/workflows/ci.yml/badge.svg)](https://github.com/steven-panxd/lottie-render/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/lottie-render.svg)](https://www.npmjs.com/package/lottie-render)
[![license](https://img.shields.io/npm/l/lottie-render.svg)](LICENSE)

[Quick start](#quick-start) · [Run the demo](#run-the-included-demo) · [HTTP API](docs/http-api.md) · [Benchmarks](docs/benchmarks.md) · [简体中文](README.zh-CN.md)

Turn After Effects / bodymovin JSON into a video you can download, share, or pass to another video-processing step. Call `renderLottie()` from your application, or deploy one renderer for services written in different languages.

![Preview of the included Lottie animation, rendered with lottie-render](assets/demo.gif)

Try this exact animation with `npm run demo` from a checkout. [Input JSON](assets/demo-animation.json) → `videos/demo.mp4` (400 × 400, 3 seconds, 30 fps). The image above is a GIF preview; the renderer produces MP4.

## When to use it

| Your task | How to use lottie-render |
|---|---|
| Add “Export as video” to an app that already produces Lottie JSON | Call the Node.js library and save or return the MP4 |
| Render animations from Python, Go, or another backend | Deploy the HTTP service and upload JSON with a POST request |
| Convert a collection of self-contained Lottie files | Call the library sequentially from a script or your existing job queue |

The renderer seeks to each source frame with `goToAndStop()` and captures it before encoding, so capture speed does not determine playback speed. It uses lottie-web in Chromium, then FFmpeg for H.264 MP4. The player is bundled locally, and the rendering browser blocks HTTP(S) asset requests.

**Check the fit:** output is opaque MP4 without audio. You need Node.js 20+, Chromium and FFmpeg. Rendering is an offline job, and the service has no built-in queue. See [limitations](#limitations) before integrating.

## Quick start

### 1. Install

Install Node.js 20+ and FFmpeg, then add the package:

```bash
# macOS (Homebrew)
brew install ffmpeg

# Ubuntu / Debian, instead of the command above
# sudo apt-get update && sudo apt-get install -y ffmpeg

npm install lottie-render
ffmpeg -version
```

Installation downloads Playwright's Chromium build; allow a few hundred MB and extra time on the first install. On Linux, install browser system dependencies with `npx playwright install --with-deps chromium` if needed. For a containerized setup, use [Docker](DOCKER.md).

### 2. Get a sample and create a script

Use your own self-contained Lottie JSON, or download the included sample:

```bash
curl -fL https://raw.githubusercontent.com/steven-panxd/lottie-render/main/assets/demo-animation.json -o animation.json
```

Save this as **`render.mjs`** (the `.mjs` extension enables `import` and top-level `await`):

```js
import { renderLottie } from 'lottie-render';

const result = await renderLottie('animation.json', {
  outputPath: 'output.mp4',
  backgroundColor: '#ffffff',
});

if (!result.success) throw new Error(result.error);
console.log(`Saved ${result.videoPath}`);
```

### 3. Render

```bash
node render.mjs
```

Open `output.mp4`. The sample produces a **3-second, 400 × 400 video at 30 fps**. Width, height and frame rate default to the source animation. An existing file at `outputPath` is overwritten.

### Run the included demo

To try the source checkout without creating a script, install Node.js 20+ and FFmpeg, then run:

```bash
git clone https://github.com/steven-panxd/lottie-render.git
cd lottie-render
npm ci
npm run demo
```

The command builds the library, renders `assets/demo-animation.json`, and prints the output path and render time. It writes `videos/demo.mp4` and overwrites it on subsequent runs.

To render your own file through the same example:

```bash
npm run demo -- samples/animation.json videos/animation.mp4
```

The package now includes a CLI. In a built checkout:

```bash
node dist/cli.js doctor
node dist/cli.js render assets/demo-animation.json -o output.mp4 --fps 15
npm run serve:demo
```

The last command starts a real upload, server render and MP4 download page at http://localhost:3000. Alternatively, run `docker compose -f compose.demo.yml up --build`. See [demo deployment and limits](docs/demo.md).

After installing a package release containing these changes, use `npx lottie-render doctor`, `npx lottie-render render animation.json -o output.mp4`, or `npx lottie-render serve --preset demo`. Before that release, use the checkout commands above.

For library-only use, `npm install lottie-render --omit=optional` skips the HTTP server dependencies. Default installation includes them so `serve` works immediately. Rendering still requires Chromium and FFmpeg.

## API

`renderLottie(input, options)` accepts a parsed Lottie object or a local JSON file path. Use `outputPath` to save to disk, or omit it to receive `result.videoBuffer`. Always check `result.success` before using the output.

[Full options and return values](docs/api.md) · [TypeScript types](src/types/index.ts)

**Frame-rate behavior:** library calls retain the original speed-changing behavior by default. Set `frameRateMode: 'resample'` to preserve source duration when changing fps (rounded up to a whole output frame). The CLI and demo resample by default.

## Run as an HTTP service

From a repository checkout, configure and start the service:

```bash
cp .env.example .env
# Edit .env and replace API_KEY with a strong random secret.
docker compose up -d --build
curl --fail http://localhost:3000/api/health
```

Send the included animation using the same key you put in `.env`:

```bash
curl --fail-with-body http://localhost:3000/api/render \
  -H "X-API-Key: your-api-key" \
  -F "file=@assets/demo-animation.json" \
  -F "backgroundColor=#ffffff" \
  -o output.mp4
```

The response body is the MP4; errors are JSON. `--fail-with-body` makes HTTP errors produce a nonzero exit status, so check that the command succeeds before opening `output.mp4`. Requests wait for rendering to finish; excess concurrent requests receive `503`.

[Deployment and troubleshooting](DOCKER.md) · [Endpoints, headers and configuration](docs/http-api.md)

## Performance

See [measured results and reproduction steps](docs/benchmarks.md) for the included animation at 400 × 400 and 1080 × 1080. Run `npm run benchmark` in a checkout to measure your machine (requires `ffprobe`, normally included with FFmpeg).

Rendering time depends on frame count, resolution, animation complexity and hardware. Each render writes JPEGs one at a time to temporary disk and closes Chromium before encoding. Measure representative files before choosing concurrency or container memory limits.

## Limitations

- **MP4 only, no audio or alpha channel.** Setting `backgroundColor: 'transparent'` does not produce transparent video. Set an explicit background color for predictable output.
- **Self-contained assets work best.** HTTP(S) image and font requests are blocked; embed assets and verify your actual animations. Text rendering depends on the glyphs or fonts available to the player. This repo does not certify every Lottie feature or export.
- **Use even pixel dimensions.** The H.264 encoder uses `yuv420p`, which requires even width and height.
- **No queue or cross-instance concurrency coordination.** Server limits are per process. Use your own queue for batch jobs.
- **Temporary disk is required.** Default caps are 6,000 output frames, 4,096 pixels per dimension and a 120-second job deadline. Browser state and filesystem cache still consume memory.
- Library-only installations can omit HTTP dependencies with `--omit=optional`.

## Security

The rendering browser permits only bundled local player files and embedded data/blob assets. The library validates inputs and supports deadlines and cancellation. These controls are not a complete isolation boundary for hostile files. Run untrusted jobs in an appropriately isolated environment.

Normal HTTP service mode requires an API key in production. The explicit `demo` preset permits public access with upload, concurrency and per-IP limits. See [library behavior](docs/api.md#security-note-for-untrusted-input) and [server configuration](docs/http-api.md#security).

## Development and feedback

```bash
npm ci
npm run typecheck
npm run build
npm test
```

Tests include real browser/FFmpeg renders, the HTTP API and installation of the packed npm package. They require FFmpeg and Chromium; see [CI](.github/workflows/ci.yml).

Found an animation that renders incorrectly? [Open an issue](https://github.com/steven-panxd/lottie-render/issues/new) with a shareable JSON sample, expected/actual output, OS, Node.js version and FFmpeg version. For feature requests, describe the export workflow you need.

If this helps your workflow, a star makes the project easier to find again and lets me know it is useful.

## License

[MIT](LICENSE)
