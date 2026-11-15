// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {namespaceOpenSCADBundle} from '../scripts/lib/openscad-bundle-namespace.mjs';
import {importOpenSCADBundle,OPENSCAD_BUNDLE_LIMITS} from '../packages/core/src/openscad-bundle.js';
const sha=(source:string|Uint8Array)=>createHash('sha256').update(source).digest('hex');
const file=(path:string,source:string)=>({path,source,sha256:sha(source)});
const fixture=()=>({namespace:'parts',rootPath:'demo/root.scad',files:[file('demo/root.scad','include <parts/constants.scad> cube(size);'),file('constants.scad','size=2;')]});
it('retains package-prefixed include paths and exact source/hash identity in supplied files',async()=>{
 const input=fixture(),bundle=namespaceOpenSCADBundle(input),result=await importOpenSCADBundle(bundle);
 expect(bundle.rootPath).toBe('parts/demo/root.scad');expect(result.provenance.includes[0]).toMatchObject({path:'parts/constants.scad',resolution:'bundle-root'});
 expect(result.provenance.files.map(f=>[f.source,f.sha256])).toEqual(input.files.map(f=>[f.source,f.sha256]));
 const local=file('demo/parts/constants.scad','size=3;'),preferred=await importOpenSCADBundle(namespaceOpenSCADBundle({...input,files:[...input.files,local]}));
 expect(preferred.provenance.includes[0].path).toBe('parts/demo/parts/constants.scad');expect(preferred.provenance.includes[0].resolution).toBeUndefined();
});
it.each(['../outside.scad','a/../../outside.scad','/absolute.scad','https://example.com/file.scad','C:\\file.scad','bad\u0000.scad'])('refuses virtual-file escape or external path %j',path=>{
 const input=fixture();expect(()=>namespaceOpenSCADBundle({...input,files:[...input.files,file(path,'cube(1);')]})).toThrow();
});
it('refuses namespace escapes, normalized collisions, missing roots and accessor records',()=>{
 const input=fixture();for(const namespace of ['..','a/b','/tmp','https://example.com','a\\b'])expect(()=>namespaceOpenSCADBundle({...input,namespace})).toThrow();
 expect(()=>namespaceOpenSCADBundle({...input,files:[...input.files,file('./constants.scad','size=9;')]})).toThrow('Duplicate');
 expect(()=>namespaceOpenSCADBundle({...input,rootPath:'missing.scad'})).toThrow('Root');
 let reads=0;const malicious={path:'evil.scad',get source(){reads++;return 'cube(9);';},sha256:'0'.repeat(64)};
 expect(()=>namespaceOpenSCADBundle({...input,files:[...input.files,malicious]})).toThrow('data properties');expect(reads).toBe(0);
});
it('retains pre-expansion corrupt-byte and size refusals, missing inputs and include escapes',async()=>{
 const input=fixture();await expect(importOpenSCADBundle(namespaceOpenSCADBundle({...input,files:[...input.files,{...file('unused.scad','cube(9);'),sha256:'0'.repeat(64)}]}))).rejects.toThrow('SHA-256');
 await expect(importOpenSCADBundle(namespaceOpenSCADBundle({...input,files:[...input.files,file('unused.scad',' '.repeat(OPENSCAD_BUNDLE_LIMITS.originalBytes))]}))).rejects.toMatchObject({code:'resource-limit'});
 await expect(importOpenSCADBundle(namespaceOpenSCADBundle({...input,files:[input.files[0]]}))).rejects.toThrow('missing');
 for(const ref of ['../../../parts/constants.scad','/parts/constants.scad','https://example.com/constants.scad'])await expect(importOpenSCADBundle(namespaceOpenSCADBundle({...input,files:[file('demo/root.scad',`include <${ref}>cube(1);`),input.files[1]]}))).rejects.toThrow();
});
it('resolves the real reviewed archive package and retains the next actual parent_module refusal',async()=>{
 const corpus=JSON.parse(readFileSync('library/corpus/manifest.json','utf8')),r=corpus.repositories.find((r:{id:string})=>r.id==='adrien-delhorme--openscad-new-dimensions');
 expect(r.commit).toBe('d37828e26df6067fbd872e8e291c6b0b19298243');
 const paths=['demo/demo.scad','constants.scad','dimensions.scad','line.scad','angle.scad','label.scad'];
 const files=paths.map(path=>{const f=r.files.find((f:{path:string})=>f.path===path),b=readFileSync(`library/corpus/repos/${r.id}/${path}`);expect(f.spdx).toBe('MIT');expect(sha(b)).toBe(f.sha256);expect(b.length).toBe(f.size_bytes);return{path,source:b.toString(),sha256:f.sha256};});
 await expect(importOpenSCADBundle(namespaceOpenSCADBundle({namespace:'openscad-new-dimensions',rootPath:'demo/demo.scad',files}))).rejects.toMatchObject({code:'unsupported-feature',path:'openscad-new-dimensions/label.scad',line:21,column:32,detail:expect.stringContaining('parent_module')});
});
