import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One PGlite instance per file; files run in parallel workers.
    fileParallelism: true,
  },
});
