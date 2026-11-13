// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createPresetDocument} from '@brickwright/cad-editor';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {prepareDocumentCollisions,createPhysicsWorld} from '@brickwright/cad-physics';
const kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')}),J=await initJolt(),records=[];
for(const font of ['sans','serif','mono'])for(const preset of ['text','name-tag']){let world;try{const doc=createPresetDocument(preset,'Grüße',{font});for(const id of doc.roots)doc.nodes[id].transform.position[2]=70;const geometry=kernel.evaluate(doc),prepared=await prepareDocumentCollisions(doc,geometry,kernel);world=await createPhysicsWorld(doc,geometry,prepared,{J,mode:'rigid-preview'});for(let i=0;i<200;i++)world.step();if(!doc.roots.every(id=>world.pose(id).positionMm.every(Number.isFinite)&&world.geometryBoundsMm(id).min[2]>=-.25))throw Error('Invalid floor contact');records.push({font,preset,status:'pass',hulls:[...prepared.values()].reduce((n,p)=>n+p.hulls.length,0),relativeError:Math.max(...[...prepared.values()].map(p=>p.certificate.relativeError))});console.log(preset,font,'PASS');}catch(e){records.push({font,preset,status:'blocked',reason:String(e)});console.log(preset,font,'BLOCKED',String(e));}finally{world?.dispose();}}
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/lettering-physics.json',JSON.stringify({engine:'Jolt bw.9 debug',steps:200,records},null,2));if(records.some(r=>r.status!=='pass'))process.exitCode=1;
