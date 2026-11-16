// SPDX-License-Identifier: BSD-3-Clause
// Deterministic CPU projection of the evaluated manufacturing/vendor geometry.
// This is a model preview, not a browser screenshot or a physical-build photo.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {setLocale} from '../packages/core/dist/index.js';
import {createGeometryKernel} from '../packages/geometry/dist/index.js';
import {createTTRoverDocument,createTTRoverPart,ttRoverPrintQuantities} from '../packages/editor/dist/tt-rover.js';

setLocale('en');
const kernel=await createGeometryKernel({wasmBinary:await readFile('node_modules/manifold-3d/manifold.wasm')});
const assembly=createTTRoverDocument(),carrier=createTTRoverPart('carrier');
const eye=new THREE.Vector3(1.05,-1.5,1.2).normalize();
const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,0,1),eye).normalize();
const up=new THREE.Vector3().crossVectors(eye,right).normalize();
const light=new THREE.Vector3(-.4,-.7,1).normalize();

function projection(doc,area){
 const geometry=kernel.evaluate(doc),triangles=[],bounds={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};
 for(const body of geometry.bodies){
  const color=new THREE.Color(doc.nodes[body.id]?.color??'#91a7ae');
  for(let i=0;i<body.indices.length;i+=3){
   const vertices=[0,1,2].map(j=>new THREE.Vector3().fromArray(body.positions,body.indices[i+j]*3));
   const normal=new THREE.Vector3().crossVectors(vertices[1].clone().sub(vertices[0]),vertices[2].clone().sub(vertices[0])).normalize();
   if(normal.dot(eye)<=0)continue;
   const points=vertices.map(v=>[v.dot(right),v.dot(up),v.dot(eye)]);
   for(const [x,y]of points){bounds.minX=Math.min(bounds.minX,x);bounds.maxX=Math.max(bounds.maxX,x);bounds.minY=Math.min(bounds.minY,y);bounds.maxY=Math.max(bounds.maxY,y);}
   triangles.push({points,color:color.clone().multiplyScalar(.55+.45*Math.max(0,normal.dot(light))).getHexString()});
  }
 }
 const scale=Math.min(area.width/(bounds.maxX-bounds.minX),area.height/(bounds.maxY-bounds.minY));
 const cx=(bounds.minX+bounds.maxX)/2,cy=(bounds.minY+bounds.maxY)/2;
 // Per-vertex depth resolves occlusion; average triangle sorting does not.
 return triangles.map(t=>({points:t.points.map(([x,y,z])=>[area.x+area.width/2+(x-cx)*scale,area.y+area.height/2-(y-cy)*scale,z]),color:t.color}));
}

const count=Object.values(ttRoverPrintQuantities).reduce((a,b)=>a+b,0);
const sourceHash=createHash('sha256').update(JSON.stringify(assembly)).digest('hex');
const text=(x,y,size,content,color='#16383c',weight=400)=>({x,y,size,content,color,weight});
process.stdout.write(JSON.stringify({width:1600,height:940,background:'#edf3f2',sourceHash,
 panels:[{x:38,y:210,width:1006,height:570},{x:1064,y:210,width:498,height:570}],
 triangles:[...projection(assembly,{x:74,y:292,width:934,height:405}),...projection(carrier,{x:1100,y:302,width:425,height:287})],
 texts:[
  text(60,63,19,'BRICKWRIGHT CAD  /  SCOUT TT','#427c77',700),
  text(58,126,48,'A robot you can print and assemble',undefined,700),
  text(60,170,21,'Adafruit TT motors · original PLA mechanics · shared A/B simulation controls','#567076'),
  text(68,256,22,'Complete assembly',undefined,700),
  text(68,747,19,`${count} PLA pieces · 2 TT motors · 4 purchased O-ring tires`,'#567076'),
  text(1092,256,22,'New bolted electronics carrier',undefined,700),
  text(1092,635,20,'Feather RP2040 + DRV8833',undefined,700),
  text(1092,675,18,'Six insulating bosses / 6 mm clearance','#567076'),
  text(1092,710,18,'Through-bolts and accessible deck mounts','#567076'),
  text(1092,747,18,'61 × 56 × 9 mm · flat printing orientation','#567076'),
  text(60,833,18,'Actual evaluated CAD geometry. Blue board blocks and the battery are clearance envelopes.','#567076'),
  text(60,869,17,'Original PLA designs: BSD-3-Clause. Adafruit motor derivatives: MIT. Physical fit and operation require a prototype.','#567076')
 ]}));
