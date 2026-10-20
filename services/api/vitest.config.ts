import { defineConfig } from 'vitest/config';

// Unit tests: pure business logic, no database.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
});
