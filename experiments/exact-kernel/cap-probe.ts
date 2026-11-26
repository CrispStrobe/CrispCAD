// SPDX-License-Identifier: BSD-3-Clause
// What a capped kernel does when a job needs more memory than the ceiling: SMLib's whole-body mesh
// of a plate with n holes (297 MiB uncapped for 200 holes), then a small fillet on the same kernel.
//   node experiments/exact-kernel/cap-probe.ts [capMiB=96] [holes=200]
(globalThis as {SharedArrayBuffer?:unknown}).SharedArrayBuffer=undefined;
const {createExactBackend,isFatalExactError}=await import('@brickwright/cad-exact');
const cap=Number(process.argv[2]??96),n=Number(process.argv[3]??200);
const {kernel:k,memoryCapBytes}=await createExactBackend({maxMemoryBytes:cap*1048576});
console.log('cap applied',memoryCapBytes&&memoryCapBytes/1048576,'MiB');
const P=k.profile,cols=Math.ceil(Math.sqrt(n*1.25)),rows=Math.ceil(n/cols),holes=[];
for(let i=0;i<n;i++)holes.push(P.translate(P.circle(2),[4+i%cols*6,4+Math.floor(i/cols)*6]));
const t0=performance.now();
try{k.scope(()=>{const m=k.tessellate(k.extrude(P.subtract(P.rectangle(cols*6+2,rows*6+2,false),...holes),3));console.log('meshed',m.indices.length/3,'triangles');});}
catch(error){
 const chain=[];for(let e:any=error;e;e=e.cause)chain.push(`${e.constructor?.name}${e.code?`(${e.code})`:''}: ${String(e.message).split('\n')[0].slice(0,160)}`);
 console.log('failed after',Math.round(performance.now()-t0),'ms; fatal:',isFatalExactError(error));console.log(chain.join('\n  caused by '));
}
console.log('memory now',k.memory().heap/1048576,'MiB');
try{k.scope(()=>console.log('afterwards: fillet volume',k.volume(k.fillet(k.box([20,30,10]),2))));}
catch(error){console.log('afterwards failed:',error instanceof Error?`${error.constructor.name}: ${error.message.split('\n')[0]}`:error,'fatal:',isFatalExactError(error));}
