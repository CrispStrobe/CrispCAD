import {roverCatalog,isTTRover,createTTRoverDocument,ttRoverPreview} from './tt-rover.js';
import {steerableRoverCatalog,isSteerableRover,createSteerableRoverDocument,steerableRoverPreview} from './steerable-rover.js';
import {kestrelArmCatalog,isKestrelArm,createKestrelArmDocument,kestrelArmPreview} from './kestrel-arm.js';
import {atlasForkliftCatalog,isAtlasForklift,createAtlasForkliftDocument,atlasForkliftPreview} from './atlas-forklift.js';
import {simulationExampleCatalog,isSimulationExample,createSimulationExample,simulationExampleGeometry} from './simulation-examples.js';
import {motorCatalog,isMotorModel,motorGeometry,createMotorDocument} from './motor-models.js';
import {allocateMotorPort} from '@brickwright/cad-core';
import {defaultGenerator,screwVariant,checkGenerator,basicGeneratorPresets,curvedGeneratorPresets} from '@brickwright/cad-core';
import { t } from '@brickwright/cad-core';
// SPDX-License-Identifier: BSD-3-Clause
// Independently authored presets. Geometry constructors are from Three.js (MIT).
// Simple presets and retained sketch templates share the versioned CAD document.
import * as THREE from 'three';
import {curvedShapeGeometry} from './curved-shape-geometry.js';
import {basicShapeGeometry} from './basic-shape-geometry.js';
import { identityTransform, createCadSession, defaultPartPhysics,createDesignTemplate } from '@brickwright/cad-core';
import type { Primitive, SolidNode,GeneratorRecipe } from '@brickwright/cad-core';
import { advancedCatalog, constructionDocument, constructionPreview } from './advanced-shapes.js';
type MeshShape = Extract<SolidNode, { kind: 'mesh' }>;
export interface ShapePreset { additional?:boolean; id: string; name: string; category: string; description: string; keywords: string; color: string }
const originalCatalog = [
  ['cube','Cube','Basic solids','A cube with one linked edge length.','cube equal edges square','#f1b84b'],
  ['box','Box','Basic solids','A rectangular solid with editable width, depth and height.','cube block rectangular','#e9a743'],
  ['rounded-box','Rounded box','Basic solids','A box with rounded corners.','filleted soft rectangle','#ef8763'],
  ['cylinder','Cylinder','Basic solids','A circular solid with editable radius and height.','round disk rod','#db933b'],
  ['capsule','Capsule','Basic solids','A flat-based rounded slot extruded into a solid.','pill rounded slot guard','#dfb75d'],
  ['ellipse','Elliptic cylinder','Basic solids','An extruded oval.','ellipse oval','#e1bd45'],
  ['polygon','Polygonal prism','Basic solids','A prism with editable side count and circumdiameter.','polygon hex nut hexagon','#8c89db'],
  ['wedge','Wedge','Basic solids','A triangular ramp.','triangle slope ramp','#78b48e'],
  ['sphere','Sphere','Basic solids','A ball with editable radius.','ball globe','#62b7cf'],
  ['cone','Cone','Basic solids','A circular base tapering to a point.','point taper','#aa86c8'],
  ['curved-cone','Curved cone','Basic solids','A pointed solid with a curved taper.','bell curved taper','#ba8dc2'],
  ['pyramid','Pyramid','Basic solids','A square base tapering to a point.','square point','#e2c35a'],
  ['round-roof','Round roof','Basic solids','A semicircular profile extruded into a roof.','arch barrel half cylinder','#7cb8c1'],
  ['hemisphere','Hemisphere','Basic solids','Half a sphere with a flat base.','half sphere dome','#bf83b4'],
  ['paraboloid','Paraboloid','Basic solids','A rounded point above a circular base.','parabolic dome curved','#9ec66f'],
  ['torus','Torus','Basic solids','A closed ring with a circular cross section.','donut doughnut ring','#62b2d0'],
  ['tube','Tube','Hollow & tapered','A straight tube with an open bore.','pipe hollow sleeve','#dfa25b'],
  ['frustum','Tapered cylinder','Hollow & tapered','A truncated cone with different end radii.','frustum transition reducer loft','#cd9571'],
  ['vase','Vase','Hollow & tapered','An open vessel with a thick wall and solid bottom.','vessel container cup hollow','#71b6ab'],
  ['washer','Washer','Hollow & tapered','A flat ring with a through hole.','ring spacer hole','#b0b6c0'],
].concat(advancedCatalog.map(row => [...row])).map(([id,name,category,description,keywords,color]) => ({id,name,category,description,keywords,color}));

