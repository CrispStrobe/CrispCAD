import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createCodeHost} from '../apps/mcp/host.mjs';
import {defaultCodeProgram} from '@brickwright/cad-core';
import {readPortableHistory} from '@brickwright/cad-history';
const cleanups:Array<()=>Promise<unknown>>=[];afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
it('previews without edits, validates expected revisions and resumes full history from its one configured file',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cad-mcp-')),path=join(folder,'project.bcad');cleanups.push(()=>rm(folder,{recursive:true,force:true}));let host=await createCodeHost({project:path});cleanups.push(()=>host.dispose());const before=await readFile(path),initial=await host.call('cad_get_model');
 const converted=await host.call('cad_convert_code',{inputFormat:'openscad',outputFormat:'cadcode',source:'cube([10,20,30]);'});expect(converted.source).toContain('box');const jscad=await host.call('cad_convert_code',{inputFormat:'jscad',outputFormat:'openscad',source:"const {cube}=require('@jscad/modeling').primitives;module.exports.main=()=>cube({size:3});"});expect(jscad.source).toContain('cube([3, 3, 3]');expect(jscad.evaluatedSnapshot).toBe(true);expect(await readFile(path)).toEqual(before);await expect(host.call('cad_convert_code',{inputFormat:'unsupported',outputFormat:'cadcode',source:'anything'})).rejects.toThrow('Invalid');
 const help=await host.call('cad_code_help');expect(help.examples).toHaveLength(34);expect(help.examples.find((e:any)=>e.id==='washer').source).toContain('subtract');
 const preview=await host.call('cad_preview_code',{source:defaultCodeProgram().source});expect(preview.committed).toBe(false);expect(await readFile(path)).toEqual(before);
 const created=await host.call('cad_create_code_object',{source:defaultCodeProgram().source,expectedRevision:initial.revision});expect(created.objects).toHaveLength(1);
 await expect(host.call('cad_update_code_object',{objectId:created.objectId,parameters:{width:'80'},expectedRevision:initial.revision})).rejects.toThrow('Stale');
 await host.call('cad_update_code_object',{objectId:created.objectId,parameters:{width:'80'},expectedRevision:created.revision});const bytes=await readFile(path),history=await readPortableHistory(bytes);expect(history.revisions).toHaveLength(3);await host.dispose();host=await createCodeHost({project:path});expect((await host.call('cad_get_code_object',{objectId:created.objectId})).program.parameters.width).toBe('80');
 const restored=await host.call('cad_restore_revision',{revisionId:history.revisions[1].id,expectedRevision:history.project.serial});expect(restored.revision).toBe(4);expect((await readPortableHistory(await readFile(path))).revisions).toHaveLength(4);
},30000);
it('refuses competing writers and external changes without modifying the model or pruning history',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cad-mcp-')),path=join(folder,'project.bcad');cleanups.push(()=>rm(folder,{recursive:true,force:true}));const host=await createCodeHost({project:path});cleanups.push(()=>host.dispose());await expect(createCodeHost({project:path})).rejects.toThrow('writer lock');const before=await host.call('cad_get_model');
 await writeFile(path,'external edit');await expect(host.call('cad_create_code_object',{source:'return box(2,3,4);',expectedRevision:before.revision})).rejects.toThrow('outside this session');expect(await host.call('cad_get_model')).toEqual(before);expect(await readFile(path,'utf8')).toBe('external edit');
},30000);
it('runs an actual newline-delimited MCP stdio session with source errors and portable output',async()=>{
 const child=spawn(process.execPath,[resolve('apps/mcp/server.mjs')],{stdio:['pipe','pipe','pipe']}),pending=new Map<number,{resolve:(v:any)=>void;reject:(e:unknown)=>void}>();let sequence=0,buffer='',stderr='';child.stderr.setEncoding('utf8');child.stderr.on('data',data=>stderr+=data);child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{buffer+=data;let end;while((end=buffer.indexOf('\n'))>=0){const response=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);const p=pending.get(response.id);if(p){pending.delete(response.id);p.resolve(response);}}});child.on('exit',code=>{for(const p of pending.values())p.reject(Error(`Exited ${code}: ${stderr}`));});cleanups.push(async()=>{child.stdin.end();await new Promise<void>(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',()=>resolve());});});
 const request=(method:string,params?:unknown)=>new Promise<any>((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 const init=await request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}});expect(init.result.capabilities.tools).toBeDefined();child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');const list=await request('tools/list');expect(list.result.tools.some((t:any)=>t.name==='cad_create_code_object')).toBe(true);
 const model=(await request('tools/call',{name:'cad_get_model',arguments:{}})).result.structuredContent;
 const invalid=await request('tools/call',{name:'cad_create_code_object',arguments:{source:'return process.exit(1);',expectedRevision:model.revision}});expect(invalid.result.isError).toBe(true);
 const result=await request('tools/call',{name:'cad_create_code_object',arguments:{source:defaultCodeProgram().source,expectedRevision:model.revision}});expect(result.result.isError).toBe(false);expect(result.result.structuredContent.objects).toHaveLength(1);
 const exported=await request('tools/call',{name:'cad_export_project',arguments:{}});const archive=await readPortableHistory(Buffer.from(exported.result.structuredContent.base64,'base64'));expect(archive.revisions).toHaveLength(2);expect(stderr).not.toContain('Cannot open');
},30000);
