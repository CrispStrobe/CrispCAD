// SPDX-License-Identifier: BSD-3-Clause
// The real exact kernel under a memory ceiling (its own file: the kernel loads once per module
// context, and the ceiling counts only at load). SMLib's whole-body mesh of a plate with 200 holes
// grows linear memory to ~297 MiB uncapped (experiments/exact-kernel/README.md); with a 96 MiB
// ceiling it must fail cleanly instead, and the kernel's memory must stay at the ceiling.
import {expect,it} from 'vitest';
import {createExactBackend,isFatalExactError,ExactKernelError} from '@brickwright/cad-exact';

const MiB=1048576;
it('fails a job that needs more memory than the ceiling with a clean, fatal-flagged error',async()=>{
 const {kernel:k,memoryCapBytes}=await createExactBackend({maxMemoryBytes:96*MiB});
 expect(memoryCapBytes).toBe(96*MiB);
 const P=k.profile,holes=[];
 for(let i=0;i<200;i++)holes.push(P.translate(P.circle(2),[4+i%16*6,4+Math.floor(i/16)*6]));
 let error:unknown;
 try{k.scope(()=>k.tessellate(k.extrude(P.subtract(P.rectangle(98,80,false),...holes),3)));}catch(e){error=e;}
 expect(error).toBeInstanceOf(ExactKernelError);
 expect((error as Error).message).toMatch(/out of memory/i);
 expect(isFatalExactError(error)).toBe(true);
 expect(k.memory().heap).toBeLessThanOrEqual(96*MiB);
 // SMLib reports the allocation failure instead of aborting: the kernel still answers (the editor
 // ends the worker anyway, as a precaution and to return the memory).
 expect(k.scope(()=>k.volume(k.fillet(k.box([20,30,10]),2)))).toBeCloseTo(5804.696111,4);
},180_000);