const essentials:Record<string,string[]>={
 'Start a part':['l-bracket','mounting-plate','spacer'],
 'Build solids':['cube','box','cylinder','rounded-box','capsule','sphere','wedge','cone','polygon'],
 'Holes & hollow parts':['tube','washer','counterbore','countersink','port','teardrop'],
 'Supports & connections':['rib','boss','screw','hex-head-screw','socket-head-screw','countersunk-screw','pan-head-screw','set-screw','wood-screw','nut','hinge','dovetail','snap-fit'],
 'Motion parts':['gear','spring'],
 'Labels & outlines':['text','name-tag','star','heart'],
};
const templates:ShapePreset[]=[
 {id:'l-bracket',name:'L bracket',category:'',description:'A dimensioned angle bracket. Edit width, depth, height and wall thickness in Parameters.',keywords:'support angle wall mount parametric',color:'#e9a743'},
 {id:'mounting-plate',name:'Mounting plate',category:'',description:'A dimensioned plate with two bores. Edit the plate and hole dimensions in Parameters.',keywords:'mount base holes flange parametric',color:'#74b7cb'},
 {id:'spacer',name:'Spacer',category:'',description:'A dimensioned ring with an editable outer radius, bore radius and length.',keywords:'bushing sleeve standoff bearing parametric',color:'#abc1cd'},
];
const screwNames=[['hex-head-screw','Hex-head screw'],['socket-head-screw','Socket-head screw'],['countersunk-screw','Countersunk screw'],['pan-head-screw','Pan-head screw'],['set-screw','Set screw'],['wood-screw','Wood screw']];
const entries=[...templates,...screwNames.map(([id,name])=>({id,name,category:'',description:'A screw with editable head, drive and V-thread dimensions.',keywords:'screw bolt thread fastener hex socket countersunk pan',color:'#b0b7c2'})),...originalCatalog];
export const shapeCatalog:readonly ShapePreset[]=Object.freeze([
 ...roverCatalog,...steerableRoverCatalog,...kestrelArmCatalog,...atlasForkliftCatalog,...motorCatalog,...simulationExampleCatalog,
 ...Object.entries(essentials).flatMap(([category,ids])=>ids.map(id=>Object.freeze({...entries.find(p=>p.id===id)!,category,additional:false}))),
 ...entries.filter(p=>!Object.values(essentials).flat().includes(p.id)).map(p=>Object.freeze({...p,category:'Additional shapes',additional:true})),
]);

