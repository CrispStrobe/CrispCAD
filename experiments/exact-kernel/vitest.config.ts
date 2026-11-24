// SPDX-License-Identifier: BSD-3-Clause
import { defineConfig } from 'vitest/config';
// One fork: smlibwasm loads its ~9 MB WASM per worker.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', pool: 'forks', maxWorkers: 1, testTimeout: 60_000 } });
