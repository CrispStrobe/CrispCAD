// Reproducible qualification report; blocked entries are NOT physics-ready.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {shapeCatalog,createPresetDocument} from '../packages/editor/dist/index.js';
import {createGeometryKernel} from '../packages/geometry/dist/index.js';
import {prepareDocumentCollisions,createPhysicsWorld} from '../packages/physics/dist/index.js';
const args=process.argv.slice(2);
if(args.length>1||(args.length===1&&!args[0].startsWith('--only=')))throw Error('Usage: npm run verify:physics -- [--only=shape-id,shape-id]');
const selected=args.length?new Set(args[0].slice(7).split(',')):null;
if(selected&&[...selected].some(id=>!shapeCatalog.some(p=>p.id===id)))throw Error('Unknown shape in qualification selection');
const presets=selected?shapeCatalog.filter(p=>selected.has(p.id)):shapeCatalog;
const kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')}),J=await initJolt();const records=[];
for(const preset of presets){const started=Date.now();let world;
 try{const doc=structuredClone(createPresetDocument(preset.id,'ABC'));if(doc.roots.every(id=>doc.nodes[id].reference)){records.push({id:preset.id,status:'reference-excluded'});continue;}for(const id of doc.roots)doc.nodes[id].transform.position[2]+=70;const geometry=kernel.evaluate(doc),prepared=await prepareDocumentCollisions(doc,geometry,kernel);world=await createPhysicsWorld(doc,geometry,prepared,{J,mode:'rigid-preview'});for(let i=0;i<200;i++)world.step();if(!doc.roots.every(id=>world.pose(id).positionMm.every(Number.isFinite)&&world.geometryBoundsMm(id).min[2]>=-.25))throw new Error('Nonfinite or penetrating simulated state');const record={id:preset.id,status:'rigid-preview-pass',bodies:geometry.bodies.length,hulls:[...prepared.values()].reduce((s,p)=>s+p.hulls.length,0),maxRelativeError:Math.max(...[...prepared.values()].map(p=>p.certificate.relativeError)),milliseconds:Date.now()-started};records.push(record);console.log(preset.id,'PASS',record.hulls);}
 catch(error){records.push({id:preset.id,status:'blocked',reason:error instanceof Error?error.message:String(error),milliseconds:Date.now()-started});console.log(preset.id,'BLOCKED',records.at(-1).reason);}finally{world?.dispose();}
}
mkdirSync('artifacts',{recursive:true});writeFileSync(selected?'artifacts/catalog-physics-selected.json':'artifacts/catalog-physics.json',JSON.stringify({completeCatalogue:!selected,selection:selected?[...selected]:null,generatedAt:new Date().toISOString(),engine:'1.1.0-bw.10 debug',stepHz:200,steps:200,sourceFloorToleranceMm:.25,mode:'rigid-preview only; not mechanical/material/fit qualification',records},null,2));
const blocked=records.filter(r=>r.status==='blocked');console.log(`${records.length-blocked.length} passed/excluded, ${blocked.length} blocked`);if(blocked.length)process.exitCode=1;
