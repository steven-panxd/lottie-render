// Run from the repository with `npm run demo` after installing FFmpeg.
const path = require('node:path');
const { renderLottie } = require('../dist');

async function main() {
  const input = process.argv[2] || path.join(__dirname, '../assets/demo-animation.json');
  const outputPath = process.argv[3] || path.join(__dirname, '../videos/demo.mp4');
  const result = await renderLottie(input, { outputPath, backgroundColor: '#ffffff' });

  if (!result.success) throw new Error(result.error || 'Rendering failed');
  console.log(`\nSaved: ${result.videoPath}`);
  console.log(`Video: ${result.metadata.width}×${result.metadata.height}, ${result.metadata.fps} fps, ${result.metadata.duration}s`);
  console.log(`Render time: ${(result.duration / 1000).toFixed(2)}s`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
