// SPDX-License-Identifier: BSD-3-Clause
import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createCodeHost} from '../apps/mcp/host.mjs';
import {readPortableHistory} from '@brickwright/cad-history';

const cleanups:(()=>Promise<unknown>|unknown)[]=[];
afterEach(async()=>{while(cleanups.length)await cleanups.pop()!();});

it('lists the shared command vocabulary with typed arguments',async()=>{
 const host=await createCodeHost();cleanups.push(()=>host.dispose());
 expect(host.definitions.find((d:any)=>d.name==='cad_run_commands').annotations.readOnlyHint).toBe(false);
 expect(host.definitions.find((d:any)=>d.name==='cad_list_commands').annotations.readOnlyHint).toBe(true);
 const all=(await host.call('cad_list_commands',{})).commands,headless=(await host.call('cad_list_commands',{headlessOnly:true})).commands;
 expect(all.find((c:any)=>c.name==='box')).toMatchObject({aliases:['b'],editsModel:true,headless:true,usage:'box [width,depth,height] [center]'});
 expect(all.find((c:any)=>c.name==='box').arguments[0]).toMatchObject({name:'size',kind:'vector'});
 expect(all.some((c:any)=>c.name==='top')).toBe(true);expect(headless.some((c:any)=>c.name==='top')).toBe(false);
 expect(headless.every((c:any)=>c.headless)).toBe(true);
},30000);

it('runs registry commands headlessly as one validated history step',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cad-mcp-commands-')),path=join(folder,'project.bcad');cleanups.push(()=>rm(folder,{recursive:true,force:true}));
 const host=await createCodeHost({project:path});cleanups.push(()=>host.dispose());
 const {revision}=await host.call('cad_get_model');const before=await readFile(path);
 const script='// a plate and a peg\nbox 40,30,4\ncylinder 3 10 0,0,9\nselect "Box"\nmove 0,0,0 @0,0,1\nlist';
 const preview=await host.call('cad_run_commands',{commands:script,expectedRevision:revision,preview:true});
 expect(preview.committed).toBe(false);expect(preview.geometry.bodies).toHaveLength(2);expect(await readFile(path)).toEqual(before);
 const run=await host.call('cad_run_commands',{commands:script,expectedRevision:revision});
 expect(run.committed).toBe(true);expect(run.revision).toBe(revision+1);expect(run.objects.map((o:any)=>o.kind)).toEqual(['box','cylinder']);
 expect(run.results.map((r:any)=>r.command)).toEqual(['box','cylinder','select','move','list']);expect(run.results.at(-1).output).toContain('Box');
 expect(run.journal).toContain('return move([0, 0, 3], box(40, 30, 4));');
 const history=await readPortableHistory(await readFile(path));expect(history.revisions).toHaveLength(2);expect(history.revisions.at(-1)!.label).toBe('Run commands');
 // Read-only scripts commit nothing; stale revisions and editor-only commands are refused without changes.
 const listed=await host.call('cad_run_commands',{commands:'list\nhelp box',expectedRevision:run.revision});expect(listed.committed).toBe(false);expect(listed.revision).toBe(run.revision);
 await expect(host.call('cad_run_commands',{commands:'box 1,1,1',expectedRevision:revision})).rejects.toThrow('Stale');
 await expect(host.call('cad_run_commands',{commands:'box 1,1,1\ntop',expectedRevision:run.revision})).rejects.toMatchObject({line:2,message:expect.stringMatching(/interactive editor/)});
 await expect(host.call('cad_run_commands',{commands:Array(65).fill('list').join('\n'),expectedRevision:run.revision})).rejects.toThrow(/at most 64/);
 await expect(host.call('cad_run_commands',{commands:'box 1,1,1',expectedRevision:run.revision,extra:true})).rejects.toThrow(/Unknown argument/);
 expect((await host.call('cad_get_model')).revision).toBe(run.revision);expect((await readPortableHistory(await readFile(path))).revisions).toHaveLength(2);
},60000);

it('offers the same vocabulary through the headless CLI',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cad-cli-')),path=join(folder,'cli.bcad');cleanups.push(()=>rm(folder,{recursive:true,force:true}));
 const cli=(...args:string[])=>promisify(execFile)(process.execPath,[resolve('apps/cli/crispcad.mjs'),...args]);
 const run=JSON.parse((await cli('run',path,'box 10,10,10','sphere 3 20,0,3')).stdout);
 expect(run.committed).toBe(true);expect(run.objects).toHaveLength(2);
 const inspected=JSON.parse((await cli('inspect',path)).stdout);expect(inspected.bodies[0].volumeMm3).toBeCloseTo(1000,6);
 const dry=JSON.parse((await cli('run',path,'box 1,1,1','--dry-run')).stdout);expect(dry.committed).toBe(false);
 expect((await readPortableHistory(await readFile(path))).revisions).toHaveLength(2);
 await expect(cli('run',path,'fit')).rejects.toMatchObject({stderr:expect.stringMatching(/interactive editor/)});
},60000);