/** Caller owns and disposes the returned geometry. All geometry is Z-up. */
export function presetGeometry(id: string, preview = false, recipe?:GeneratorRecipe): THREE.BufferGeometry {
  if(isTTRover(id))return ttRoverPreview(id);
 if(isSteerableRover(id))return steerableRoverPreview(id);
 if(isKestrelArm(id))return kestrelArmPreview(id);
 if(isAtlasForklift(id))return atlasForkliftPreview(id);
  if(isSimulationExample(id))return simulationExampleGeometry(id);
  if(isMotorModel(id))return motorGeometry(id);
  if((basicGeneratorPresets as readonly string[]).includes(id)){const retained=checkGenerator(recipe??defaultGenerator(id)!);if(retained.preset!==id)throw new Error(t('Invalid shape generator'));const shown=structuredClone(retained);if(preview){for(const key of ['segments','tubeSegments','detail'])if(shown.values[key]!==undefined)shown.values[key]=Math.min(shown.values[key],key==='detail'?2:key==='tubeSegments'?10:20);}return basicShapeGeometry(shown);}
  if((curvedGeneratorPresets as readonly string[]).includes(id)&&!advancedCatalog.some(p=>p[0]===id)){const retained=checkGenerator(recipe??defaultGenerator(id)!);if(retained.preset!==id)throw new Error(t('Invalid shape generator'));const shown=structuredClone(retained);if(preview){shown.values.segments=Math.min(20,shown.values.segments);shown.values.profileSegments=Math.min(16,shown.values.profileSegments);}return curvedShapeGeometry(shown);}
  const variant=screwVariant(id);if(variant)return constructionPreview('screw',variant);
  const n = preview ? 20 : 64;
  switch (id) {
    case 'cube': return new THREE.BoxGeometry(30,30,30);
    case 'box': return new THREE.BoxGeometry(30,30,20);
    case 'cylinder': return new THREE.CylinderGeometry(10,10,30,n).rotateX(Math.PI/2);
    case 'sphere': return new THREE.SphereGeometry(15,n,preview ? 12 : 32);
    default: return constructionPreview(id,recipe);
  }
}
export function createPresetShape(id: string, recipe?:GeneratorRecipe): { shape: Primitive | MeshShape; height: number } {
  if (id==='cube')return {shape:{kind:'box',size:[30,30,30]},height:30};
  if (id==='box') return {shape:{kind:'box',size:[30,30,20]},height:20};
  if (id==='cylinder') return {shape:{kind:'cylinder',radius:10,height:30,segments:64},height:30};
  if (id==='sphere') return {shape:{kind:'sphere',radius:15,segments:48},height:30};
  const geometry = presetGeometry(id,false,recipe);
  try {
    geometry.computeBoundingBox(); const bounds = geometry.boundingBox!; const height = bounds.max.z-bounds.min.z; geometry.translate(...bounds.getCenter(new THREE.Vector3()).negate().toArray() as [number,number,number]);
    return {height,shape:{...(geometry.userData.collisionHint?{physics:{...defaultPartPhysics(),sourcePreset:id,collisionHint:geometry.userData.collisionHint}}:{}),kind:'mesh',id:'preset',name:id,color:'#ffffff',transform:identityTransform(),positions:Array.from(geometry.getAttribute('position').array),indices:geometry.index ? Array.from(geometry.index.array) : Array.from({length:geometry.getAttribute('position').count},(_,i)=>i)}};
  } finally { geometry.dispose(); }
}
const previews = new Map<string,string>();
export function createPresetDocument(id: string, text = 'BRICKWRIGHT', options: {svg?:string;recipe?:GeneratorRecipe;font?:GeneratorRecipe['font']} = {}) {
  if(isTTRover(id))return createTTRoverDocument(id);
 if(isSteerableRover(id))return createSteerableRoverDocument(id);
 if(isKestrelArm(id))return createKestrelArmDocument(id);
 if(isAtlasForklift(id))return createAtlasForkliftDocument(id);
  const preset = shapeCatalog.find(p => p.id === id); if (!preset) throw new Error(t('Unknown shape'));
  if(isSimulationExample(id))return createSimulationExample(id);
  if(isMotorModel(id))return createMotorDocument(id);
  const variant=screwVariant(id);if(variant)return constructionDocument('screw',t(preset.name),preset.color,text,options.svg,options.recipe??variant);
  if(['l-bracket','mounting-plate','spacer'].includes(id)){const doc=structuredClone(createDesignTemplate(id as import('@brickwright/cad-core').DesignTemplate));doc.title=t(doc.title);for(const node of Object.values(doc.nodes))node.name=t(node.name);for(const sketch of Object.values(doc.sketches??{}))sketch.name=t(sketch.name);return doc;}
  if (advancedCatalog.some(p => p[0] === id)){let recipe=options.recipe;if(!recipe&&['text','name-tag'].includes(id)){recipe=defaultGenerator(id)!;recipe={...recipe,text,font:options.font??'sans'};}const document=constructionDocument(id, t(preset.name), preset.color, text, options.svg,recipe);for(const joint of document.joints??[])if(joint.kind==='hinge'&&!joint.control)joint.control={port:allocateMotorPort(document.joints!)};return document;}
  const session = createCadSession(); const retained=([...basicGeneratorPresets,...curvedGeneratorPresets] as readonly string[]).includes(id)?checkGenerator(options.recipe??defaultGenerator(id)!):undefined;const base=createPresetShape(id,retained).shape;if(id==='cube'){const recipe=checkGenerator(options.recipe??defaultGenerator('cube')!);if(recipe.preset!=='cube')throw new Error(t('Invalid shape generator'));const edge=recipe.values.edge;if(base.kind==='box')base.size=[edge,edge,edge];}session.add(base, { name: t(preset.name), color: preset.color }); const doc = structuredClone(session.state.document); const node=doc.nodes[doc.roots[0]];node.physics = {...defaultPartPhysics(),...node.physics,sourcePreset:id};if(retained){doc.version=2;node.generator=structuredClone(retained);}if(id==='cube'){doc.version=2;node.generator=structuredClone(options.recipe??defaultGenerator('cube')!);}
  session.dispose(); return doc;
}
/** Static SVG thumbnails derived from our actual geometry, with no GPU contexts. */
export function presetPreview(preset: ShapePreset): string {
  const cached = previews.get(preset.id); if (cached) return cached;
  if(['l-bracket','mounting-plate','spacer'].includes(preset.id))return 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><path d="M15 14h14v38h37v14H15z" fill="'+preset.color+'"/></svg>');
  const geometry = presetGeometry(preset.id,true);
  try {
    geometry.center(); geometry.computeBoundingSphere(); const factor=30/geometry.boundingSphere!.radius;
    const position=geometry.getAttribute('position'), index=geometry.index; const eye=new THREE.Vector3(1,-1.5,1.15).normalize(), right=new THREE.Vector3().crossVectors(eye,new THREE.Vector3(0,0,1)).normalize().negate(), up=new THREE.Vector3().crossVectors(eye,right).normalize();
    const light=new THREE.Vector3(-.4,-.6,1).normalize(), base=new THREE.Color(preset.color); const triangles:{depth:number;path:string}[]=[];
    const total=index ? index.count : position.count;
    for(let i=0;i<total;i+=3) {
      const vertices=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(position,index ? index.getX(i+j) : i+j));
      const normal=new THREE.Vector3().crossVectors(vertices[1].clone().sub(vertices[0]),vertices[2].clone().sub(vertices[0])).normalize(); if(normal.dot(eye)<=0) continue;
      const color=base.clone().multiplyScalar(.55+.45*Math.max(0,normal.dot(light))).getStyle();
      const points=vertices.map(v=>`${(40+v.dot(right)*factor).toFixed(1)},${(40-v.dot(up)*factor).toFixed(1)}`);
      triangles.push({depth:vertices.reduce((s,v)=>s+v.dot(eye),0)/3,path:`<path d="M${points.join('L')}Z" fill="${color}" stroke="${color}" stroke-width=".35"/>`});
    }
    triangles.sort((a,b)=>a.depth-b.depth);
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">${triangles.map(t=>t.path).join('')}</svg>`;
    const url=`data:image/svg+xml,${encodeURIComponent(svg)}`; previews.set(preset.id,url); return url;
  } finally {geometry.dispose();}
}

