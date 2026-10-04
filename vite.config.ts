import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { aiDevelopmentEndpoint } from './server/ai';

export default defineConfig(({ mode }) => ({
  plugins: [react(), aiDevelopmentEndpoint(loadEnv(mode, process.cwd(), ''))],
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
}));
