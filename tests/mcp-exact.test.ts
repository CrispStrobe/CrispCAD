// SPDX-License-Identifier: BSD-3-Clause
// MCP and CLI front ends of the exact kernel: cad_export_step, cad_measure_exact, and the
// registry commands `export step` / `measure exact` inside cad_run_commands.
import {afterEach,expect,it} from 'vitest';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {createCodeHost} from '../apps/mcp/host.mjs';

const cleanups:(()=>Promise<unknown>|unknown)[]=[];
afterEach(async()=>{while(cleanups.length)await cleanups.pop()!();});
async function fixture(){
 const host=await createCodeHost();cleanups.push(()=>host.dispose());
 const {revision}=await host.call('cad_get_model');
 const a=await host.call('cad_create_code_object',{source:'return box(10, 10, 10);',name:'A',expectedRevision:revision});
 const b=await host.call('cad_create_code_object',{source:'return move([30, 0, 0], cylinder(5, 10, 64));',name:'B',expectedRevision:a.revision});
 return {host,a:a.objectId,b:b.objectId,revision:b.revision};
}

it('cad_measure_exact and cad_export_step use the exact kernel, never a mesh',async()=>{
 const {host,a,b}=await fixture();
 expect(host.definitions.find((d:any)=>d.name==='cad_export_step').annotations.readOnlyHint).toBe(true);
 const measured=await host.call('cad_measure_exact',{});
 expect(measured.kernel).toMatchObject({id:'smlib',package:'@crispcad/exact-kernel',version:'0.1.10'});
 expect(measured.bodies.map((body:any)=>body.id)).toEqual([a,b]);
 expect(Math.abs(measured.bodies[1].volume-Math.PI*250)).toBeLessThan(1e-9);
 const step=await host.call('cad_export_step',{objectIds:[b]});
 expect(step).toMatchObject({name:'Coded project.step',mime:'model/step',bodies:[{id:b,name:'B'}]});
 expect(Buffer.from(step.base64,'base64').toString()).toMatch(/^ISO-10303-21;[\s\S]*CYLINDRICAL_SURFACE/);
 await expect(host.call('cad_export_step',{objectIds:['missing']})).rejects.toThrow(/Unknown object id/);
},120000);

it('runs export step and measure exact as registry commands, with diagnostics naming the feature',async()=>{
 const {host,revision}=await fixture();
 const run=await host.call('cad_run_commands',{commands:'measure exact "A"\nexport step all',expectedRevision:revision});
 expect(run.committed).toBe(false);
 expect(run.results[0]).toMatchObject({command:'measure',edited:false,kernel:{id:'smlib'}});
 expect(run.results[0].output).toMatch(/A \(.+\): volume 1000 mm³ · area 600 mm²/);
 expect(run.results[1].file).toMatchObject({name:'Coded project.step',mime:'model/step'});
 const minkowski=await host.call('cad_create_code_object',{source:'return minkowski(box(4, 4, 4), sphere(1, 24));',name:'Rounded',expectedRevision:revision});
 await expect(host.call('cad_run_commands',{commands:'export step "Rounded"',expectedRevision:minkowski.revision})).rejects.toThrow(/Line 1: Rounded \(code\): minkowski has no exact lowering/);
 await expect(host.call('cad_export_step',{})).rejects.toThrow(/Rounded \(code\)/);
},120000);

it('the CLI writes STEP files through the same host',async()=>{
 const {host}=await fixture();
 const directory=await mkdtemp(join(tmpdir(),'crispcad-exact-'));cleanups.push(()=>rm(directory,{recursive:true,force:true}));
 const project=join(directory,'part.bcad'),exported=await host.call('cad_export_project');
 const {writeFile}=await import('node:fs/promises');await writeFile(project,Buffer.from(exported.base64,'base64'));
 await host.dispose();
 const cli=resolve('apps/cli/crispcad.mjs'),run=promisify(execFile);
 const step=JSON.parse((await run(process.execPath,[cli,'step',project,join(directory,'part.step')])).stdout);
 expect(step.bodies).toHaveLength(2);
 expect((await readFile(join(directory,'part.step'),'utf8')).startsWith('ISO-10303-21;')).toBe(true);
 const measure=JSON.parse((await run(process.execPath,[cli,'measure',project])).stdout);
 expect(measure.bodies[0].volume).toBeCloseTo(1000,9);
 const commands=JSON.parse((await run(process.execPath,[cli,'run',project,'export step all','--out',directory])).stdout);
 expect(commands.results[0].file).toMatchObject({name:'Coded project.step',path:join(directory,'Coded project.step')});
},180000);
