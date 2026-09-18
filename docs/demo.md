# A small, real live demo

This preset accepts a visitor's Lottie JSON, runs Chromium and FFmpeg on the server, and returns a real H.264 MP4. It includes an upload page, bundled sample, preview, cancellation and download. It needs no database, Redis, persistent volume or external asset service.

The page opens with a bundled sample. Choose or drop a JSON file to preview it locally, play/pause it, or scrub its timeline. Only **Convert to MP4** sends the file to the server; loading the page and playing the preview consume no render slot. A successful conversion replaces the preview with the actual MP4 and provides a download named after the input file.

Local previews use the bundled Lottie player in a sandboxed iframe. Its content policy blocks network assets and evaluated expressions, so some animations may not preview locally even if server conversion succeeds. Use self-contained JSON with embedded images. The frontend adds no CDN or framework dependency.

## Run from a checkout

```bash
npm ci
npm run serve:demo
```

Open http://localhost:3000. Node.js 20+, FFmpeg and Playwright's Chromium are required. From a built checkout, run `node dist/cli.js doctor` to check them.

## Run with Docker

```bash
docker compose -f compose.demo.yml up --build -d
```

Open http://localhost:3000. Stop with `docker compose -f compose.demo.yml down`.

The compose file starts one replica, with 1 CPU, 1 GiB RAM, an init process and no persistent storage. Use the measured [container benchmark](benchmarks.md) to choose smaller limits; simple fixture success does not establish support for every 2 MB JSON file. Memory and CPU limits must also be configured on the hosting platform when deploying outside Compose.

On a container hosting platform, build the included Dockerfile, expose port 3000 (or set PORT), and set:

```env
NODE_ENV=production
RENDER_PRESET=demo
MAX_CONCURRENT_RENDERS=1
```

A platform-provided HTTPS address is sufficient. No paid dependency is required by the application; platform pricing is separate.

## Default limits

| Setting | Demo default |
|---|---|
| Admitted uploads + jobs + downloads | 1 per process |
| Upload | 2 MiB; one JSON file |
| Source duration | 10 seconds |
| Output | At most 512 px per dimension, aspect ratio retained within even-pixel rounding; no upscaling |
| Frame rate | At most 30 fps and no higher than the source; resampled to preserve duration |
| Output frame count | 300 |
| Whole render timeout | 60 seconds |
| Encoding | H.264, `veryfast`, CRF 25, one encoder thread |
| Submission rate | 5 attempts per minute per IP |
| Upload deadline | 30 seconds |

Full capacity returns 503 with Retry-After; per-IP throttling returns 429. Oversized files return 413. The service reserves capacity **before** buffering the multipart upload. Invalid requests and disconnected uploads release their slot. Disconnecting during a render cancels it; files are removed after transfer or failure. Restarting a container also discards its ephemeral filesystem.

The browser's Cancel button aborts the request. A reverse proxy must propagate disconnects for server cancellation to work promptly; the render deadline remains a fallback. Set the proxy response timeout above the render timeout.

## Public access is explicit

`RENDER_PRESET=demo` intentionally permits anonymous submissions in production. If API_KEY is set, it is still required; the page then asks for it without persisting it. Normal production API mode continues to require a key. Never embed a shared secret into public JavaScript.

The rate limiter is per process and keeps a bounded, expiring IP map. By default, forwarded IP headers are ignored. Behind a known, trusted proxy topology, set `TRUST_PROXY_HOPS` to its exact hop count. Do not enable this on an endpoint directly reachable by users through a shorter path. Keep one replica for a global concurrency of one.

Only bundled player files and embedded data/blob assets are allowed in the rendering browser. The player still executes complex, untrusted animation data and Chromium runs without its sandbox; use an isolated container, no credentials mounted into it, and platform CPU/memory limits. These controls do not promise support for arbitrary hostile files.

## Prebuilt images

The `Container image` GitHub Actions workflow builds both `linux/amd64` and `linux/arm64`. Run it manually with publishing disabled to validate builds, or enable publishing to push to `ghcr.io/<owner>/lottie-render`. It creates immutable SHA tags, and `latest` only from main. Make the package public if anonymous deployment pulls are needed.

No image is published merely by checking in the workflow. Until the first successful publication, build locally with Compose. npm CLI changes likewise require a new npm release; the checkout commands above work before release.

## Architecture checks

Local ARM64 builds and real renders passed. AMD64 builds also passed locally, but rendering through Docker Desktop's QEMU emulation crashed Chromium's GPU process; this is not a native AMD64 validation. The CI `container-smoke` job runs the production image on native AMD64, with 512 MiB, one CPU, no swap and no network, and verifies a real rendered video's frame count. Check that job before relying on an AMD64 deployment.
