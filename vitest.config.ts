import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only run source test files — dist/ duplicates cause double execution
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],

    // MemoryEngine constructor + initialize takes ~7s on this machine
    // (module import + SQLite + sqlite-vec + subsystem init)
    hookTimeout: 30000,
    testTimeout: 60000,

    // Prevent SQLite race conditions — tests create temp DBs in /tmp
    // and parallel file execution causes SQLITE_READONLY errors
    fileParallelism: false,
  },
});
