import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    globalSetup: './src/routes/queue/__tests__/globalSetup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    // Run integration tests sequentially to avoid database conflicts
    fileParallelism: false,
    // Increase timeout for database operations
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
