// SPDX-License-Identifier: BSD-3-Clause
// Deterministic original print kit; only the assembly includes purchased hardware.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {zipSync} from 'fflate';
import {validateDocument,setLocale} from '../packages/core/dist/index.js';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '../packages/geometry/dist/index.js';
import {createTTRoverDocument,createTTRoverPart,ttRoverPartPrograms,ttRoverPrintQuantities,ttRoverDimensions} from '../packages/editor/dist/tt-rover.js';

const root=new URL('../',import.meta.url),destination=new URL('examples/scout-tt-rover/',root);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const docBytes=doc=>Buffer.from(JSON.stringify(validateDocument(doc))+'\n');
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];

export async function generateTTRover(){
 setLocale('en');
 const kernel=await createGeometryKernel({wasmBinary:await readFile(new URL('node_modules/manifold-3d/manifold.wasm',root))});
 const outputs=new Map(),parts=[];
 const assembly=createTTRoverDocument();
 outputs.set('scout-tt-rover.bcad',docBytes(assembly));
 outputs.set('scout-tt-print-layout.bcad',docBytes(createTTRoverDocument('robot-tt-rover-print')));
 outputs.set('scout-tt-fit-gauge.bcad',docBytes(createTTRoverPart('fit')));
 for(const part of Object.keys(ttRoverPartPrograms)){
  const doc=createTTRoverPart(part),geometry=kernel.evaluate(doc);
  if(geometry.bodies.length!==1||geometry.bodies[0].bounds.min[2]<-1e-5)throw new Error(part+': invalid print placement');
  const bytes=Buffer.from(exportSTL(geometry.bodies));
  const screen=await checkModelLibrarySTL(bytes,{toMillimetresZUp:identity,checkedOn:'2026-11-15',maxExtentMm:180});
  if(Object.values(screen.checks).some(x=>x!=='pass'))throw new Error(part+': STL screen failed '+JSON.stringify(screen));
  outputs.set('stl/'+part+'.stl',bytes);
  outputs.set('source/'+part+'.cadcode',Buffer.from(ttRoverPartPrograms[part].source));
  parts.push({id:part,quantity:ttRoverPrintQuantities[part]??1,purpose:part==='fit'?'calibration':'robot',material:'PLA',licence:'BSD-3-Clause',source:'source/'+part+'.cadcode',mesh:'stl/'+part+'.stl',printOrientation:part==='skid'?'Flat mounting flange down (rotation already baked into STL)':'Flat face down, Z up',boundsMm:screen.boundsMm,volumeMm3:screen.signedVolumeMm3,triangles:screen.triangles,meshChecks:screen.checks});
 }
 outputs.set('LICENSE.txt',await readFile(new URL('LICENSE',root)));
 outputs.set('ADAFRUIT-MIT-LICENSE.txt',await readFile(new URL('library/sources/adafruit-motors/LICENSE',root)));
 outputs.set('BUILD-GUIDE.md',await readFile(new URL('docs/PRINTABLE-TT-ROVER.md',root)));
 outputs.set('NOTICE.md',Buffer.from('# Scout TT rover notices\n\nThe original chassis, cradles, wheels, deck, standoffs, skid and fit gauge are BSD-3-Clause (LICENSE.txt). The assembled BCAD file embeds Adafruit 3777 TT motor mesh derivatives and exact retained source/provenance metadata: Copyright (c) 2016 Adafruit Industries, MIT (ADAFRUIT-MIT-LICENSE.txt). The PCB and battery envelopes are original approximate clearance geometry, not vendor CAD. Purchased motors, electronics, batteries, fasteners and rubber tires are not PLA print parts.\n\nPrint only the STL files under stl/, using the quantities and orientations in manifest.json. The wide print-layout document is an inventory layout, not a single printer bed. Physical fit and drive behavior require a prototype; these files record geometry checks, not a completed hardware build.\n'));
 const files=[...outputs].map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)}));
 const manifest={format:'brickwright-printable-robot-kit',version:1,id:'scout-tt-rover',units:'mm',sourceUpAxis:'Z',dimensions:ttRoverDimensions,parts,manufacturedPartCount:Object.values(ttRoverPrintQuantities).reduce((a,b)=>a+b,0),control:{scope:'ideal-cad-simulation',left:'A',right:'B',positiveAxis:[0,1,0],positiveTravel:'+X',fixBase:false,physicalTransport:false,physicalEncoders:false},validation:{stlScreening:'All seven unique original parts pass parse, closed-positive-volume, size and triangle checks.',hardwareBuilt:false},files,reproduce:'npm run robot:generate; npm run robot:check'};
 outputs.set('manifest.json',json(manifest));
 const zipFiles=Object.fromEntries([...outputs].map(([path,bytes])=>[path,[bytes,{mtime:new Date('2026-11-15T00:00:00Z')}]]));
 outputs.set('scout-tt-rover-kit.zip',Buffer.from(zipSync(zipFiles,{level:9})));
 return {outputs,manifest};
}

export async function checkOrWriteTTRover(write=false){
 const {outputs,manifest}=await generateTTRover(),errors=[];
 for(const [path,expected]of outputs){
  const target=new URL(path,destination);
  if(write){await mkdir(new URL('.',target),{recursive:true});await writeFile(target,expected);}
  else{try{if(!(await readFile(target)).equals(expected))errors.push(path+': differs');}catch(error){if(error.code==='ENOENT')errors.push(path+': missing');else throw error;}}
 }
 if(errors.length)throw new Error(errors.join('\n'));
 return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const flags=process.argv.slice(2);if(flags.length!==1||!['--write','--check'].includes(flags[0]))throw new Error('Usage: node scripts/generate-tt-rover.mjs --write|--check');
 const m=await checkOrWriteTTRover(flags[0]==='--write');
 console.log(`Scout TT rover: ${m.manufacturedPartCount} PLA pieces, ${m.parts.length} unique screened STLs including the fit gauge; ${flags[0]==='--write'?'written':'reproduced exactly'}.`);
}
