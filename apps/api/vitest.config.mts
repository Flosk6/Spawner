import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    setupFiles: ['reflect-metadata'],
    // Some specs run git and tar for real; under the load of every suite at once, 5 s is short.
    testTimeout: 30_000,
  },
});
