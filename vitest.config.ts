import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Real end-to-end tests launch a headless browser and shell out to
    // FFmpeg, which take longer than typical unit-test timeouts.
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
