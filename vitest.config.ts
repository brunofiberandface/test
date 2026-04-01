import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary'],
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/firestore.ts', 'src/lib/gcs.ts', 'src/lib/vertex.ts', 'src/lib/drive.ts', 'src/lib/email.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
