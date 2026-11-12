// SPDX-License-Identifier: BSD-3-Clause
// Independently authored presets. Geometry constructors are from Three.js (MIT).
// Presets use existing .bcad primitives/meshes; no new document format is needed.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { identityTransform, createCadSession, defaultPartPhysics } from '@brickwright/cad-core';
import type { Primitive, SolidNode } from '@brickwright/cad-core';
import { advancedCatalog, constructionDocument, constructionPreview } from './advanced-shapes.js';
type MeshShape = Extract<SolidNode, { kind: 'mesh' }>;
export interface ShapePreset { id: string; name: string; category: string; description: string; keywords: string; color: string }
export const shapeCatalog: readonly ShapePreset[] = [
  ['box','Box','Basic solids','A rectangular solid with editable width, depth and height.','cube block rectangular','#e9a743'],
  ['rounded-box','Rounded box','Basic solids','A box with rounded corners.','filleted soft rectangle','#ef8763'],
  ['cylinder','Cylinder','Basic solids','A circular solid with editable radius and height.','round disk rod','#db933b'],
  ['capsule','Capsule','Basic solids','A flat-based rounded slot extruded into a solid.','pill rounded slot guard','#dfb75d'],
  ['ellipse','Elliptic cylinder','Basic solids','An extruded oval.','ellipse oval','#e1bd45'],
  ['polygon','Hexagonal prism','Basic solids','A six-sided prism.','polygon hex nut hexagon','#8c89db'],
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
].concat(advancedCatalog.map(row => [...row])).map(([id,name,category,description,keywords,color]) => Object.freeze({id,name,category,description,keywords,color}));

function profile(points: [number, number][], detail: number) { return new THREE.LatheGeometry(points.map(p => new THREE.Vector2(...p)), detail).rotateX(Math.PI / 2); }
function tube(outer: number, inner: number, height: number, detail: number) {
  return profile([[inner,0],[outer,0],[outer,height],[inner,height],[inner,0]], detail);
}
/** Caller owns and disposes the returned geometry. All geometry is Z-up. */
export function presetGeometry(id: string, preview = false): THREE.BufferGeometry {
  const n = preview ? 20 : 64;
  switch (id) {
    case 'box': return new THREE.BoxGeometry(30,30,20);
    case 'rounded-box': return new RoundedBoxGeometry(30,24,20, preview ? 2 : 4, 3);
    case 'cylinder': return new THREE.CylinderGeometry(10,10,30,n).rotateX(Math.PI/2);
    case 'capsule': { const shape=new THREE.Shape();shape.moveTo(-10,-10);shape.lineTo(10,-10);shape.absarc(10,0,10,-Math.PI/2,Math.PI/2,false);shape.lineTo(-10,10);shape.absarc(-10,0,10,Math.PI/2,3*Math.PI/2,false);shape.closePath();return new THREE.ExtrudeGeometry(shape,{depth:20,bevelEnabled:false,curveSegments:preview?8:24}); }
    case 'ellipse': return new THREE.CylinderGeometry(12,12,20,n).rotateX(Math.PI/2).scale(1.5,0.8,1);
    case 'polygon': return new THREE.CylinderGeometry(14,14,25,6).rotateX(Math.PI/2);
    case 'wedge': return new ConvexGeometry([[-15,-15,0],[15,-15,0],[-15,15,0],[15,15,0],[-15,15,25],[15,15,25]].map(p => new THREE.Vector3(...p as [number,number,number])));
    case 'sphere': return new THREE.SphereGeometry(15,n,preview ? 12 : 32);
    case 'cone': return new THREE.CylinderGeometry(0,13,30,n).rotateX(Math.PI/2);
    case 'curved-cone': return profile([[0,0], ...Array.from({length:17}, (_,i): [number,number] => [13*(1-i/16)**2,30*i/16])],n);
    case 'pyramid': return new THREE.CylinderGeometry(0,16,28,4).rotateX(Math.PI/2).rotateZ(Math.PI/4);
    case 'round-roof': {
      const shape = new THREE.Shape(); shape.moveTo(-15,0); shape.absarc(0,0,15,Math.PI,0,true); shape.lineTo(-15,0);
      return new THREE.ExtrudeGeometry(shape,{depth:30,bevelEnabled:false,curveSegments:preview ? 10 : 32}).rotateX(Math.PI/2);
    }
    case 'hemisphere': return profile([[0,0], ...Array.from({length:17}, (_,i): [number,number] => i===16 ? [0,15] : [15*Math.cos(i*Math.PI/32),15*Math.sin(i*Math.PI/32)])],n);
    case 'paraboloid': return profile([[0,0], ...Array.from({length:25}, (_,i): [number,number] => [13*Math.sqrt(1-i/24),26*i/24])],n);
    case 'torus': return new THREE.TorusGeometry(15,5,preview ? 10 : 24,n);
    case 'tube': return tube(15,10,25,n);
    case 'frustum': return new THREE.CylinderGeometry(7,15,25,n).rotateX(Math.PI/2);
    case 'vase': return profile([[0,0],[10,0],[13,5],[15,12],[14,20],[9,27],[8,32],[6,32],[7,27],[12,20],[13,12],[11,5],[8,2],[0,2]],n);
    case 'washer': return tube(15,7,4,n);
    default: return constructionPreview(id);
  }
}
export function createPresetShape(id: string): { shape: Primitive | MeshShape; height: number } {
  if (id==='box') return {shape:{kind:'box',size:[30,30,20]},height:20};
  if (id==='cylinder') return {shape:{kind:'cylinder',radius:10,height:30,segments:64},height:30};
  if (id==='sphere') return {shape:{kind:'sphere',radius:15,segments:48},height:30};
  const geometry = presetGeometry(id);
  try {
    geometry.computeBoundingBox(); const bounds = geometry.boundingBox!; const height = bounds.max.z-bounds.min.z; geometry.translate(...bounds.getCenter(new THREE.Vector3()).negate().toArray() as [number,number,number]);
    return {height,shape:{kind:'mesh',id:'preset',name:id,color:'#ffffff',transform:identityTransform(),positions:Array.from(geometry.getAttribute('position').array),indices:geometry.index ? Array.from(geometry.index.array) : Array.from({length:geometry.getAttribute('position').count},(_,i)=>i)}};
  } finally { geometry.dispose(); }
}
const previews = new Map<string,string>();
export function createPresetDocument(id: string, text = 'BRICKWRIGHT', options: {svg?:string} = {}) {
  const preset = shapeCatalog.find(p => p.id === id); if (!preset) throw new Error('Unknown shape');
  if (advancedCatalog.some(p => p[0] === id)) return constructionDocument(id, preset.name, preset.color, text, options.svg);
  const session = createCadSession(); session.add(createPresetShape(id).shape, { name: preset.name, color: preset.color }); const doc = structuredClone(session.state.document); const node=doc.nodes[doc.roots[0]];node.physics = {...defaultPartPhysics(),sourcePreset:id};
  if(id==='torus')node.physics.collisionHint={kind:'tube-grid',segments:64,sides:24,layout:'columns',closed:true};
  const profileLengths:Record<string,number>={'curved-cone':18,hemisphere:18,paraboloid:26,tube:5,vase:14,washer:5};
  if(profileLengths[id])node.physics.collisionHint={kind:'radial-profile',segments:64,sides:profileLengths[id]-1,layout:'rows',closed:true}; session.dispose(); return doc;
}
/** Static SVG thumbnails derived from our actual geometry, with no GPU contexts. */
export function presetPreview(preset: ShapePreset): string {
  const cached = previews.get(preset.id); if (cached) return cached;
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
