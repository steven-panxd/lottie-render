# HTTP API

Start the service with the [Docker guide](../DOCKER.md). Set `API_KEY` before starting in production.

## `POST /api/render`

`multipart/form-data` request:

| Field | Required | Description |
|---|---|---|
| `file` | yes | The Lottie JSON file |
| `width` / `height` / `fps` / `backgroundColor` / `quality` | no | Same meaning as the [library options](api.md) |

The response **body is the rendered MP4 file itself**, not JSON — render metadata comes back in response headers: `X-Task-ID`, `X-Render-Duration`, `X-Video-Duration`, `X-Video-FPS`, `X-Video-Width`, `X-Video-Height`. Error responses (4xx/5xx) are JSON: `{ "success": false, "error": "..." }`. A `503` means the server is at its concurrency limit — retry later.

```bash
curl --fail-with-body -X POST http://localhost:3000/api/render \
  -H "X-API-Key: your-api-key" \
  -F "file=@animation.json" \
  -F "width=1080" \
  -F "height=1080" \
  -o output.mp4
```

## `GET /api/health`

Unauthenticated liveness check (does not validate Chromium or FFmpeg) — returns process uptime and memory usage.

## Server-mode configuration (env vars)

These set server-only concerns, or provide the env-var equivalent of the [library options](api.md):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | - | Set to `production` to enable the production auth gate below |
| `API_KEY` | - | Shared secret required in the `X-API-Key` or `Authorization: Bearer` header. **Required when `NODE_ENV=production`** — the server refuses to start without it. Outside production, an unset key disables auth for local development convenience only |
| `MAX_CONCURRENT_RENDERS` | `5` | Requests beyond this are rejected with `503` rather than queued (server-only, no library equivalent) |
| `MAX_FRAMES` | `6000` | Sets the `maxFrames` library option for every render this server handles |
| `MAX_DIMENSION` | `4096` | Sets the `maxDimension` library option for every render this server handles |

## Security

- **Auth is fail-closed in production.** If `NODE_ENV=production` and `API_KEY` is unset, the server exits at startup instead of silently running unauthenticated.
- **No built-in rate limiting** beyond the in-process concurrency counter. If you expose this service publicly, put it behind a reverse proxy or gateway that rate-limits by client.
- See the [library security note](api.md#security-note-for-untrusted-input) — it applies identically in server mode.


[Back to README](../README.md)
