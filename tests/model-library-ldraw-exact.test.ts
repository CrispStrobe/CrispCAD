// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import {convertLDrawBundle} from '../scripts/lib/ldraw-model.mjs';
const root='parts/3704.dat';
// Closure identities are also pinned in the admitted manifest; discover references
// from supplied exact files, never a system include path or generated primitive.
function closure(path:string,files=new Map<string,Uint8Array>()){
 if(files.has(path))return files;const bytes=readFileSync('library/sources/ldraw/'+path);files.set(path,bytes);
 for(const line of bytes.toString().split(/\r?\n/)){const t=line.trim().split(/\s+/);if(t[0]!=='1')continue;const ref=t.slice(14).join(' ').replaceAll('\\','/');let found=false;for(const key of ['parts/'+ref,'p/'+ref]){try{readFileSync('library/sources/ldraw/'+key);}catch{continue;}closure(key,files);found=true;break;}if(!found)throw Error('Missing pinned dependency '+ref);}
 return files;
}
it('keeps the authored axle closed through exact decimal indexing and validated quad triangulation',async()=>{
 const files=[...closure(root)].map(([path,bytes])=>({path,bytes})),c=convertLDrawBundle({rootPath:root,files});expect(c.points).toHaveLength(90);
 const edges=new Map<string,number>();for(const f of c.faces)for(let i=0;i<f.length;i++){const key=[f[i],f[(i+1)%f.length]].sort((a,b)=>a-b).join(',');edges.set(key,(edges.get(key)||0)+1);}expect([...edges.values()].every(n=>n===2)).toBe(true);
 const kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')}),session=createCadSession();try{session.addCode(c.program);const g=kernel.evaluate(session.state.document);expect(g.volume).toBeGreaterThan(0);const screen=await checkModelLibrarySTL(exportSTL(g.bodies),{checkedOn:'2026-11-15',maxTriangles:10000,maxExtentMm:200,toMillimetresZUp:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]});expect(screen.triangles).toBe(176);expect(Object.values(screen.checks)).toEqual(['pass','pass','pass','pass']);}finally{session.dispose();}
});
const bytes=(s:string)=>new TextEncoder().encode(s),prefix='0 BFC CERTIFY CCW\n';
it('refuses unsupported warped quads and excessive exact precision without repairing coordinates',()=>{
 const bad=prefix+'4 16 0 0 0 10 0 0 10 10 5 0 10 0\n';expect(()=>convertLDrawBundle({rootPath:'parts/bad.dat',files:[{path:'parts/bad.dat',bytes:bytes(bad)}]})).toThrow('coplanarity or convexity');
 expect(()=>convertLDrawBundle({rootPath:'parts/bad.dat',files:[{path:'parts/bad.dat',bytes:bytes(prefix+'3 16 0 0 0 1e-999999 0 0 0 1 0\n')}]})).toThrow('precision budget');
});

it('does not tolerance-weld distinct authored decimal vertices',()=>{
 const source=prefix+'3 16 0 0 0 1 0 0 0 1 0\n3 16 0 0 0 1.0000000001 0 0 0 0 1\n3 16 0 0 0 0 1 0 0 0 1\n3 16 1 0 0 0 0 1 0 1 0\n';
 const c=convertLDrawBundle({rootPath:'parts/distinct.dat',files:[{path:'parts/distinct.dat',bytes:bytes(source)}]});expect(c.points).toHaveLength(5);expect(c.points.filter(p=>p[0]>0&&p[1]===0&&p[2]===0)).toHaveLength(2);
});
