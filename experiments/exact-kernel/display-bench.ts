// SPDX-License-Identifier: BSD-3-Clause
// Display meshing of exact results with many holes (docs/CRISPCAD-CONVERGENCE.md, Phase 5.3): the
// plate of limits-bench.ts (2 mm holes 6 mm apart), plain, with its top face's edges filleted or
// chamfered (r/d 0.5 mm) or shelled (0.5 mm, open top), then meshed for display as the product
// does (`displayTessellation`). One fresh process per case; SharedArrayBuffer hidden as in the
// browser editor. Only the display is the subject here; the kernel operation is timed for scale.
//
//   npm run build:packages && node experiments/exact-kernel/display-bench.ts [50,100,200] [plain,fillet,chamfer,shell] [label]
// writes results/display-<label>-<os>-<arch>.json (label default "now").
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {cpuUsage} from 'node:process';
import {fileURLToPath} from 'node:url';

const MiB=1048576;
if(process.argv[2]==='--case'){
 const [variant,nText]=process.argv.slice(3),n=Number(nText);
 (globalThis as {SharedArrayBuffer?:unknown}).SharedArrayBuffer=undefined;
 const exact=await import('@brickwright/cad-exact');
 // No shell guard: the display is the subject, and the guard is wall-clock (a loaded machine trips it).
 const {kernel:k}=await exact.createExactBackend({guardSeconds:0});
 const P=k.profile,cols=Math.ceil(Math.sqrt(n*1.25)),rows=Math.ceil(n/cols),holes=[];
 for(let i=0;i<n;i++)holes.push(P.translate(P.circle(2),[4+i%cols*6,4+Math.floor(i/cols)*6]));
 const row:Record<string,unknown>={variant,holes:n};
 const timed=<T,>(key:string,run:()=>T):T|undefined=>{
  const cpu=cpuUsage(),wall=performance.now();
  try{return run();}
  catch(error){row.error=`${key}: ${error instanceof Error?`${error.constructor.name}: ${error.message.split('\n')[0]}`:String(error)}`;return undefined;}
  finally{const used=cpuUsage(cpu);row[key]={cpuMs:Math.round((used.user+used.system)/1000),wallMs:Math.round(performance.now()-wall),memoryMiB:Math.round(k.memory().heap/MiB)};}
 };
 k.scope(()=>{
  const shell=variant==='shell';
  const source=timed('build',()=>k.extrude(P.subtract(P.rectangle(cols*6+2,rows*6+2,false),...holes),shell?4:3));
  if(!source)return;
  const top={faceNormal:[0,0,1] as [number,number,number],outermost:true as const};
  const solid=variant==='plain'?source:timed('operation',()=>variant==='fillet'?k.fillet(source,.5,top):variant==='chamfer'?k.chamfer(source,.5,top):k.shell(source,.5,top));
  if(!solid)return;
  const volume=k.volume(solid);
  const display=timed('display',()=>exact.displayTessellation(k,solid,'plate'));
  if(display){
   row.triangles=display.indices.length/3;
   // The display's enclosed volume against the exact one (a check that the mesh is the body).
   const p=display.positions,ix=display.indices;let v=0;
   for(let t=0;t<ix.length;t+=3){const a=3*ix[t],b=3*ix[t+1],c=3*ix[t+2];v+=p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])-p[a+1]*(p[b]*p[c+2]-p[b+2]*p[c])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]);}
   row.volume=volume;row.displayVolumeError=Number(((v/6-volume)/volume).toExponential(2));
  }
 });
 console.log(JSON.stringify(row));
 process.exit(0);
}

const counts=(process.argv[2]??'50,100,200').split(',').map(Number);
const variants=(process.argv[3]??'plain,fillet,chamfer,shell').split(',');
const label=process.argv[4]??'now';
const self=fileURLToPath(import.meta.url),rows=[];
for(const variant of variants)for(const n of counts){
 let line='';
 try{line=execFileSync(process.execPath,[self,'--case',variant,String(n)],{encoding:'utf8',maxBuffer:64*MiB,timeout:900000}).trim().split('\n').at(-1)!;}
 catch(error){line=JSON.stringify({variant,holes:n,crashed:String((error as {stderr?:string}).stderr??error).slice(-400)});}
 console.log(line);rows.push(JSON.parse(line));
}
writeFileSync(new URL(`results/display-${label}-${process.platform}-${process.arch}.json`,import.meta.url),JSON.stringify({node:process.version,date:new Date().toISOString(),note:'process CPU time on a shared, loaded Apple M1; no probe worker (as in the browser editor)',rows},null,1)+'\n');
