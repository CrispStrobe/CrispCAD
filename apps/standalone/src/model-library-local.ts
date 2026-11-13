// SPDX-License-Identifier: BSD-3-Clause
import {createLocalModelLibraryCatalogue} from '@brickwright/cad-core';
import manifestText from '../../../library/examples-manifest.json?raw';
import fixtureText from '../../../library/fixtures-manifest.json?raw';

// Only exact files bundled at build time are exposed; no path is read from a host filesystem.
const sources = import.meta.glob(['../../../library/sources/brickwright/*.cad', '../../../library/sources/slicer-test-models/*.scad'], {query: '?raw', import: 'default', eager: true}) as Record<string, string>;
export function createBundledModelLibrary() {
  const localFiles = new Map<string, Uint8Array>();
  for (const [path, source] of Object.entries(sources)) {
    const relative = path.slice(path.indexOf('/sources/') + 1);
    localFiles.set(relative, new TextEncoder().encode(source));
  }
  const examples = createLocalModelLibraryCatalogue(JSON.parse(manifestText));
  const fixtures = createLocalModelLibraryCatalogue(JSON.parse(fixtureText));
  return {catalogue: {...examples, assets: [...examples.assets, ...fixtures.assets]}, localFiles};
}
