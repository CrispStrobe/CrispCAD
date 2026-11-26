// SPDX-License-Identifier: BSD-3-Clause
// The exact kernel (0.1.6) finds smlibwasm's `_emscripten_resize_heap` import by the function's
// name to hold its memory ceiling. A minified production build must keep that name, or the kernel
// refuses to load with a ceiling and every exact job in the browser fails.
import {readdirSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {expect,it} from 'vitest';
import {transformWithEsbuild} from 'vite';
import {preserveExactKernelNames} from '../scripts/exact-kernel-assets.js';

it('keeps the kernel loader\'s function names through minification',async()=>{
 const dist=dirname(createRequire(import.meta.url).resolve('@crispcad/exact-kernel'));
 const file=readdirSync(dist).map(name=>join(dist,name)).find(path=>path.endsWith('.js')&&readFileSync(path,'utf8').includes('function _emscripten_resize_heap'))!;
 expect(file).toBeTruthy();
 const code=readFileSync(file,'utf8'),minify=(source:string)=>transformWithEsbuild(source,file,{loader:'js',target:'esnext',minify:true}).then(r=>r.code);
 // Without the plugin, minification renames the function and nothing keeps its name.
 expect(await minify(code)).not.toMatch(/["']_emscripten_resize_heap["']/);
 const plugin=preserveExactKernelNames() as {transform:(code:string,id:string)=>Promise<{code:string}|null>|null};
 const kept=await plugin.transform(code,file);
 expect(kept).toBeTruthy();
 expect(await minify(kept!.code)).toMatch(/["']_emscripten_resize_heap["']/);
 // Other modules are left alone.
 expect(plugin.transform('function f(){}','/x/node_modules/other/dist/index.js')).toBeNull();
},120_000);
