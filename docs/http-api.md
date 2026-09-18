# HTTP API

Normal production mode requires API_KEY. The explicit [demo preset](demo.md) permits anonymous access with smaller limits and an upload page.

## POST /api/render

Send multipart/form-data with one JSON `file` and up to six optional fields: width, height, fps, backgroundColor, quality and frameRateMode. Field values follow the [library API](api.md). Demo mode scales to fit and always resamples at no more than 30 fps or the source rate.

```bash
curl --fail-with-body http://localhost:3000/api/render \
  -H "X-API-Key: your-api-key" \
  -F "file=@animation.json" \
  -F "fps=30" -F "frameRateMode=resample" \
  -o output.mp4
```

Success returns the MP4 body, with X-Task-ID, X-Render-Duration (milliseconds), X-Video-Duration (seconds), X-Video-FPS, X-Video-Width and X-Video-Height headers. Errors return JSON with success:false and an error message, plus errorCode for renderer failures.

| HTTP status | Meaning |
|---|---|
| 400 | Invalid input or options |
| 401 / 403 | Missing or incorrect API key |
| 413 | Upload too large |
| 429 | Demo per-IP submission limit |
| 503 | All upload/render/download slots occupied |
| 504 | Whole-job deadline reached |

429 and 503 include Retry-After. Admission occurs before multipart buffering. Disconnecting during rendering cancels the job. Videos are removed after transfer or failure; there is no public /videos directory. The service has no queue or persistent database.

## GET /api/health

Liveness, uptime, timestamp and activeRenders (admitted uploads/jobs/downloads). Memory fields describe Node's heap, NOT total container memory. This endpoint does not test FFmpeg or Chromium; use `lottie-render doctor` for that.

## GET /api/config

Public demo limits and requiresApiKey. Never returns the key.

## Environment

| Variable | Normal / demo default | Description |
|---|---|---|
| PORT | 3000 | HTTP port |
| NODE_ENV | unset | production requires API_KEY unless explicitly in demo mode |
| RENDER_PRESET | unset | demo enables anonymous access, UI and smaller defaults |
| API_KEY | unset | X-API-Key or Authorization: Bearer; if set, required even in demo mode |
| MAX_CONCURRENT_RENDERS | 5 / 1 | Per-process admitted requests |
| MAX_UPLOAD_BYTES | 10485760 / 2097152 | Multipart file limit |
| MAX_FRAMES | 6000 / 300 | Output frame cap |
| MAX_DIMENSION | 4096 / 512 | Output dimension cap |
| MAX_DURATION_SECONDS | 200 / 10 | Source duration cap |
| RENDER_TIMEOUT_MS | 120000 / 60000 | Render deadline |
| REQUESTS_PER_MINUTE | 60 / 5 | Per-IP attempts; enforced in demo mode |
| TRUST_PROXY_HOPS | unset | Exact trusted proxy hop count; forwarded IPs ignored by default |

Use one replica for a global concurrency of one. See [the demo guide](demo.md) for proxy trust, isolation, ephemeral storage and deployment details.
