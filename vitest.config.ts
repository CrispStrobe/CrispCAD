import {libraryPreviewAssets} from './scripts/library-preview-assets.js';
import {libraryCatalogueAssets} from './scripts/library-catalogue-assets.js';
import { defineConfig } from 'vitest/config';
export default defineConfig({ plugins: [libraryPreviewAssets(), libraryCatalogueAssets()], test: { include: ['tests/**/*.test.ts'], environment: 'node', maxWorkers: 2 } });
