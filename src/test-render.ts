/**
 * Manual smoke-test script for the core rendering function.
 * Run with: npm run test:render
 */

import { renderLottie } from './index';
import * as path from 'path';

async function main() {
  console.log('=== Lottie Render Test ===\n');

  const jsonPath = path.resolve(process.cwd(), 'test/fixtures/sample.json');
  const outputPath = path.resolve(process.cwd(), 'videos', 'sample-test.mp4');

  console.log(`Testing with file: ${jsonPath}\n`);

  const result = await renderLottie(jsonPath, {
    width: 1920,
    height: 1080,
    fps: 30,
    backgroundColor: '#ffffff',
    outputPath
  });

  console.log('\n=== Render Result ===');
  console.log(JSON.stringify(result, null, 2));

  if (result.success) {
    console.log('\n✅ Rendering succeeded!');
    console.log(`📹 Video saved to: ${result.videoPath}`);
    console.log(`⏱️  Time taken: ${result.duration}ms`);

    if (result.metadata) {
      console.log('\n📊 Animation Info:');
      console.log(`   Duration: ${result.metadata.duration.toFixed(2)}s`);
      console.log(`   FPS: ${result.metadata.fps}`);
      console.log(`   Size: ${result.metadata.width}x${result.metadata.height}`);
      if (result.metadata.name) {
        console.log(`   Name: ${result.metadata.name}`);
      }
    }
  } else {
    console.log('\n❌ Rendering failed!');
    console.log(`Error: ${result.error}`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Test failed with error:', error);
  process.exit(1);
});
