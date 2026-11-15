// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createCadSession,importOpenSCAD} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const policy={checkedOn:'2026-11-15',maxTriangles:10000,maxExtentMm:200,toMillimetresZUp:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
it('keeps the exact authored Sign03 decimal cylinder contact closed',async()=>{
 const bytes=readFileSync('library/corpus/repos/AngeloNicoli--OpenSCAD-Snippet/Asset_SCAD/Sign_03.scad');expect(createHash('sha256').update(bytes).digest('hex')).toBe('78b28f433cf0fe1807864af8c060a346b4326103cd25c18eb9aa92e964eae32b');
 const s=createCadSession();try{s.addCode(importOpenSCAD(bytes.toString()));const mesh=exportSTL(kernel.evaluate(s.state.document).bodies);expect(createHash('sha256').update(mesh).digest('hex')).toBe('0d7e9c193c1fe405dd585743f9a209f03d8a005b36605650dcf8814301d77b86');const screen=await checkModelLibrarySTL(mesh,policy);expect(screen.triangles).toBe(564);expect(Object.values(screen.checks)).toEqual(['pass','pass','pass','pass']);}finally{s.dispose();}
});
it('retains centred cylinder defaults and an actual gap between uniform cylinders',async()=>{
 const s=createCadSession();try{s.addCode({version:1,language:'brickwright-cad-script',parameters:{},source:'return cylinder(2,0.1,50);'});const b=kernel.evaluate(s.state.document).bodies[0].bounds;expect(b.min[2]).toBe(-.05);expect(b.max[2]).toBe(.05);}finally{s.dispose();}
 const gap=createCadSession();try{gap.addCode({version:1,language:'brickwright-cad-script',parameters:{},source:'return union(move([0,0,.05],cylinder(2,.1,50)),move([0,0,.150001],cylinder(2,.1,50)));'});const g=kernel.evaluate(gap.state.document),body=g.bodies[0],edges=new Map<number,Set<number>>();for(let i=0;i<body.indices.length;i+=3)for(const a of body.indices.slice(i,i+3))for(const b of body.indices.slice(i,i+3)){if(!edges.has(a))edges.set(a,new Set());edges.get(a)!.add(b);}const seen=new Set<number>();let components=0;for(const v of edges.keys()){if(seen.has(v))continue;components++;const pending=[v];while(pending.length){const n=pending.pop()!;if(seen.has(n))continue;seen.add(n);pending.push(...edges.get(n)!);}}expect(components).toBe(2);expect(body.positions.some((v,i)=>i%3===2&&v>.1&&v<.100002)).toBe(true);expect(Object.values((await checkModelLibrarySTL(exportSTL(g.bodies),policy)).checks)).toEqual(['pass','pass','pass','pass']);}finally{gap.dispose();}
});
