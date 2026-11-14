// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import {GeometryResourceLimitError} from './limits.js';
import {triangulatePolyhedron} from './polyhedron.js';
import {textProfileContours} from './font-profile.js';
import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel, CrossSection } from 'manifold-3d';
import { validateDocument, documentGeometryKey, evaluateExtrusion, FeatureEvaluationError, compileCode } from '@brickwright/cad-core';
import type { CadDocument, SolidNode, CodeShape,CodeProfile } from '@brickwright/cad-core';
import { collisionCSG } from './collision-csg.js';
import { partitionConvex } from './convex.js';
export interface BodyMesh { id: string; name: string; color: string; reference?: boolean; positions: Float32Array; indices: Uint32Array; volume: number; bounds: { min: number[]; max: number[] } }
export interface GeometryResult { sourceKey?: string; bodies: BodyMesh[]; volume: number; triangles: number }
export async function createGeometryKernel(options: { wasmURL?: string; wasmBinary?: Uint8Array } = {}) {
  // Upstream's declaration omits Emscripten's wasmBinary option and locateFile argument.
  const factory = Module as unknown as (options: { locateFile?: (name: string) => string; wasmBinary?: Uint8Array }) => Promise<ManifoldToplevel>;
  const module = await factory({ ...(options.wasmURL ? { locateFile: (name: string) => name.endsWith('.wasm') ? options.wasmURL! : name } : {}), ...(options.wasmBinary ? { wasmBinary: options.wasmBinary } : {}) });
  module.setup();
  // Preserve a verified producer's triangulation. Re-hulling Float32 output a
  // second time can create different coplanar faces at tiny helical interfaces.
  // External or mutated pieces still require canonical convex reconstruction.
  const convexRegistry=new WeakMap<object,{positions:Float64Array;indices:Uint32Array}>();
  const remember=<T extends {positions:Float64Array;indices:Uint32Array}>(piece:T):T=>{convexRegistry.set(piece,{positions:new Float64Array(piece.positions),indices:new Uint32Array(piece.indices)});return piece;};
  return { evaluate: (doc: CadDocument) => evaluateDocument(module, doc), partitionConvex: (mesh: Pick<BodyMesh,'positions'|'indices'>, maxPieces=2048) => partitionConvex(module,mesh.positions,mesh.indices,maxPieces).map(remember),
    isConvexPiece(piece:{positions:Float64Array;indices:Uint32Array}){const snapshot=convexRegistry.get(piece);return !!snapshot&&snapshot.positions.length===piece.positions.length&&snapshot.indices.length===piece.indices.length&&snapshot.positions.every((v,i)=>v===piece.positions[i])&&snapshot.indices.every((v,i)=>v===piece.indices[i]);},
    collisionCSG: collisionCSG(module,remember),
    hullPoints(points: readonly [number,number,number][]) { if(points.length<4||points.length>4096||points.some(p=>p.length!==3||p.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6)))throw new Error(t('Collision hull points exceed the finite geometry budget'));const hull=module.Manifold.hull(points);try{if(hull.isEmpty())throw new Error(t('Collision segment is degenerate'));const mesh=hull.getMesh();return remember({positions:new Float64Array(Array.from({length:mesh.numVert*3},(_,i)=>mesh.vertProperties[Math.floor(i/3)*mesh.numProp+i%3])),indices:new Uint32Array(mesh.triVerts)});}finally{hull.delete();} },
  };
}
export type GeometryKernel = Awaited<ReturnType<typeof createGeometryKernel>>;
function evaluateDocument(module: ManifoldToplevel, input: CadDocument): GeometryResult {
  const doc = validateDocument(input); const cache = new Map<string, Manifold>(); const owned = new Set<Manifold>();
  const keep = (m: Manifold) => { owned.add(m); return m; };
  const profiles=new Set<CrossSection>(),profileCache=new WeakMap<CodeProfile,CrossSection>();
  const keepProfile=(p:CrossSection)=>{profiles.add(p);return p;};
  const minkowskiProfile=(a:CrossSection,b:CrossSection):CrossSection=>{if(!a.numVert()||!b.numVert())return keepProfile(module.CrossSection.square([0,0]));const parts=(shape:CrossSection):[number,number][][]=>{const polygons=shape.toPolygons(),points=polygons.flat(),hull=keepProfile(module.CrossSection.hull(polygons));if(Math.abs(hull.area()-shape.area())<=Math.max(1e-9,Math.abs(shape.area())*1e-10))return [hull.toPolygons().flat()];return module.triangulate(polygons).map(triangle=>triangle.map(i=>points[i]));};const left=parts(a),right=parts(b),work=left.reduce((n,p)=>n+p.length,0)*right.reduce((n,p)=>n+p.length,0);if(left.length*right.length>10000||work>250000)throw new GeometryResourceLimitError(t('Planar Minkowski operation exceeds the pair budget'));const sums:CrossSection[]=[];for(const x of left)for(const y of right){const points:[number,number][]=x.flatMap(p=>y.map(q=>[p[0]+q[0],p[1]+q[1]] as [number,number]));sums.push(keepProfile(module.CrossSection.hull([points])));}return keepProfile(module.CrossSection.union(sums));};
  const buildProfile=(p:CodeProfile):CrossSection=>{
    const previous=profileCache.get(p);if(previous)return previous;let result:CrossSection;
    if(p.kind==='text')result=keepProfile(module.CrossSection.union(textProfileContours(p).map(contours=>keepProfile(new module.CrossSection(contours,'EvenOdd')))));
    else if(p.kind==='empty')result=keepProfile(module.CrossSection.square([0,0]));
    else if(p.kind==='polygon')result=keepProfile(new module.CrossSection(p.contours,'EvenOdd'));
    else if(p.kind==='rectangle')result=keepProfile(module.CrossSection.square(p.size,p.center));
    else if(p.kind==='circle')result=keepProfile(module.CrossSection.circle(p.radius,p.segments));
    else if(p.kind==='offset'){const child=buildProfile(p.profile);if(!p.round)for(const contour of child.toPolygons())for(let i=0;i<contour.length;i++){const v=contour[i],a=contour[(i+contour.length-1)%contour.length],b=contour[(i+1)%contour.length],length=Math.hypot(a[0]-v[0],a[1]-v[1])*Math.hypot(b[0]-v[0],b[1]-v[1]);if(length&&Math.sqrt(Math.max(0,(1-((a[0]-v[0])*(b[0]-v[0])+(a[1]-v[1])*(b[1]-v[1]))/length)/2))<1e-6)throw new GeometryResourceLimitError(t('Offset corner exceeds the miter budget'));}result=keepProfile(child.offset(p.distance,p.round?'Round':'Miter',1000000,p.segments));}
    else if('profile'in p){const child=buildProfile(p.profile);result=keepProfile(p.kind==='rotate'?child.rotate(p.angle):p.kind==='move'?child.translate(p.vector):child.scale(p.vector));}
    else{const children=p.profiles.map(buildProfile);result=keepProfile(p.kind==='minkowski'?children.reduce(minkowskiProfile):p.kind==='hull'?module.CrossSection.hull(children):p.kind==='union'?module.CrossSection.union(children):p.kind==='subtract'?module.CrossSection.difference(children):module.CrossSection.intersection(children));}
    if(result.numVert()>16384)throw new GeometryResourceLimitError(t('Evaluated profile exceeds 16384 vertices'));profileCache.set(p,result);return result;
  };
  const codeCache=new WeakMap<CodeShape,Manifold>();
  const buildCode=(shape:CodeShape):Manifold=>{
    const previous=codeCache.get(shape);if(previous)return previous;let solid:Manifold;
    if(shape.kind==='empty')solid=keep(module.Manifold.union([]));
    else if(shape.kind==='polyhedron'){const mesh=new module.Mesh({numProp:3,vertProperties:new Float32Array(shape.points.flat()),triVerts:new Uint32Array(triangulatePolyhedron(shape.points,shape.faces))});mesh.merge();solid=keep(new module.Manifold(mesh));}
    else if(shape.kind==='box')solid=keep(module.Manifold.cube(shape.size,true));
    else if(shape.kind==='cylinder')solid=keep(module.Manifold.cylinder(shape.height,shape.radius,shape.radius,shape.segments,true));
    else if(shape.kind==='frustum')solid=keep(module.Manifold.cylinder(shape.height,shape.bottom,shape.top,shape.segments,true));
    else if(shape.kind==='profile-extrude'){const profile=buildProfile(shape.profile);if(4*profile.numVert()*(shape.steps+1)>200000)throw new GeometryResourceLimitError(t('Evaluated extrusion exceeds 200000 faces'));solid=keep(profile.extrude(shape.height,shape.steps-1,shape.twist,shape.scaleTop));}
    else if(shape.kind==='revolve'){
      let profile=buildProfile(shape.profile);
      if(4*profile.numVert()*shape.segments>200000)throw new GeometryResourceLimitError(t('Evaluated revolution exceeds 200000 faces'));
      if(profile.numVert()&&profile.bounds().min[0]<-1e-8){
        // A complete turn of an entirely left-hand profile has the same solid
        // as its radial reflection. Keep partial/cross-axis cases fail-closed.
        if(shape.angle!==360||profile.bounds().max[0]>1e-8)throw new Error(t('Revolved profiles must stay on the nonnegative radial axis'));
        profile=keepProfile(profile.scale([-1,1]));
      }
      solid=keep(shape.angle===0?module.Manifold.union([]):profile.revolve(Math.max(1,Math.ceil(shape.segments*shape.angle/360)),shape.angle));
    }
    else if(shape.kind==='extrude')solid=keep(module.Manifold.extrude([shape.points],shape.height));
    else if(shape.kind==='sphere')solid=keep(module.Manifold.sphere(shape.radius,shape.segments));
    else if(shape.kind==='mirror')solid=keep(buildCode(shape.shape).mirror(shape.vector));
    else if(shape.kind==='axisRotate'){const child=buildCode(shape.shape),length=Math.hypot(...shape.vector),[x,y,z]=shape.vector.map(v=>v/length),a=shape.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),t=1-c;solid=keep(child.transform([t*x*x+c,t*x*y+s*z,t*x*z-s*y,0,t*x*y-s*z,t*y*y+c,t*y*z+s*x,0,t*x*z+s*y,t*y*z-s*x,t*z*z+c,0,0,0,0,1]));}
    else if(shape.kind==='resize'){const child=buildCode(shape.shape),bounds=child.boundingBox();const factors=shape.vector.map((v,i)=>{const extent=bounds.max[i]-bounds.min[i];if(v&&extent<1e-12)throw new Error(t('Cannot resize a degenerate solid'));return v?v/extent:1;}) as [number,number,number];solid=keep(child.scale(factors));}
    else if(shape.kind==='minkowski'){const inputs=shape.shapes.map(buildCode);solid=inputs[0];for(const child of inputs.slice(1)){if(solid.numTri()*child.numTri()>2500000)throw new GeometryResourceLimitError(t('Minkowski operation exceeds the pair budget'));solid=keep(solid.minkowskiSum(child));if(solid.numTri()>200000)throw new GeometryResourceLimitError(t('Evaluated solid exceeds 200000 faces'));}}
    else if('shapes' in shape){const inputs=shape.shapes.map(buildCode);solid=keep(shape.kind==='hull'?module.Manifold.hull(inputs):shape.kind==='union'?module.Manifold.union(inputs):shape.kind==='subtract'?module.Manifold.difference(inputs):module.Manifold.intersection(inputs));}
    else if(shape.kind==='repeat'){const child=buildCode(shape.shape);const copies=Array.from({length:shape.count},(_,i)=>keep(child.translate(shape.step.map(v=>v*i) as [number,number,number])));solid=keep(module.Manifold.union(copies));}
    else {const child=buildCode(shape.shape);solid=keep(shape.kind==='move'?child.translate(shape.vector):shape.kind==='rotate'?child.rotate(shape.vector):child.scale(shape.vector));}
    codeCache.set(shape,solid);return solid;
  };
  const build = (id: string): Manifold => {
    const cached = cache.get(id); if (cached) return cached;
    const node = doc.nodes[id]; let solid: Manifold;
    try {
    switch (node.kind) {
      case 'box': solid = keep(module.Manifold.cube(node.size, true)); break;
      case 'cylinder': solid = keep(module.Manifold.cylinder(node.height, node.radius, node.radius, node.segments, true)); break;
      case 'sphere': solid = keep(module.Manifold.sphere(node.radius, node.segments)); break;
      case 'code': solid=buildCode(compileCode(node.program).shape);if(solid.isEmpty()||solid.volume()<=1e-8)throw new Error(t('Code produces no printable solid'));if(solid.numTri()>200000)throw new GeometryResourceLimitError(t('Evaluated solid exceeds 200000 faces'));break;
      case 'extrusion': {
        const profile=evaluateExtrusion(node,doc);
        solid=keep(module.Manifold.extrude([profile.contour],profile.distance));
        if(profile.start)solid=keep(solid.translate([0,0,profile.start]));
        if(profile.plane==='XZ')solid=keep(solid.rotate([90,0,0]));
        else if(profile.plane==='YZ')solid=keep(solid.rotate([90,0,90]));
        break;
      }
      case 'mesh': {
        const mesh = new module.Mesh({ numProp: 3, vertProperties: new Float32Array(node.positions), triVerts: new Uint32Array(node.indices) });
        mesh.merge(); solid = keep(new module.Manifold(mesh)); break;
      }
      case 'boolean': {
        const operands = node.inputs.map(build);
        solid = keep(node.operation === 'union' ? module.Manifold.union(operands) : node.operation === 'subtract' ? module.Manifold.difference(operands) : module.Manifold.intersection(operands)); break;
      }
    }
    // Both Manifold and the viewport use fixed-axis X, then Y, then Z rotations.
    const scaled = keep(solid.scale(node.transform.scale));
    const rotated = keep(scaled.rotate(node.transform.rotation));
    const result = keep(rotated.translate(node.transform.position));
    const status = result.status();
    if (status !== 'NoError') throw new Error(t`${node.name}: ${status}. Import a closed, consistently oriented solid mesh.`);
    if(result.volume()< -1e-8)throw new Error(t`${node.name}: reversed solid winding produces negative volume. Reorient the mesh faces before importing.`);
    cache.set(id, result); return result;
    } catch(error){if(error instanceof FeatureEvaluationError)throw error;throw new FeatureEvaluationError({source:'feature',id,...(error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'?{code:error.code}:{}),message:`${node.name}: ${error instanceof Error?error.message:String(error)}`});}
  };
  try {
    const bodies = doc.roots.map(id => {
      const solid = build(id); const node: SolidNode = doc.nodes[id]; const mesh = solid.getMesh();
      const positions = new Float32Array(mesh.numVert * 3);
      for (let i = 0; i < mesh.numVert; i++) for (let j = 0; j < 3; j++) positions[i * 3 + j] = mesh.vertProperties[i * mesh.numProp + j];
      const bounds = solid.boundingBox();
      return { id, name: node.name, color: node.color, reference: node.reference, positions, indices: new Uint32Array(mesh.triVerts), volume: solid.volume(), bounds };
    });
    return { sourceKey:documentGeometryKey(doc), bodies, volume: bodies.filter(b=>!b.reference).reduce((s, b) => s + b.volume, 0), triangles: bodies.filter(b=>!b.reference).reduce((s, b) => s + b.indices.length / 3, 0) };
  } finally { for (const solid of [...owned].reverse()) solid.delete();for(const profile of [...profiles].reverse())profile.delete(); }
}
