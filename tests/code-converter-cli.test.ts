// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {readPortableHistory} from '@brickwright/cad-history';
const run=promisify(execFile);
it('writes a history-inclusive project with separate outputs/colours and source provenance, without overwriting files',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cad-source-convert-'));try{const out=join(folder,'booleans.bcad'),args=['scripts/convert-code.mjs','tests/fixtures/code-corpus/jscad/basicBooleans.js','--to','bcad','--out',out];const {stdout}=await run(process.execPath,args),report=JSON.parse(stdout);expect(report.ok).toBe(true);expect(report.outputs).toBe(5);const bytes=await readFile(out),archive=await readPortableHistory(bytes),doc=archive.readDocument(archive.project.headId);expect(archive.revisions).toHaveLength(1);expect(doc.roots).toHaveLength(5);expect(doc.nodes[doc.roots[0]].color).toBe('#ff0000');expect(doc.nodes[doc.roots[1]].color).toBe('#00ff00');const sidecar=JSON.parse(await readFile(out+'.conversion.json','utf8'));expect(sidecar.originalSource).toContain('@licence MIT License');expect(sidecar.input.sha256).toBe(createHash('sha256').update(sidecar.originalSource).digest('hex'));await expect(run(process.execPath,args)).rejects.toMatchObject({code:2});expect(await readFile(out)).toEqual(bytes);
 }finally{await rm(folder,{recursive:true,force:true});}
},20000);
it('runs the small pinned corpus, validates hashes and reports actual geometry and known gaps distinctly',async()=>{
 const {stdout}=await run(process.execPath,['scripts/check-code-corpus.mjs']);const report=JSON.parse(stdout);expect(report.converted).toBe(6);expect(report.unsupported).toBe(3);expect(report.failed).toBe(0);expect(report.unexpected).toBe(0);expect(report.results.find((r:any)=>r.id==='jscad-gear').geometry.volumeMm3).toBeGreaterThan(0);expect(report.results.find((r:any)=>r.id==='jscad-nutsAndBolts').error.message).toContain('extrudeFromSlices');
 const manifest=JSON.parse(await readFile('tests/fixtures/code-corpus/manifest.json','utf8'));for(const item of manifest.models){expect(['MIT','BSD-2-Clause']).toContain(item.license);const data=await readFile('tests/fixtures/code-corpus/'+item.file);expect(createHash('sha256').update(data).digest('hex')).toBe(item.sha256);expect((await readFile('tests/fixtures/code-corpus/'+item.licenseFile,'utf8')).length).toBeGreaterThan(500);}
},20000);
it('distinguishes invalid input from a known unsupported language feature in JSON diagnostics',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cad-bad-source-'));try{const file=join(folder,'bad.scad');const {writeFile}=await import('node:fs/promises');await writeFile(file,'cube([1,2);');try{await run(process.execPath,['scripts/convert-code.mjs',file]);throw Error('Expected failure');}catch(error:any){expect(JSON.parse(error.stdout).error.code).toBe('invalid-source');}await writeFile(file,'minkowski(){cube(2);sphere(1);}');try{await run(process.execPath,['scripts/convert-code.mjs',file]);throw Error('Expected failure');}catch(error:any){expect(JSON.parse(error.stdout).error.code).toBe('unsupported-feature');}
 }finally{await rm(folder,{recursive:true,force:true});}
});
