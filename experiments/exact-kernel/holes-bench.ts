// SPDX-License-Identifier: BSD-3-Clause
// Plates with many holes on the exact kernel: build, then fillet (every top edge, hole rims
// included) or shell (open top), then the display mesh, both ways: the product's face-wise path
// (packages/exact/src/face-mesh.ts) and SMLib's whole-body mesh it replaces for such bodies.
// Writes results/holes-<os>-<arch>.json. Process CPU time is the measure (see README: the machine
// is shared, so wall times swing); every display is checked closed by displayMesh.
//   npm run build:packages && node experiments/exact-kernel/holes-bench.ts [10,50,200]
import {writeFileSync} from 'node:fs';
import {cpuUsage} from 'node:process';
import {createExactBackend,displayMesh,displayTessellation} from '@brickwright/cad-exact';
import type {ExactSolid} from '@brickwright/cad-exact';

const counts=(process.argv[2]??'10,50,200').split(',').map(Number);
const {kernel:k}=await createExactBackend();
const display={tolerance:.01,angleDeg:10};
type Timed<T>={cpuMs:number;wallMs:number}&({value:T}|{error:string});
function time<T>(run:()=>T):Timed<T>{
 const wall=performance.now(),cpu=cpuUsage();
 const spent=()=>{const used=cpuUsage(cpu);return {cpuMs:Math.round((used.user+used.system)/1000),wallMs:Math.round(performance.now()-wall)};};
 try{const value=run();return {value,...spent()};}
 catch(error){return {error:error instanceof Error?error.message.split('\n')[0]:String(error),...spent()};}
}
/** A plate `thickness` mm thick with `n` holes of radius 2 mm, 6 mm apart, as one extruded profile. */
function plate(n:number,thickness:number):ExactSolid{
 const cols=Math.ceil(Math.sqrt(n*1.25)),rows=Math.ceil(n/cols),P=k.profile,holes=[];
 for(let i=0;i<n;i++)holes.push(P.translate(P.circle(2),[4+i%cols*6,4+Math.floor(i/cols)*6]));
 return k.extrude(P.subtract(P.rectangle(cols*6+2,rows*6+2,false),...holes),thickness);
}
const top={faceNormal:[0,0,1] as [number,number,number],outermost:true};
const variants:Record<string,(n:number)=>ExactSolid>={
 plain:n=>plate(n,3),
 fillet:n=>k.fillet(plate(n,3),.5,top),
 shell:n=>k.shell(plate(n,4),.5,top),
};
const rows:Record<string,unknown>[]=[];
for(const n of counts)for(const [variant,make] of Object.entries(variants)){
 k.scope(()=>{
  const build=time(()=>make(n));
  const row:Record<string,unknown>={holes:n,variant,build:{cpuMs:build.cpuMs,wallMs:build.wallMs,...('error' in build?{error:build.error}:{})}};
  if('value' in build){
   const solid=build.value;
   const ours=time(()=>displayTessellation(k,solid,'plate'));
   const kernel=time(()=>displayMesh(k.tessellate(solid,display),'plate'));
   const triangles=(r:Timed<{indices:ArrayLike<number>}>)=>'value' in r?r.value.indices.length/3:undefined;
   row.display={cpuMs:ours.cpuMs,wallMs:ours.wallMs,triangles:triangles(ours),...('error' in ours?{error:ours.error}:{})};
   row.smlibWholeBody={cpuMs:kernel.cpuMs,wallMs:kernel.wallMs,triangles:triangles(kernel),...('error' in kernel?{error:kernel.error}:{})};
   row.wasmMemoryMiB=Math.round(k.memory().heap/1048576);
  }
  console.log(JSON.stringify(row));rows.push(row);
 });
}
const result={node:process.version,date:new Date().toISOString(),tolerance:display,rows};
writeFileSync(new URL(`results/holes-${process.platform}-${process.arch}.json`,import.meta.url),JSON.stringify(result,null,2)+'\n');
