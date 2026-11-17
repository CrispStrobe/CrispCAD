// SPDX-License-Identifier: BSD-3-Clause
// Generate pre-qualified low-hull-count convex collision candidates for Apex SCARA arm parts.
import {identityTransform} from '../packages/core/dist/index.js';
import {apexScaraPartPrograms,createApexScaraPart} from '../packages/editor/dist/apex-scara.js';
import {compactSource,generateRobotCollisionAssets} from './lib/robot-collision-candidates.mjs';

const mode=process.argv[2];
if(process.argv.length!==3||(mode!=='--write'&&mode!=='--check')){
 throw Error('Usage: node scripts/generate-apex-scara-collisions.mjs --write|--check');
}

function evalPartExpr(part,partDocument,kernel,expression,compact=true){
 const doc=partDocument(part);
 doc.nodes[part].transform=identityTransform();
 delete doc.nodes[part].physics.collisionAssembly;
 const src=apexScaraPartPrograms[part].source.replace(/return[^]*$/,'return '+expression+';');
 doc.nodes[part].program.source=compact?compactSource(src):src;
 return kernel.evaluate(doc).bodies[0];
}

function pedestalCandidates({kernel,extrudedCandidates,simplifiedCandidates,partDocument}){
 return [
  ...extrudedCandidates(evalPartExpr('pedestal',partDocument,kernel,'subtract(union(base,featherBay),baseBores,featherBores,shoulderM2,wireSlot)'),0,5),
  ...extrudedCandidates(evalPartExpr('pedestal',partDocument,kernel,'subtract(featherBosses,featherBores)'),5,8),
  ...simplifiedCandidates(evalPartExpr('pedestal',partDocument,kernel,'subtract(column,colLighten)'),.08),
 ];
}

function armCandidates(part,zMinSocket,zMaxSocket,hasCs){
 return ({kernel,extrudedCandidates,simplifiedCandidates,partDocument})=>{
  const expr=part==='upperArm'
   ?'subtract(link,screwBore,elbowM2,truss)'
   :'subtract(link,screwBore,quillGuide,truss)';
  return simplifiedCandidates(evalPartExpr(part,partDocument,kernel,apexScaraPartPrograms[part].source.match(/return\s+([^;]+);/)[1]),.08);
 };
}

await generateRobotCollisionAssets({
 mode,
 format:'brickwright-apex-scara-collision-candidates',
 targetPath:'packages/editor/src/robot-assets/apex-scara-collisions.json',
 partPrograms:apexScaraPartPrograms,
 createPartDocument:createApexScaraPart,
 parts:['pedestal','upperArm','forearm','quill','targetDisk'],
 quantities:{pedestal:1,upperArm:1,forearm:1,quill:1,targetDisk:1},
 baseHulls:2*(490+55),
 customCandidates:{
  pedestal:pedestalCandidates,
  upperArm:({kernel,extrudedCandidates,partDocument})=>[
   ...extrudedCandidates(evalPartExpr('upperArm',partDocument,kernel,'subtract(link,splineSocket,screwBore,elbowM2,truss)'),0,3),
   ...extrudedCandidates(evalPartExpr('upperArm',partDocument,kernel,'subtract(link,screwBore,elbowM2,truss)'),3,5.5),
   ...extrudedCandidates(evalPartExpr('upperArm',partDocument,kernel,'subtract(link,screwBore,screwCs,elbowM2,truss)'),5.5,8),
  ],
  forearm:({kernel,extrudedCandidates,partDocument})=>[
   ...extrudedCandidates(evalPartExpr('forearm',partDocument,kernel,'subtract(link,splineSocket,screwBore,quillGuide,truss)'),0,3),
   ...extrudedCandidates(evalPartExpr('forearm',partDocument,kernel,'subtract(link,screwBore,quillGuide,truss)'),3,5.5),
   ...extrudedCandidates(evalPartExpr('forearm',partDocument,kernel,'subtract(link,screwBore,screwCs,quillGuide,truss)'),5.5,8),
  ],
  quill:({kernel,extrudedCandidates,partDocument})=>[
   ...extrudedCandidates(evalPartExpr('quill',partDocument,kernel,'shaft'),0,60),
   ...extrudedCandidates(evalPartExpr('quill',partDocument,kernel,'subtract(collar,m25Bore)'),60,64),
  ],
  targetDisk:({kernel,extrudedCandidates,partDocument})=>extrudedCandidates(evalPartExpr('targetDisk',partDocument,kernel,'move([0,0,7],cylinder(12,14,24))',false),0,14),
 },
});
