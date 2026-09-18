# Run the public demo on a shared VPS

This uses two containers: the renderer (one CPU, at most 1 GiB RAM) and a Caddy HTTPS proxy (half a CPU, at most 256 MiB). These are resource ceilings, not preallocated memory. Other applications can share the machine. No database, paid API, or additional VM is needed.

## Before deploying

Use an existing Linux VPS with Docker and Docker Compose. Confirm available memory and ports with `docker ps`, `free -h`, and `ss -ltnp`. This configuration publishes **443 only**, so an existing application can keep port 80. If something already uses port 443, integrate the demo into that reverse proxy instead of starting a competing listener.

Create a DNS-only A record for the chosen subdomain pointing to the VPS. Only add an AAAA record if IPv6 reaches the same server. This Caddy configuration validates and renews its public certificate using TLS-ALPN on port 443; a CDN proxy in front of that port would prevent the challenge. To enable a CDN proxy later, first configure DNS-based ACME validation or another compatible certificate-renewal method.

## Deploy

From a checkout of the commit you want to deploy:

```bash
export DEMO_HOST=lottie.example.com
export DEMO_IMAGE="lottie-render-demo:$(git rev-parse --short HEAD)"
docker compose -f compose.vps.yml config -q
docker compose -f compose.vps.yml build demo
docker compose -f compose.vps.yml pull https
docker compose -f compose.vps.yml run --rm --no-deps https caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose -f compose.vps.yml up -d
```

The hostname sets `PUBLIC_URL` automatically. For repeatable operations, keep `DEMO_HOST` and the image tag in an environment file and pass `--env-file /path/to/demo.env`. `CADDY_IMAGE` can be set to an image digest to pin the proxy version.

The renderer has no published port and only joins an internal Docker network. The HTTPS proxy is its single trusted forwarding hop. Caddy does not trust client-supplied forwarded headers by default. Certificates persist in a dedicated Docker volume. Container logs rotate after 10 MiB, with three files retained per service.

If port 80 belongs to an existing Nginx, add a separate server block for **only** the demo hostname:

```nginx
server {
    listen 80;
    server_name lottie.example.com;
    return 308 https://lottie.example.com$request_uri;
}
```

Back up the existing configuration, validate with `nginx -t`, then reload Nginx. Keep all existing virtual hosts. If port 80 is unused, you may instead publish it on the Caddy service and enable its automatic HTTP redirects.

## Verify and operate

```bash
curl --fail "https://$DEMO_HOST/api/health"
curl --fail "https://$DEMO_HOST/robots.txt"
curl --fail -F file=@public/sample.json "https://$DEMO_HOST/api/render" -o /tmp/lottie-demo-check.mp4
ffprobe -v error -show_entries stream=codec_name,width,height -of json /tmp/lottie-demo-check.mp4
docker compose -f compose.vps.yml ps
docker compose -f compose.vps.yml logs --tail 50
```

Upload size is capped at 2 MiB, source duration at 10 seconds, output at 512 pixels and 30 FPS, and simultaneous conversion at one. Requests are limited to five attempts per IP per minute. Caddy allows up to 3 MB for multipart overhead; the application enforces the smaller file limit. Uploaded files are temporary and there is no public result directory.

To roll back, set `DEMO_IMAGE` to the previous tag and run `docker compose -f compose.vps.yml up -d --no-build demo`. Keep old image tags until a replacement has been verified. Avoid `down -v`: it deletes the certificate volume. Stop only this Compose project when retiring the demo.

## Run the browser E2E check

From a development checkout with dependencies, Chromium and `ffprobe` installed:

```bash
node scripts/test-live-demo.cjs https://your-demo.example /tmp/lottie-live-e2e
```

Run against a demo with the default limits above, after at least one minute without render requests from your IP. This opt-in check submits real conversions, cancels a job, deliberately triggers concurrency and rate limits, and waits for the rate window before retrying. Allow about two minutes and avoid other conversions during the check. It saves desktop/mobile screenshots, a downloaded MP4, its `ffprobe` metadata and a JSON report. Browser coverage is Chromium with desktop and mobile viewport sizes, not physical-device or cross-browser certification.
