import {libraryPreviewAssets} from './scripts/library-preview-assets.js';
import { defineConfig } from 'vitest/config';
export default defineConfig({ plugins: [libraryPreviewAssets()], test: { include: ['tests/**/*.test.ts'], environment: 'node', maxWorkers: 2 } });
