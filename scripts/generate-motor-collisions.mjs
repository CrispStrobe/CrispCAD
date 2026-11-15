// SPDX-License-Identifier: BSD-3-Clause
// Run after build:packages. Candidate data is always requalified against the live mesh.
import {readFileSync,writeFileSync} from 'node:fs';
import {createGeometryKernel} from '../packages/geometry/dist/index.js';
import {createMotorDocument,motorCatalog} from '../packages/editor/dist/motor-models.js';
import {prepareDocumentCollisions} from '../packages/physics/dist/index.js';
const kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
for(const preset of motorCatalog){
 const document=createMotorDocument(preset.id);
 delete document.nodes.casing.physics.collisionAssembly;
 const geometry=kernel.evaluate(document),prepared=await prepareDocumentCollisions(document,geometry,kernel);
 const pieces=prepared.get('casing').hulls.map(h=>({positions:Array.from(h.positions),indices:Array.from(h.indices)}));
 writeFileSync(`packages/editor/src/motor-assets/${preset.id}-collision.json`,JSON.stringify(pieces)+'\n');
 console.log(preset.id,pieces.length,'candidate pieces',prepared.get('casing').certificate.relativeError,'relative error');
}
