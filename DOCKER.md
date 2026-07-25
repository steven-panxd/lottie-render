# Docker Deployment Guide

## Quick start

`docker-compose` reads a `.env` file in the same directory and injects those values into the container.

```bash
cp .env.example .env
```

Edit `.env` and set a strong API key:

```env
PORT=3000
NODE_ENV=production
API_KEY=your-strong-api-key-here
MAX_CONCURRENT_RENDERS=5
```

`NODE_ENV=production` plus a missing `API_KEY` makes the server refuse to start — this is intentional, see the Security section in the main [README](README.md).

Verify how `.env` values get substituted into the compose file:

```bash
docker-compose config
```

## Using Docker Compose (recommended)

```bash
# Build and start
docker-compose up -d

# Tail logs
docker-compose logs -f

# Stop
docker-compose down
```

## Using plain Docker

```bash
# Build
docker build -t lottie-render:latest .

# Run
docker run -d \
  --name lottie-service \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e API_KEY=your-api-key \
  -e MAX_CONCURRENT_RENDERS=5 \
  -v $(pwd)/logs:/app/logs \
  --restart unless-stopped \
  lottie-render:latest

docker logs -f lottie-service
docker stop lottie-service
docker rm lottie-service
```

## Verifying a deployment

```bash
curl http://localhost:3000/api/health
```

```json
{
  "status": "ok",
  "uptime": 123.45,
  "timestamp": "2026-07-24T12:00:00.000Z",
  "memory": { "used": 50, "total": 100 }
}
```

```bash
curl -X POST http://localhost:3000/api/render \
  -H "X-API-Key: your-api-key" \
  -F "file=@test/fixtures/sample.json" \
  -o test.mp4
```

## Configuration reference

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | - | Set to `production` to require `API_KEY` |
| `API_KEY` | - | Required in production |
| `MAX_CONCURRENT_RENDERS` | `5` | Requests above this limit get `503` |
| `MAX_FRAMES` | `6000` | Frame-count cap per render |
| `MAX_DIMENSION` | `4096` | Max width/height in px |

### Resource limits

`docker-compose.yml` ships with default limits — adjust to your hardware:

```yaml
deploy:
  resources:
    limits:
      cpus: '4'
      memory: 4G
    reservations:
      cpus: '2'
      memory: 1G
```

Each concurrent render runs its own headless Chromium instance, so size `MAX_CONCURRENT_RENDERS` and the memory limit together — as a rough starting point, budget ~300-500MB per concurrent render plus overhead.

## Troubleshooting

**Container won't start**
```bash
docker-compose logs lottie-service
docker-compose config   # confirm env vars resolved as expected
lsof -i :3000            # check for a port conflict
```

**Playwright/Chromium issues** — the image already installs all required system libraries and the Chromium binary at build time. To debug interactively:
```bash
docker-compose exec lottie-service bash
npx playwright install chromium
```

**FFmpeg errors**
```bash
docker-compose exec lottie-service ffmpeg -version
```

**Out of memory** — raise the memory limit or lower `MAX_CONCURRENT_RENDERS`.

## Security

- Generate a strong API key: `openssl rand -hex 32`
- Don't expose this service directly to the public internet without a reverse proxy — there is no built-in rate limiting beyond the concurrency counter
- Keep the base Node.js image and dependencies up to date
