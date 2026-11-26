// SPDX-License-Identifier: BSD-3-Clause
// The exact memory ceiling in a minified production build. The geometry worker bundles
// @crispcad/exact-kernel, and Vite minifies it (renaming functions). 0.1.6 found smlibwasm's
// heap-resize import by the function's name, so the built app refused to load the kernel with a
// ceiling and CrispCAD kept the kernel's names with a Vite plugin; since 0.1.7 the kernel takes the
// import by its keys in the module's import table. This builds the kernel with Vite as the worker
// build does (minified, no keepNames, the wasm emitted as a file), checks the function names are
// gone, and runs the ceiling on the result. Its own file: the ceiling holds per module context.
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {expect,it} from 'vitest';
import {build} from 'vite';
import {emitWasmFiles,exactKernelWorkerOutput} from '../scripts/exact-kernel-assets.js';

const MiB=1048576;
it('holds the exact memory ceiling in a minified Vite build of the kernel',async()=>{
 const kernelEntry=createRequire(import.meta.url).resolve('@crispcad/exact-kernel');
 const out=mkdtempSync(join(tmpdir(),'crispcad-exact-minified-'));
 try{
  const entry=join(out,'entry.js');
  writeFileSync(entry,`export {createSmlibKernel} from ${JSON.stringify(kernelEntry)};\n`);
  await build({configFile:false,logLevel:'silent',root:out,plugins:[emitWasmFiles()],
   // smlibwasm's probe workers are bundled as the app's worker build bundles them.
   worker:{format:'es',plugins:()=>[emitWasmFiles()],rollupOptions:{output:exactKernelWorkerOutput}},
   build:{outDir:join(out,'dist'),emptyOutDir:true,minify:true,target:'esnext',write:true,
    lib:{entry,formats:['es'],fileName:()=>'kernel.js'},rollupOptions:{external:[/^node:/]}}});
  const files=readdirSync(join(out,'dist'),{recursive:true}).map(String).filter(f=>f.endsWith('.js'));
  const code=files.map(f=>readFileSync(join(out,'dist',f),'utf8')).join('\n');
  // The minifier renamed the loader's functions; nothing keeps their names any more.
  expect(code).not.toMatch(/_emscripten_resize_heap/);
  const {createSmlibKernel}=await import(pathToFileURL(join(out,'dist','kernel.js')).href) as typeof import('@crispcad/exact-kernel');
  const wasmBinary=readFileSync(join(dirname(kernelEntry),'smlibwasm.wasm'));
  const k=await createSmlibKernel({maxMemoryBytes:80*MiB,wasmBinary});
  expect(k.maxMemoryBytes).toBe(80*MiB);
  expect(k.scope(()=>k.volume(k.box([1,2,3])))).toBeCloseTo(6,9);
  // A sphere tessellated at 1 degree needs ~888 MiB: under the ceiling it fails cleanly.
  let error:unknown;
  try{k.scope(()=>k.tessellate(k.sphere(50),{tolerance:.1,angleDeg:1}));}catch(e){error=e;}
  expect((error as Error)?.name).toBe('ExactKernelError');
  expect((error as Error).message).toMatch(/out of memory/i);
  expect(k.memory().heap).toBeLessThanOrEqual(80*MiB);
  expect(k.scope(()=>k.volume(k.fillet(k.box([20,30,10]),2)))).toBeCloseTo(5804.696111,4);
 }finally{rmSync(out,{recursive:true,force:true});}
},300_000);
