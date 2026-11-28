// SPDX-License-Identifier: BSD-3-Clause
// The manufacturing check over MCP (cad_check_manufacturing), as a registry command inside
// cad_run_commands, and through the CLI's manufacturing verb: read-only, exact where possible.
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
 const pocket=await host.call('cad_create_code_object',{source:'return subtract(box(70,50,20), extrudeProfile(11, offset2d(2.5, true, 32, rectangle2d(35,25,true))));',name:'Pocket',expectedRevision:revision});
 return {host,id:pocket.objectId,revision:pocket.revision};
}

it('cad_check_manufacturing measures corner fillets on the exact B-rep and changes nothing',async()=>{
 const {host,id,revision}=await fixture();
 expect(host.definitions.find((d:any)=>d.name==='cad_check_manufacturing').annotations.readOnlyHint).toBe(true);
 const report=await host.call('cad_check_manufacturing',{process:'cnc'});
 expect(report.revision).toBe(revision);
 expect(report.verdict).toBe('fail');
 expect(report.kernel).toMatch(/^smlib · @crispcad\/exact-kernel 0\.1\.11$/);
 const body=report.bodies[0];
 expect(body).toMatchObject({id,geometry:'exact'});
 const corners=body.checks.find((c:any)=>c.id==='cnc.internal-corners');
 expect(corners).toMatchObject({status:'fail',geometry:'exact'});
 expect(corners.findings).toHaveLength(4);
 expect(corners.findings[0].mark).toBeUndefined();
 expect(corners.findings[0].faces).toHaveLength(1);
 expect(report.text).toContain('Internal corner radius [exact B-rep]');
 const withMarks=await host.call('cad_check_manufacturing',{process:'cnc',toolDiameterMm:4,includeMarks:true});
 expect(withMarks.bodies[0].checks[0].findings[0].mark.triangles.length).toBeGreaterThan(0);
 const mesh=await host.call('cad_check_manufacturing',{process:'cnc',exact:false});
 expect(mesh.bodies[0]).toMatchObject({geometry:'mesh',reason:'exact geometry not requested'});
 await expect(host.call('cad_check_manufacturing',{process:'cnc',approachAxes:['+w']})).rejects.toThrow(/Invalid approachAxes|approach axes/);
 expect((await host.call('cad_get_model')).revision).toBe(revision);
},120000);

it('runs check as a registry command and through the CLI',async()=>{
 const {host,revision}=await fixture();
 const run=await host.call('cad_run_commands',{commands:'check cnc all --tool 4',expectedRevision:revision});
 expect(run.committed).toBe(false);
 expect(run.results[0]).toMatchObject({command:'check',edited:false,invocation:'check cnc all --tool 4'});
 expect(run.results[0].output).toMatch(/warn +Internal corner radius \[exact B-rep\]/);
 const directory=await mkdtemp(join(tmpdir(),'crispcad-manufacturing-'));cleanups.push(()=>rm(directory,{recursive:true,force:true}));
 const project=join(directory,'part.bcad'),exported=await host.call('cad_export_project');
 await writeFile(project,Buffer.from(exported.base64,'base64'));
 await host.dispose();
 const cli=resolve('apps/cli/crispcad.mjs'),exec=promisify(execFile);
 const report=JSON.parse((await exec(process.execPath,[cli,'manufacturing',project,'--process','cnc','--tool','6','--axes','+z'])).stdout);
 expect(report.verdict).toBe('fail');
 expect(report.bodies[0].checks.map((c:any)=>c.id)).toEqual(['cnc.internal-corners','cnc.pocket-depth','cnc.dogbones','cnc.undercuts','cnc.min-wall','edges.radius']);
 const german=JSON.parse((await exec(process.execPath,[cli,'manufacturing',project,'--process','laser','--locale','de'])).stdout);
 expect(german.bodies[0].checks[0]).toMatchObject({id:'laser.sheet',status:'fail',label:'Ebenes Blech'});
},120000);
