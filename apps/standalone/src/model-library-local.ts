// SPDX-License-Identifier: BSD-3-Clause
import {createLocalModelLibraryCatalogue, parseModelLibraryCatalogue, validateModelLibraryCatalogue} from '@brickwright/cad-core';
import manifestText from '../../../library/examples-manifest.json?raw';
import fixtureText from '../../../library/fixtures-manifest.json?raw';
import seedText from '../../../library/seed-catalogue.json?raw';
import mitNotice from '../../../library/evidence/jscad-LICENSE.txt?raw';

// Only exact files bundled at build time are exposed; no path is read from a host filesystem.
const sources = import.meta.glob(['../../../library/sources/brickwright/*.cad', '../../../library/sources/slicer-test-models/*.scad', '../../../library/sources/jscad/gear.js'], {query: '?raw', import: 'default', eager: true}) as Record<string, string>;
export function createBundledModelLibrary() {
  const localFiles = new Map<string, Uint8Array>();
  for (const [path, source] of Object.entries(sources)) {
    const relative = path.slice(path.indexOf('/sources/') + 1);
    localFiles.set(relative, new TextEncoder().encode(source));
  }
  const examples = createLocalModelLibraryCatalogue(JSON.parse(manifestText));
  const fixtures = createLocalModelLibraryCatalogue(JSON.parse(fixtureText));
  const seeds = parseModelLibraryCatalogue(seedText);
  if (!seeds.valid) throw new Error(seeds.errors.join(' '));
  // Explicit admission: only this pinned seed has a qualified supported conversion.
  // Keep the immutable original URL alongside the local copy's exact byte identity.
  const gear = seeds.catalogue.assets.find(asset => asset.id === 'jscad-involute-gear');
  if (!gear) throw new Error('Missing reviewed gear seed.');
  gear.modificationNotes = 'Unmodified upstream JavaScript retained. Insertion translates default parameters with Brickwright’s bounded interpreter into an editable CAD Script evaluated snapshot; original JavaScript parameters are not project parameters. No mesh or physics qualification.';
  gear.editableSource = {path: 'sources/jscad/gear.js', format: gear.original.format, bytes: gear.original.bytes, sha256: gear.original.sha256};
  gear.licence.attribution += ` Applicable original JSCAD MIT notice (retained for source and converted geometry; line breaks normalized to spaces): ${mitNotice.replace(/\r?\n/g, ' ')}`;
  const checked = validateModelLibraryCatalogue({...examples, assets: [...examples.assets, ...fixtures.assets, gear]});
  if (!checked.valid) throw new Error(checked.errors.join(' '));
  return {catalogue: checked.catalogue, localFiles};
}
