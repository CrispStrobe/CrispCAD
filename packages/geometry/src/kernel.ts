// SPDX-License-Identifier: BSD-3-Clause
import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { validateDocument, documentGeometryKey, evaluateExtrusion, FeatureEvaluationError, compileCode } from '@brickwright/cad-core';
import type { CadDocument, SolidNode, CodeShape } from '@brickwright/cad-core';
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
    hullPoints(points: readonly [number,number,number][]) { if(points.length<4||points.length>4096||points.some(p=>p.length!==3||p.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6)))throw new Error('Collision hull points exceed the finite geometry budget');const hull=module.Manifold.hull(points);try{if(hull.isEmpty())throw new Error('Collision segment is degenerate');const mesh=hull.getMesh();return remember({positions:new Float64Array(Array.from({length:mesh.numVert*3},(_,i)=>mesh.vertProperties[Math.floor(i/3)*mesh.numProp+i%3])),indices:new Uint32Array(mesh.triVerts)});}finally{hull.delete();} },
  };
}
export type GeometryKernel = Awaited<ReturnType<typeof createGeometryKernel>>;
function evaluateDocument(module: ManifoldToplevel, input: CadDocument): GeometryResult {
  const doc = validateDocument(input); const cache = new Map<string, Manifold>(); const owned = new Set<Manifold>();
  const keep = (m: Manifold) => { owned.add(m); return m; };
  const codeCache=new WeakMap<CodeShape,Manifold>();
  const buildCode=(shape:CodeShape):Manifold=>{
    const previous=codeCache.get(shape);if(previous)return previous;let solid:Manifold;
    if(shape.kind==='box')solid=keep(module.Manifold.cube(shape.size,true));
    else if(shape.kind==='cylinder')solid=keep(module.Manifold.cylinder(shape.height,shape.radius,shape.radius,shape.segments,true));
    else if(shape.kind==='sphere')solid=keep(module.Manifold.sphere(shape.radius,shape.segments));
    else if('shapes' in shape){const inputs=shape.shapes.map(buildCode);solid=keep(shape.kind==='union'?module.Manifold.union(inputs):shape.kind==='subtract'?module.Manifold.difference(inputs):module.Manifold.intersection(inputs));}
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
      case 'code': solid=buildCode(compileCode(node.program).shape);if(solid.isEmpty()||solid.volume()<=1e-8)throw new Error('Code produces no printable solid');break;
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
    if (status !== 'NoError') throw new Error(`${node.name}: ${status}. Import a closed, consistently oriented solid mesh.`);
    if(result.volume()< -1e-8)throw new Error(`${node.name}: reversed solid winding produces negative volume. Reorient the mesh faces before importing.`);
    cache.set(id, result); return result;
    } catch(error){if(error instanceof FeatureEvaluationError)throw error;throw new FeatureEvaluationError({source:'feature',id,message:`${node.name}: ${error instanceof Error?error.message:String(error)}`});}
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
  } finally { for (const solid of [...owned].reverse()) solid.delete(); }
}
