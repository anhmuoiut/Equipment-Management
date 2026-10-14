import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.{ts,tsx}', 'app/**/*.test.ts', 'components/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
