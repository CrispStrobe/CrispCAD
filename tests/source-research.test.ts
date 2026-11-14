// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {loadCodeCorpus} from '../scripts/load-code-corpus.mjs';
const run=promisify(execFile);
it('reads reviewed library manifests through archived local paths and exact hashes',async()=>{
 const parts=(await Promise.all(['seed-catalogue','fixtures-manifest','examples-manifest'].map(name=>loadCodeCorpus(`library/${name}.json`)))).flat();expect(parts).toHaveLength(38);for(const part of parts)expect(createHash('sha256').update(await readFile(part.file)).digest('hex')).toBe(part.sha256);expect(parts.find(p=>p.id==='threads-scad-demo')?.format).toBe('openscad');
});
it('deduplicates research input, samples deterministically, and reports without copying source into its output',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cad-research-test-'));try{const source='cube(10);',hash=createHash('sha256').update(source).digest('hex'),row={id:'synthetic-own-fixture',dataset:'synthetic',revision:'test',rowIndex:0,fileIndex:0,source,sourceBytes:source.length,sourceSha256:hash,license:'BSD-3-Clause',filename:'cube.scad'},input=join(folder,'input.jsonl'),report=join(folder,'report.json');await writeFile(input,[JSON.stringify(row),JSON.stringify({...row,id:'duplicate',rowIndex:1})].join('\n')+'\n');const {stdout}=await run(process.execPath,['scripts/research/probe-corpus.mjs','--input',input,'--report',report,'--limit','10','--geometry']);expect(JSON.parse(stdout)).toMatchObject({inputRows:2,uniqueFiles:1,sampleFiles:1,statuses:{converted:1}});const data=JSON.parse(await readFile(report,'utf8'));expect(data.researchOnly).toBe(true);expect(data.results[0].source).toBeUndefined();expect(data.results[0].converter.geometry.volumeMm3).toBeCloseTo(1000);expect(data.converterBuild.artifacts['code-interchange.js']).toMatch(/^[a-f0-9]{64}$/);expect(data.converterBuild.artifacts['code-loft.js']).toBe(createHash('sha256').update(await readFile('packages/core/dist/code-loft.js')).digest('hex'));
 }finally{await rm(folder,{recursive:true,force:true});}
},20000);
it.skipIf(!process.env.BW_CAD_SYNTAX_ORACLE)('uses the optional external Rust binary only as a syntax oracle',async()=>{
 // The CLI consumes stdin, so exercise it with a bounded child directly.
 const {spawnSync}=await import('node:child_process');const valid=spawnSync(process.env.BW_CAD_SYNTAX_ORACLE!,[],{input:JSON.stringify({source:'module a(){cube(10);} a();',repeat:3}),encoding:'utf8',timeout:3000});expect(JSON.parse(valid.stdout)).toMatchObject({ok:true,oracle:'openscad-rs',statements:2});const invalid=spawnSync(process.env.BW_CAD_SYNTAX_ORACLE!,[],{input:JSON.stringify({source:'cube([1,2);'}),encoding:'utf8',timeout:3000});expect(JSON.parse(invalid.stdout)).toMatchObject({ok:false,kind:'parse'});
});
