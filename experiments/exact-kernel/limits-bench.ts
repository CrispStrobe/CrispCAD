// SPDX-License-Identifier: BSD-3-Clause
// Cost, time and memory of exact features as the editor's exact worker runs them, one fresh
// process per case (WebAssembly memory never shrinks, so a shared process would only show the
// running peak). Calibrates the pre-flight limits in packages/exact/src/limits.ts.
//
// The browser editor is not cross-origin isolated, so smlibwasm has no probe worker there: shell
// runs in the worker's own kernel under its 20 s deadline and fillet/chamfer run without one.
// Node has a probe worker; this bench hides SharedArrayBuffer so Node takes the editor's path.
//
//   npm run build:packages && node experiments/exact-kernel/limits-bench.ts [10,25,50,100,150,200] [fillet,chamfer,shell] [capMiB]
// Variants fillet-poly, chamfer-poly, shell-poly use a sawtooth outline of n straight edges instead.
// writes results/limits-<os>-<arch>.json. With capMiB, the kernel's memory is capped as in the
// editor's worker (see packages/exact/src/memory-cap.ts).
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {cpuUsage} from 'node:process';
import {fileURLToPath} from 'node:url';

const MiB=1048576;
if(process.argv[2]==='--case'){
 const [variant,nText,capText]=process.argv.slice(3),n=Number(nText),cap=Number(capText)||0;
 (globalThis as {SharedArrayBuffer?:unknown}).SharedArrayBuffer=undefined;
 const exact=await import('@brickwright/cad-exact');
 const {kernel:k}=await exact.createExactBackend(cap?{maxMemoryBytes:cap*MiB}:{});
 const P=k.profile,cols=Math.ceil(Math.sqrt(n*1.25)),rows=Math.ceil(n/cols),holes=[];
 for(let i=0;i<n;i++)holes.push(P.translate(P.circle(2),[4+i%cols*6,4+Math.floor(i/cols)*6]));
 const row:Record<string,unknown>={variant,holes:n,cap:cap||undefined};
 const mem=()=>Math.round(k.memory().heap/MiB);
 const timed=<T,>(key:string,run:()=>T):T|undefined=>{
  const cpu=cpuUsage(),wall=performance.now();
  try{return run();}
  catch(error){row.error=`${key}: ${error instanceof Error?`${error.constructor.name}: ${error.message.split('\n')[0]}`:String(error)}`;return undefined;}
  finally{const used=cpuUsage(cpu);row[key]={cpuMs:Math.round((used.user+used.system)/1000),wallMs:Math.round(performance.now()-wall),memoryMiB:mem()};}
 };
 k.scope(()=>{
  const shell=variant.startsWith('shell'),thickness=shell?4:3;
  // `*-poly`: a gear-like sawtooth outline of n straight edges instead of n holes (curved rims).
  const sawtooth=()=>{const r=Math.max(10,n*.6),points:[number,number][]=[];for(let i=0;i<n;i++){const a=2*Math.PI*i/n,q=i%2?r-1.5:r;points.push([q*Math.cos(a),q*Math.sin(a)]);}return P.polygon([points]);};
  const source=timed('build',()=>k.extrude(variant.endsWith('-poly')?sawtooth():P.subtract(P.rectangle(cols*6+2,rows*6+2,false),...holes),thickness));
  if(!source)return;
  const top={faceNormal:[0,0,1] as [number,number,number],outermost:true as const};
  const operation=variant.replace('-poly','') as 'fillet'|'chamfer'|'shell',size=variant.endsWith('-poly')?.2:.5;
  row.cost=exact.exactFeatureCost(source,operation,shell?undefined:top);
  const solid=timed('operation',()=>operation==='fillet'?k.fillet(source,size,top):operation==='chamfer'?k.chamfer(source,size,top):k.shell(source,size,top));
  if(!solid)return;
  const display=timed('display',()=>exact.displayTessellation(k,solid,'plate'));
  if(display)row.triangles=display.indices.length/3;
 });
 // Is the kernel still usable afterwards (after a capped failure it may not be)?
 try{k.scope(()=>{row.afterwards=Math.round(k.volume(k.fillet(k.box([20,30,10]),2)));});}
 catch(error){row.afterwards=error instanceof Error?error.message.split('\n')[0]:String(error);}
 console.log(JSON.stringify(row));
 process.exit(0);
}

const counts=(process.argv[2]??'10,25,50,100,150,200').split(',').map(Number);
const variants=(process.argv[3]??'fillet,chamfer,shell').split(',');
const cap=process.argv[4]??'';
const self=fileURLToPath(import.meta.url),rows=[];
for(const variant of variants)for(const n of counts){
 let line='';
 try{line=execFileSync(process.execPath,[self,'--case',variant,String(n),cap],{encoding:'utf8',maxBuffer:64*MiB,timeout:600000}).trim().split('\n').at(-1)!;}
 catch(error){line=JSON.stringify({variant,holes:n,cap:cap||undefined,crashed:String((error as {stderr?:string}).stderr??error).slice(-400)});}
 console.log(line);rows.push(JSON.parse(line));
}
const name=`results/limits-${process.platform}-${process.arch}${variants.every(v=>v.endsWith('-poly'))?'-poly':''}${cap?`-cap${cap}`:''}.json`;
writeFileSync(new URL(name,import.meta.url),JSON.stringify({node:process.version,date:new Date().toISOString(),note:'process CPU time on a shared, loaded Apple M1; no probe worker (as in the browser editor)',rows},null,1)+'\n');
