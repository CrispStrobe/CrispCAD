// SPDX-License-Identifier: BSD-3-Clause
// Phase 6.5 over MCP and the CLI: cad_split_body (one saved step), and the read-only
// cad_inspect_materials, cad_surface_blends and cad_step_evidence, also as registry commands
// inside cad_run_commands and as CLI verbs.
import {afterEach,expect,it} from 'vitest';
import {execFile} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {createCodeHost} from '../apps/mcp/host.mjs';

const cleanups:(()=>Promise<unknown>|unknown)[]=[];
afterEach(async()=>{while(cleanups.length)await cleanups.pop()!();});
async function fixture(){
 const host=await createCodeHost();cleanups.push(()=>host.dispose());
 const {revision}=await host.call('cad_get_model');
 const block=await host.call('cad_create_code_object',{source:'return subtract(box(40,30,20), cylinder(5,40,64));',name:'Block',expectedRevision:revision});
 return {host,id:block.objectId,revision:block.revision};
}

it('splits a body over MCP in one saved step, previews without saving, and refuses stale revisions',async()=>{
 const {host,id,revision}=await fixture();
 const preview=await host.call('cad_split_body',{objectId:id,normal:[0,0,1],offset:0,expectedRevision:revision,preview:true});
 expect(preview).toMatchObject({committed:false,revision});
 expect(preview.results[0].invocation).toBe(`split ${id} z 0`);
 const done=await host.call('cad_split_body',{objectId:id,normal:[0,0,1],offset:0,expectedRevision:revision});
 expect(done.committed).toBe(true);
 expect(done.objects.map((o:any)=>o.kind)).toEqual(['split','split']);
 expect(done.objects.map((o:any)=>o.name)).toEqual(['Block (+ side)','Block (− side)']);
 const halves=done.geometry.bodies.map((b:any)=>b.volumeMm3);
 expect(halves[0]).toBeCloseTo(halves[1],6);
 const measured=await host.call('cad_measure_exact',{});
 expect(measured.bodies[0].volume).toBeCloseTo((40*30-Math.PI*25)*10,6);
 await expect(host.call('cad_split_body',{objectId:id,normal:[0,0,1],expectedRevision:revision})).rejects.toThrow(/Stale model revision/);
 const {revision:latest}=await host.call('cad_get_model');
 await expect(host.call('cad_split_body',{objectId:done.objects[0].id,normal:[0,0,1],offset:50,expectedRevision:latest})).rejects.toThrow(/Nothing of the body lies/);
},120000);

it('inspects materials, surface blends and STEP evidence without changing the model',async()=>{
 const {host,id,revision}=await fixture();
 for(const name of ['cad_inspect_materials','cad_surface_blends','cad_step_evidence'])expect(host.definitions.find((d:any)=>d.name===name).annotations.readOnlyHint).toBe(true);
 const materials=await host.call('cad_inspect_materials',{exact:true});
 expect(materials.bodies[0]).toMatchObject({id,geometry:'exact',material:'unassigned',densityKgM3:1050});
 expect(materials.bodies[0].volumeMm3).toBeCloseTo((40*30-Math.PI*25)*20,6);
 expect(materials.text).toMatch(/By colour/);
 const filleted=await host.call('cad_run_commands',{commands:`fillet 1.5 ${id}`,expectedRevision:revision});
 expect(filleted.committed).toBe(true);
 const blends=await host.call('cad_surface_blends',{});
 const body=blends.bodies[0];
 expect(body.blends.length).toBeGreaterThan(0);
 expect(body.blends.every((b:any)=>b.mark===undefined)).toBe(true);
 expect(body.blends.filter((b:any)=>b.kind==='round'||b.kind==='fillet').every((b:any)=>Math.abs(b.radiusMm-1.5)<1e-9)).toBe(true);
 expect(body.authored[0]).toMatchObject({operation:'fillet',sizeMm:1.5});
 expect(body.authored[0].matched).toBeGreaterThan(0);
 const marked=await host.call('cad_surface_blends',{includeMarks:true});
 expect(marked.bodies[0].blends[0].mark.triangles.length).toBeGreaterThan(0);
 const evidence=await host.call('cad_step_evidence',{});
 expect(evidence.roundTrip.pass).toBe(true);
 expect(evidence.bodies[0].valid).toBe(true);
 const exported=await host.call('cad_export_step',{});
 const file=await host.call('cad_step_evidence',{base64:exported.base64,name:'block.step'});
 expect(file.file.name).toBe('block.step');
 expect(file.bodies[0].volumeMm3).toBeCloseTo(evidence.bodies[0].volumeMm3,6);
 expect(file.roundTrip).toBeUndefined();
 await expect(host.call('cad_step_evidence',{base64:'U09MSUQ=',name:'x.stl'})).rejects.toThrow(/not a STEP file/);
 const after=(await host.call('cad_get_model')).revision;
 const run=await host.call('cad_run_commands',{commands:'materials all\nblends all\nevidence step all',expectedRevision:after});
 expect(run.committed).toBe(false);
 expect(run.results.map((r:any)=>r.command)).toEqual(['materials','blends','evidence']);
 expect(run.results[2].output).toMatch(/Round trip: every body reads back/);
 expect((await host.call('cad_get_model')).revision).toBe(after);
},180000);

it('serves the inspections as CLI verbs, also in German',async()=>{
 const {host,id,revision}=await fixture();
 await host.call('cad_split_body',{objectId:id,normal:[1,0,0],offset:0,expectedRevision:revision});
 const directory=await mkdtemp(join(tmpdir(),'crispcad-6-5-'));cleanups.push(()=>rm(directory,{recursive:true,force:true}));
 const project=join(directory,'part.bcad'),exported=await host.call('cad_export_project'),model=await host.call('cad_get_model');
 // The two sides touch, so one STEP file would merge them: export one side.
 const step=await host.call('cad_export_step',{objectIds:[model.objects[0].id]});
 await writeFile(project,Buffer.from(exported.base64,'base64'));
 const stepFile=join(directory,'part.step');await writeFile(stepFile,Buffer.from(step.base64,'base64'));
 await host.dispose();
 const cli=resolve('apps/cli/crispcad.mjs'),exec=promisify(execFile);
 const materials=JSON.parse((await exec(process.execPath,[cli,'materials',project])).stdout);
 expect(materials.bodies).toHaveLength(2);
 const evidence=JSON.parse((await exec(process.execPath,[cli,'evidence',project,stepFile])).stdout);
 expect(evidence.bodies).toHaveLength(1);
 const roundTrip=JSON.parse((await exec(process.execPath,[cli,'evidence',project])).stdout);
 expect(roundTrip.roundTrip.bodies).toHaveLength(2);expect(roundTrip.roundTrip.pass).toBe(true);
 expect(evidence.file.sha256).toMatch(/^[0-9a-f]{64}$/);
 const german=JSON.parse((await exec(process.execPath,[cli,'evidence',project,'--locale','de'])).stdout);
 expect(german.text).toMatch(/Rundreise: jeder Körper/);
 const blends=JSON.parse((await exec(process.execPath,[cli,'blends',project])).stdout);
 expect(blends.bodies).toHaveLength(2);
},180000);
