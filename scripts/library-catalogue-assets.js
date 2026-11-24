// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const moduleId = 'brickwright:cad-catalogue-manifests';
const manifestNames = [
  'examples', 'fixtures', 'supported-models', 'editor-corpus',
  'a2d-editor', 'scon-editor', 'jscad-editor', 'ldraw-editor', 'ldraw-reviewed-batch',
];

export function libraryCatalogueAssets() {
  return {
    name: 'brickwright-library-catalogue',
    resolveId(id) { return id === moduleId ? '\0' + id : null; },
    load(id) {
      if (id !== '\0' + moduleId) return null;
      const manifests = manifestNames.map(name => {
        const file = new URL(`../library/${name}-manifest.json`, import.meta.url);
        this.addWatchFile(fileURLToPath(file));
        return JSON.parse(readFileSync(file, 'utf8'));
      });
      // Keep one compact payload and create a fresh set of records for each caller.
      return `export default () => JSON.parse(${JSON.stringify(JSON.stringify(manifests))});`;
    },
  };
}
