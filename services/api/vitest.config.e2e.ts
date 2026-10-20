import { defineConfig } from 'vitest/config';

// API integration tests: real HTTP stack against a real PostgreSQL test database.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
