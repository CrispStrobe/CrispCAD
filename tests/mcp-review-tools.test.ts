// SPDX-License-Identifier: BSD-3-Clause
import {afterEach,expect,it} from 'vitest';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {inflateSync} from 'node:zlib';
import {createCodeHost} from '../apps/mcp/host.mjs';

const cleanups:(()=>Promise<unknown>|unknown)[]=[];
afterEach(async()=>{while(cleanups.length)await cleanups.pop()!();});
async function twoBoxes(offset:number){
 const host=await createCodeHost();cleanups.push(()=>host.dispose());
 let {revision}=await host.call('cad_get_model');
 const a=await host.call('cad_create_code_object',{source:'return box(10, 10, 10);',name:'A',expectedRevision:revision});
 const b=await host.call('cad_create_code_object',{source:`return move([${offset}, 0, 0], box(10, 10, 10));`,name:'B',expectedRevision:a.revision});
 return {host,a:a.objectId,b:b.objectId};
}
// PNG decode just far enough to count non-background pixels.
function paintedPixels(base64:string){const png=Buffer.from(base64,'base64');expect(png.subarray(1,4).toString()).toBe('PNG');const width=png.readUInt32BE(16),height=png.readUInt32BE(20);let offset=8;const idat:Buffer[]=[];while(offset<png.length){const length=png.readUInt32BE(offset),type=png.subarray(offset+4,offset+8).toString();if(type==='IDAT')idat.push(png.subarray(offset+8,offset+8+length));offset+=12+length;}const raw=inflateSync(Buffer.concat(idat));let painted=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(width*4+1)+1+x*4;if(raw[i]!==238||raw[i+1]!==242||raw[i+2]!==247)painted++;}return {width,height,painted};}

it('cad_inspect measures volume, area, centroid and topology per body',async()=>{
 const {host,a,b}=await twoBoxes(30),report=await host.call('cad_inspect',{});
 expect(report.objects.map((o:any)=>o.id)).toEqual([a,b]);
 const body=report.bodies.find((x:any)=>x.id===b);
 expect(body.volumeMm3).toBeCloseTo(1000,6);expect(body.surfaceAreaMm2).toBeCloseTo(600,6);expect(body.centroidMm[0]).toBeCloseTo(30,6);expect(body.sizeMm).toEqual([10,10,10]);expect(body.topology.watertight).toBe(true);
 expect((await host.call('cad_inspect',{objectIds:[a]})).bodies).toHaveLength(1);
 await expect(host.call('cad_inspect',{objectIds:['missing']})).rejects.toThrow(/Unknown object/);
},60000);

it('cad_check_interference reports overlaps and near misses',async()=>{
 const overlapping=await twoBoxes(5),result=await overlapping.host.call('cad_check_interference',{});
 expect(result.interfering).toHaveLength(1);expect(result.interfering[0].volumeMm3).toBeCloseTo(500,3);
 const near=await twoBoxes(10.5);
 expect((await near.host.call('cad_check_interference',{})).interfering).toEqual([]);
 const gap=(await near.host.call('cad_check_interference',{clearanceMm:1})).closerThanClearance;
 expect(gap).toHaveLength(1);expect(gap[0].gapMm).toBeCloseTo(0.5,3);
},60000);

it('cad_render returns PNG views through the stdio server as image content',async()=>{
 const child=spawn(process.execPath,[resolve('apps/mcp/server.mjs')],{stdio:['pipe','pipe','pipe']}),pending=new Map<number,(v:any)=>void>();let sequence=0,buffer='';cleanups.push(()=>child.kill());
 child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{buffer+=data;let end;while((end=buffer.indexOf('\n'))>=0){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);pending.get(message.id)?.(message);}});
 const request=(method:string,params?:unknown)=>new Promise<any>(done=>{const id=++sequence;pending.set(id,done);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 await request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 const {revision}=(await request('tools/call',{name:'cad_get_model',arguments:{}})).result.structuredContent;
 await request('tools/call',{name:'cad_create_code_object',arguments:{source:'return box(40, 20, 10);',expectedRevision:revision}});
 const rendered=(await request('tools/call',{name:'cad_render',arguments:{views:['top','front'],size:128}})).result;
 expect(rendered.isError).toBe(false);expect(rendered.structuredContent.views).toEqual(['top','front']);
 const images=rendered.content.filter((c:any)=>c.type==='image');expect(images).toHaveLength(2);expect(images[0].mimeType).toBe('image/png');
 // A 40×20 box fills 90 % of the frame along X: the top view is about half as tall as wide; the front view a quarter.
 const top=paintedPixels(images[0].data),front=paintedPixels(images[1].data);
 expect(top.width).toBe(128);expect(top.painted/(128*128)).toBeCloseTo(0.9*0.45,1);expect(front.painted/(128*128)).toBeCloseTo(0.9*0.225,1);
 const bad=(await request('tools/call',{name:'cad_render',arguments:{views:['sideways']}})).result;expect(bad.isError).toBe(true);
},60000);
