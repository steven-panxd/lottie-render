/**
 * 测试渲染脚本
 * 用于验证核心渲染功能
 */

import { renderLottieToVideoFrameByFrame } from './renderer/frame-by-frame';
import * as path from 'path';

async function main() {
  console.log('=== Lottie Render Test ===\n');

  // 测试文件路径
  const jsonPath = path.resolve(process.cwd(), 'samples/template.json');

  console.log(`Testing with file: ${jsonPath}\n`);

  // 开始渲染（使用逐帧方案）
  const result = await renderLottieToVideoFrameByFrame(jsonPath, {
    width: 1920,
    height: 1080,
    fps: 30,
    backgroundColor: '#ffffff'
  });

  // 输出结果
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

// 运行测试
main().catch(error => {
  console.error('Test failed with error:', error);
  process.exit(1);
});
