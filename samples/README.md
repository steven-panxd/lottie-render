# samples/

Scratch space for your own Lottie JSON files during local testing. Contents of this folder (other than this file) are gitignored.

## Usage

Drop a Lottie JSON file here and render it through the running API:

```bash
cp /path/to/your/animation.json samples/

mkdir -p videos

curl --fail-with-body -X POST http://localhost:3000/api/render \
  -H "X-API-Key: your-api-key" \
  -F "file=@samples/animation.json" \
  -o videos/animation.mp4
```

For the animation shown in the README, run `npm run demo` to render [assets/demo-animation.json](../assets/demo-animation.json) into `videos/demo.mp4`.

For a small test fixture, see [test/fixtures/sample.json](../test/fixtures/sample.json) — that's also what `npm run test:render` renders.

## Supported input

- Lottie JSON (`.json`)
- bodymovin JSON exported from After Effects
- JSON downloaded from LottieFiles

Assets referenced by external URL are not fetched for security reasons (see the Security section of the main [README](../README.md)) — use files where images/fonts are embedded as base64, and verify the result with your assets.
