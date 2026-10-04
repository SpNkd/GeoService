import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['benchmarks/*.audit.ts'], environment: 'node', testTimeout: 120000, pool: 'forks', execArgv: ['--expose-gc'], fileParallelism: false } });