/** CPU thumbnail of evaluated solids. No extra WebGL renderer per card. */
export function evaluatedPreview(bodies: readonly import('@brickwright/cad-geometry').BodyMesh[]): string {
 const box=new THREE.Box3();for(const body of bodies)box.union(new THREE.Box3(new THREE.Vector3(...body.bounds.min as [number,number,number]),new THREE.Vector3(...body.bounds.max as [number,number,number])));
 const center=box.getCenter(new THREE.Vector3()),scale=108/Math.max(1,box.getSize(new THREE.Vector3()).length()),eye=new THREE.Vector3(1,-1.5,1.15).normalize(),right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,0,1),eye).normalize(),up=new THREE.Vector3().crossVectors(eye,right).normalize(),light=new THREE.Vector3(-.4,-.6,1).normalize();
 const bitmap=document.createElement('canvas');bitmap.width=160;bitmap.height=160;const ctx=bitmap.getContext('2d')!;const triangles:{depth:number;points:number[][];color:string}[]=[];
 for(const body of bodies){const color=new THREE.Color(body.color);for(let i=0;i<body.indices.length;i+=3){const p=[0,1,2].map(j=>new THREE.Vector3().fromArray(body.positions,body.indices[i+j]*3).sub(center));const normal=new THREE.Vector3().crossVectors(p[1].clone().sub(p[0]),p[2].clone().sub(p[0])).normalize();if(normal.dot(eye)<=0)continue;triangles.push({depth:p.reduce((s,v)=>s+v.dot(eye),0)/3,points:p.map(v=>[80+v.dot(right)*scale,80-v.dot(up)*scale]),color:color.clone().multiplyScalar(.5+.5*Math.max(0,normal.dot(light))).getStyle()});}}
 triangles.sort((a,b)=>a.depth-b.depth);for(const triangle of triangles){ctx.beginPath();triangle.points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=ctx.strokeStyle=triangle.color;ctx.lineWidth=.55;ctx.fill();ctx.stroke();}return bitmap.toDataURL('image/png');
}
