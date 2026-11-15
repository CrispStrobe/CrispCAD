// SPDX-License-Identifier: BSD-3-Clause
// Mesh derivatives: Copyright (c) 2016 Adafruit Industries, MIT (see NOTICE.md).
import * as THREE from 'three';
import {createDocument,identityTransform,defaultPartPhysics,t} from '@brickwright/cad-core';
import type {CadDocument,Vec3,ModelLibraryAsset} from '@brickwright/cad-core';
import yellow from './motor-assets/tt-gearmotor.json' with {type:'json'};
import dc from './motor-assets/dc-toy-motor.json' with {type:'json'};
import dcCollision from './motor-assets/dc-toy-motor-collision.json' with {type:'json'};
import yellowCollision from './motor-assets/tt-gearmotor-collision.json' with {type:'json'};
const colliders:Record<string,typeof dcCollision>={'dc-toy-motor':dcCollision,'tt-gearmotor':yellowCollision};
const models:Record<string,typeof yellow>={'tt-gearmotor':yellow,'dc-toy-motor':dc};
export const motorCatalog=[
 {id:'dc-toy-motor',name:'DC toy motor',category:'Motors',description:'Adafruit 711 DC motor with an articulated output shaft. Ideal hinge drive; electrical performance is not modelled.',keywords:'dc motor 130 can brushed electric 711',color:'#aab4bd'},
 {id:'tt-gearmotor',name:'Yellow TT gearmotor',category:'Motors',description:'Adafruit 3777 yellow TT gearmotor with its separate double-ended output shaft. Ideal hinge drive.',keywords:'yellow tt dc motor gearbox robot 3777',color:'#f4cc28'},
];
export const isMotorModel=(id:string)=>Object.hasOwn(models,id);
export function motorGeometry(id:string){const model=models[id],positions:number[]=[],indices:number[]=[];for(const part of model.parts){const offset=positions.length/3;positions.push(...part.positions);indices.push(...part.indices.map(i=>i+offset));}const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;}
export function createMotorDocument(id:string):CadDocument{
 const model=models[id],preset=motorCatalog.find(p=>p.id===id)!;
 const document=createDocument();document.version=5;document.title=t(preset.name);
 const record='adafruit-'+id;
 const source=model.source;
 const asset:ModelLibraryAsset={id:record,version:'1',title:preset.name,author:'Adafruit Industries',sourceUrl:source.url,
  sourceRevision:{repositoryUrl:'https://github.com/adafruit/Adafruit_CAD_Parts',commit:'9f2a89f3d5c3491886d58cb7fe83385417563cf4'},
  licence:{spdx:'MIT',scope:'asset',attribution:'Copyright (c) 2016 Adafruit Industries',evidenceUrl:'https://github.com/adafruit/Adafruit_CAD_Parts/blob/9f2a89f3d5c3491886d58cb7fe83385417563cf4/LICENSE',capturedOn:'2026-11-15',review:'accepted',reviewer:'Brickwright contributors'},
  original:{url:source.url,sha256:source.sha256,bytes:source.bytes,format:'step'},derivatives:[],modificationNotes:model.modificationNotes,
  conversion:{sourceUnits:'mm',unitAssumption:'STEP SI_UNIT(.MILLI.,.METRE.); rigid rotation and floor alignment are baked into the mesh derivative.',sourceUpAxis:'Z',toMillimetresZUp:model.toMillimetresZUp}};
 // Exact transform recipe and derived meshes are retained in the source tree; the project
 // records the original STEP plus explicit modification notes rather than claiming unchanged import.
 document.provenance={version:1,records:[{id:record,asset,selectedFile:asset.original,modificationNotes:model.modificationNotes}]};
 const caseParts:string[]=[];
 for(const [index,part]of model.parts.entries()){
  const key=index===model.shaft?'shaft':`case-${index}`;
  document.nodes[key]={id:key,name:index===model.shaft?t('Output shaft'):t('Motor casing'),kind:'mesh',positions:[...part.positions],indices:[...part.indices],color:index===model.shaft?'#e1e6eb':preset.color,transform:identityTransform(),provenance:[record],physics:{...defaultPartPhysics(),sourcePreset:id}};
  if(index!==model.shaft)caseParts.push(key);
 }
 document.nodes.casing={id:'casing',name:t('Motor casing'),kind:'boolean',operation:'union',inputs:caseParts,color:preset.color,transform:identityTransform(),provenance:[record],physics:{...defaultPartPhysics(),sourcePreset:id,collisionAssembly:structuredClone(colliders[id])}};
 document.roots=['casing','shaft'];
 document.joints=[{id:'motor-output',kind:'hinge',bodyA:'casing',bodyB:'shaft',anchorA:[...model.anchor] as Vec3,anchorB:[...model.anchor] as Vec3,axisA:[...model.axis] as Vec3,axisB:[...model.axis] as Vec3,control:{port:'A'}}];
 return document;
}
