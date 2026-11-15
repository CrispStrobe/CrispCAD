// SPDX-License-Identifier: BSD-3-Clause
import {createLocalModelLibraryCatalogue, parseModelLibraryCatalogue, validateModelLibraryCatalogue} from '@brickwright/cad-core';
import manifestText from '../../../library/examples-manifest.json?raw';
import supportedText from '../../../library/supported-models-manifest.json?raw';
import fixtureText from '../../../library/fixtures-manifest.json?raw';
import corpusText from '../../../library/editor-corpus-manifest.json?raw';
import a2dText from '../../../library/a2d-editor-manifest.json?raw';
import sconText from '../../../library/scon-editor-manifest.json?raw';
import jscadText from '../../../library/jscad-editor-manifest.json?raw';
import ldrawText from '../../../library/ldraw-editor-manifest.json?raw';
import seedText from '../../../library/seed-catalogue.json?raw';
import previewText from '../../../library/previews.json?raw';
import bsdNotice from '../../../library/evidence/brickwright-examples-LICENSE.txt?raw';
import cc0Notice from '../../../library/evidence/slicer-test-models-LICENSE.md?raw';
import mitNotice from '../../../library/evidence/jscad-LICENSE.txt?raw';
import corpusNotice from '../../../library/evidence/corpus-selection-MIT-LICENSE.txt?raw';
import a2dNotice from '../../../library/evidence/a2d-MIT-LICENSE.txt?raw';
import sconNotice from '../../../library/evidence/scon-MIT-LICENSE.txt?raw';
import ldrawNotice from '../../../library/evidence/ldraw-CC-BY-4.0.txt?raw';

// Only exact files bundled at build time are exposed; no path is read from a host filesystem.
const sources = import.meta.glob(['../../../library/sources/brickwright/*.cad', '../../../library/sources/slicer-test-models/*.scad', '../../../library/sources/jscad/gear.js', '../../../library/sources/corpus-selection/*.scad', '../../../library/sources/a2d/**/*.scad', '../../../library/sources/scon/**/*.scad', '../../../library/sources/jscad-reviewed/*.js', '../../../library/sources/jscad-reviewed/*.scad', '../../../library/sources/ldraw/**/*.dat'], {query: '?raw', import: 'default', eager: true}) as Record<string, string>;
const meshData = import.meta.glob('../../../library/meshes/ldraw/*.stl', {query: '?url&inline', import: 'default', eager: true}) as Record<string, string>;
export function createBundledModelLibrary() {
  const localFiles = new Map<string, Uint8Array>();
  for (const [path, source] of Object.entries(sources)) {
    const relative = path.slice(path.indexOf('/sources/') + 1);
    localFiles.set(relative, new TextEncoder().encode(source));
  }
  for (const [path, dataUrl] of Object.entries(meshData)) {
    const encoded = /^data:[^,]*;base64,(.*)$/.exec(dataUrl)?.[1];
    if (!encoded) throw new Error('Expected an inline bundled library mesh.');
    localFiles.set(path.slice(path.indexOf('/meshes/') + 1), Uint8Array.from(atob(encoded), character => character.charCodeAt(0)));
  }
  const examples = createLocalModelLibraryCatalogue(JSON.parse(manifestText));
  const fixtures = createLocalModelLibraryCatalogue(JSON.parse(fixtureText));
  const corpus = createLocalModelLibraryCatalogue(JSON.parse(corpusText));
  const a2d = createLocalModelLibraryCatalogue(JSON.parse(a2dText));
  const scon = createLocalModelLibraryCatalogue(JSON.parse(sconText));
  const jscad = createLocalModelLibraryCatalogue(JSON.parse(jscadText));
  const ldraw = createLocalModelLibraryCatalogue(JSON.parse(ldrawText));
  const seeds = parseModelLibraryCatalogue(seedText);
  if (!seeds.valid) throw new Error(seeds.errors.join(' '));
  // Explicit admission: only this pinned seed has a qualified supported conversion.
  // Keep the immutable original URL alongside the local copy's exact byte identity.
  const gear = seeds.catalogue.assets.find(asset => asset.id === 'jscad-involute-gear');
  if (!gear) throw new Error('Missing reviewed gear seed.');
  gear.modificationNotes = 'Unmodified upstream JavaScript retained. Insertion translates default parameters with Brickwright’s bounded interpreter into an editable CAD Script evaluated snapshot; original JavaScript parameters are not project parameters. No mesh or physics qualification.';
  gear.editableSource = {path: 'sources/jscad/gear.js', format: gear.original.format, bytes: gear.original.bytes, sha256: gear.original.sha256};
  gear.licence.attribution += ` Applicable original JSCAD MIT notice (retained for source and converted geometry; line breaks normalized to spaces): ${mitNotice.replace(/\r?\n/g, ' ')}`;
  const checked = validateModelLibraryCatalogue({...examples, assets: [...examples.assets, ...fixtures.assets, ...createLocalModelLibraryCatalogue(JSON.parse(supportedText)).assets, gear, ...corpus.assets, ...a2d.assets, ...scon.assets, ...jscad.assets, ...ldraw.assets]});
  if (!checked.valid) throw new Error(checked.errors.join(' '));
  const previews=new Map<string,string>(Object.entries(JSON.parse(previewText).previews));
  for(const asset of checked.catalogue.assets)if(!previews.has(asset.original.sha256))throw new Error('Missing bundled model preview: '+asset.id);
  return {catalogue: checked.catalogue, localFiles, previews, licenceTexts:new Map([['BSD-3-Clause',bsdNotice],['CC0-1.0',cc0Notice],['MIT',mitNotice],...corpus.assets.map(asset=>[asset.id,corpusNotice] as [string,string]),...a2d.assets.map(asset=>[asset.id,a2dNotice] as [string,string]),...scon.assets.map(asset=>[asset.id,sconNotice] as [string,string]),...jscad.assets.map(asset=>[asset.id,mitNotice] as [string,string]),...ldraw.assets.map(asset=>[asset.id,ldrawNotice] as [string,string])])};
}
