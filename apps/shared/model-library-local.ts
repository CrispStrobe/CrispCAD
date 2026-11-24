// SPDX-License-Identifier: BSD-3-Clause
/// <reference path="../../packages/editor/src/library-preview-assets.d.ts" />
import {bundledLibraryFiles,bundledAssetLicenceTexts} from './model-library-files.js';
import {createLocalModelLibraryCatalogue, parseModelLibraryCatalogue, validateModelLibraryCatalogue} from '@brickwright/cad-core';
import manifestText from '../../library/examples-manifest.json?raw';
import supportedText from '../../library/supported-models-manifest.json?raw';
import fixtureText from '../../library/fixtures-manifest.json?raw';
import corpusText from '../../library/editor-corpus-manifest.json?raw';
import a2dText from '../../library/a2d-editor-manifest.json?raw';
import sconText from '../../library/scon-editor-manifest.json?raw';
import jscadText from '../../library/jscad-editor-manifest.json?raw';
import ldrawText from '../../library/ldraw-editor-manifest.json?raw';
import ldrawBatchText from '../../library/ldraw-reviewed-batch-manifest.json?raw';
import seedText from '../../library/seed-catalogue.json?raw';
import previewData from 'brickwright:cad-model-previews';
import bsdNotice from '../../library/evidence/brickwright-examples-LICENSE.txt?raw';
import cc0Notice from '../../library/evidence/slicer-test-models-LICENSE.md?raw';
import mitNotice from '../../library/evidence/jscad-LICENSE.txt?raw';

// Only exact files bundled at build time are exposed; no path is read from a host filesystem.
const sources = import.meta.glob(['../../library/sources/**/*.cad','../../library/sources/**/*.scad','../../library/sources/**/*.js','../../library/sources/**/*.dat'], {query:'?raw',import:'default',eager:true}) as Record<string,string>;
const licenceDocuments = import.meta.glob(['../../library/evidence/*.txt','../../library/evidence/*.md'], {query:'?raw',import:'default',eager:true}) as Record<string,string>;
const meshData = import.meta.glob('../../library/meshes/ldraw/*.stl', {query: '?url&inline', import: 'default', eager: true}) as Record<string, string>;
export function createBundledModelLibraryOptions() {
  const bundledFiles = bundledLibraryFiles(sources,meshData);
  const examples = createLocalModelLibraryCatalogue(JSON.parse(manifestText));
  const fixtures = createLocalModelLibraryCatalogue(JSON.parse(fixtureText));
  const corpus = createLocalModelLibraryCatalogue(JSON.parse(corpusText));
  const a2d = createLocalModelLibraryCatalogue(JSON.parse(a2dText));
  const scon = createLocalModelLibraryCatalogue(JSON.parse(sconText));
  const jscad = createLocalModelLibraryCatalogue(JSON.parse(jscadText));
  const ldraw = createLocalModelLibraryCatalogue(JSON.parse(ldrawText));
  ldraw.assets.push(...createLocalModelLibraryCatalogue(JSON.parse(ldrawBatchText)).assets);
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
  const previews=new Map<string,string>(Object.entries(previewData.previews));
  for(const asset of checked.catalogue.assets)if(!previews.has(asset.original.sha256))throw new Error('Missing bundled model preview: '+asset.id);
  return {catalogue:checked.catalogue,bundledFiles,previews,licenceTexts:new Map([['BSD-3-Clause',bsdNotice],['CC0-1.0',cc0Notice],['MIT',mitNotice],...bundledAssetLicenceTexts([manifestText,fixtureText,supportedText,corpusText,a2dText,sconText,jscadText,ldrawText,ldrawBatchText,seedText].flatMap(text=>JSON.parse(text).assets),licenceDocuments)])};
}

export function createBundledModelLibrary() {
  const {bundledFiles,...options}=createBundledModelLibraryOptions();
  return {...options,localFiles:bundledFiles.materialize()};
}
