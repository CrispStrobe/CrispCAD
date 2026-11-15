// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import {convertLDrawBundle} from '../scripts/lib/ldraw-model.mjs';
const root='parts/tetra.dat',prefix='0 BFC CERTIFY CCW\n',identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const source=(gap='0',overlap=false)=>prefix+[
 `3 16 0 0 0 0 10 0 5 0 ${gap}`,
 `3 16 5 0 ${gap} 0 10 0 10 0 0`,
 '3 16 0 0 0 10 0 0 0 0 10',
 '3 16 10 0 0 0 10 0 0 0 10',
 '3 16 0 10 0 0 0 0 0 0 10',
 ...(overlap?['3 16 0 0 0 0 10 0 5 0 0']:[]),
].join('\n')+'\n';
const convert=(s:string)=>convertLDrawBundle({rootPath:root,files:[{path:root,bytes:new TextEncoder().encode(s)}]});
function incidence(faces:number[][]){const edges=new Map<string,number[]>();for(const face of faces)for(let i=0;i<face.length;i++){const a=face[i],b=face[(i+1)%face.length],key=[a,b].sort((a,b)=>a-b).join(',');edges.set(key,[...(edges.get(key)||[]),a<b?1:-1]);}return [...edges.values()];}
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
it('subdivides exact existing T-junction endpoints with opposite edge pairs and preserved native solid volume',async()=>{
 const c=convert(source());expect(c.points).toHaveLength(5);expect(c.faces).toHaveLength(5);expect(c.faces.some((f:number[])=>f.length===4)).toBe(true);expect(incidence(c.faces).every(v=>v.length===2&&v[0]+v[1]===0)).toBe(true);expect(c.metrics.work).toBeLessThanOrEqual(16384);
 const session=createCadSession();try{session.addCode(c.program);const g=kernel.evaluate(session.state.document);expect(g.volume).toBeCloseTo(64/6,10);const screen=await checkModelLibrarySTL(exportSTL(g.bodies),{checkedOn:'2026-11-15',maxTriangles:10000,maxExtentMm:200,toMillimetresZUp:identity});expect(Object.values(screen.checks)).toEqual(['pass','pass','pass','pass']);expect(screen.signedVolumeMm3).toBeGreaterThan(0);}finally{session.dispose();}
});
it('preserves a real tiny off-edge gap instead of snapping an endpoint onto the supporting line',()=>{
 const c=convert(source('0.0000000000000002'));expect(c.points).toHaveLength(5);expect(c.faces.every((f:number[])=>f.length===3)).toBe(true);expect(incidence(c.faces).some(v=>v.length!==2)).toBe(true);expect(c.points.some((p:number[])=>p[0]===2&&p[1]>0&&p[1]<1e-15)).toBe(true);
 const session=createCadSession();try{session.addCode(c.program);expect(()=>kernel.evaluate(session.state.document)).toThrow();}finally{session.dispose();}
});
it('does not delete overlapping authored facets to fabricate a manifold',()=>{
 const c=convert(source('0',true));expect(c.faces).toHaveLength(6);expect(incidence(c.faces).some(v=>v.length>2)).toBe(true);const session=createCadSession();try{session.addCode(c.program);expect(()=>kernel.evaluate(session.state.document)).toThrow();}finally{session.dispose();}
});
it('charges exact conformity construction and refuses excessive endpoint expansion at the unchanged work guard',()=>{
 const s=prefix+Array.from({length:254},(_,i)=>`3 16 0 0 0 ${i+1} 0 0 0 1 0`).join('\n');expect(new TextEncoder().encode(s).length).toBeLessThan(32768);expect(()=>convert(s)).toThrow('construction work exceeds16384');
});
