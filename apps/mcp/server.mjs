#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
import {createCodeHost} from './host.mjs';
const args=process.argv.slice(2);let project;
for(let i=0;i<args.length;i++){if(args[i]==='--project'&&args[i+1])project=args[++i];else if(args[i]==='--help'){process.stderr.write('Brickwright CAD MCP (stdio)\nnode apps/mcp/server.mjs [--project /absolute/path/project.bcad]\nBuild the workspace first. GUI and MCP use the same bounded CAD Script compiler.\n');process.exit(0);}else{process.stderr.write(`Unknown argument: ${args[i]}\n`);process.exit(1);}}
let host;try{host=await createCodeHost({project});}catch(error){process.stderr.write(`Cannot open CAD MCP host: ${error.message}\n`);process.exit(1);}
const versions=['2024-11-05','2025-03-26','2025-06-18','2025-11-25'];let negotiated,initialized=false,buffer='',discarding=false,queue=Promise.resolve(),closing=false;
const active=new Map();
const send=message=>new Promise(resolve=>process.stdout.write(JSON.stringify(message)+'\n',()=>resolve()));
const failure=(id,code,message)=>send({jsonrpc:'2.0',id,error:{code,message}});
async function handle(request,controller){const id=request.id;
 if(request.method==='initialize'){if(negotiated)return failure(id,-32600,'Already initialized');if(typeof request.params?.protocolVersion!=='string')return failure(id,-32602,'Missing protocolVersion');negotiated=versions.includes(request.params.protocolVersion)?request.params.protocolVersion:versions.at(-1);return send({jsonrpc:'2.0',id,result:{protocolVersion:negotiated,capabilities:{tools:{listChanged:false}},serverInfo:{name:'brickwright-cad',version:'0.1.0'},instructions:'Call cad_code_help for the CAD language. This server owns a headless project session; it does not attach to a running GUI. Read cad_get_model before mutations and supply expectedRevision. Project files retain every accepted iteration.'}});}
 if(request.method==='ping')return send({jsonrpc:'2.0',id,result:{}});
 if(!initialized)return failure(id,-32000,'Initialize the MCP session first');
 if(request.method==='tools/list'){if(request.params?.cursor)return failure(id,-32602,'Invalid cursor');return send({jsonrpc:'2.0',id,result:{tools:host.definitions}});}
 if(request.method!=='tools/call')return failure(id,-32601,'Method not found');
 const name=request.params?.name;if(!host.definitions.some(t=>t.name===name))return failure(id,-32602,'Unknown tool');
 try{const result=await host.call(name,request.params.arguments??{},controller.signal);await send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(result)}],...(['2025-06-18','2025-11-25'].includes(negotiated)?{structuredContent:result}:{}),isError:false}});}catch(error){await send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:error.message}],isError:true,...(['2025-06-18','2025-11-25'].includes(negotiated)?{structuredContent:{error:error.message,...(Number.isInteger(error.line)?{line:error.line,column:error.column}:{}),...(error.diagnostic?{diagnostic:error.diagnostic}:{})}}:{})}});}
}
function receive(line){let request;try{request=JSON.parse(line);}catch{void failure(null,-32700,'Invalid JSON');return;}
 if(!request||Array.isArray(request)||request.jsonrpc!=='2.0'||typeof request.method!=='string'||request.id!==undefined&&typeof request.id!=='string'&&!Number.isSafeInteger(request.id)){void failure(null,-32600,'Invalid request');return;}
 if(request.id===undefined){if(request.method==='notifications/initialized'&&negotiated)initialized=true;else if(request.method==='notifications/cancelled')active.get(request.params?.requestId)?.abort();return;}
 if(active.has(request.id)){void failure(request.id,-32600,'Duplicate active request id');return;}
 const controller=new AbortController();active.set(request.id,controller);queue=queue.then(()=>handle(request,controller)).catch(error=>process.stderr.write(`MCP request failed: ${error.message}\n`)).finally(()=>active.delete(request.id));
}
process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{if(closing)return;buffer+=chunk;let newline;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!discarding&&Buffer.byteLength(line,'utf8')<=262144&&line.trim())receive(line);else if(!discarding)void failure(null,-32600,'Message exceeds 256 KiB');discarding=false;}if(Buffer.byteLength(buffer,'utf8')>262144){buffer='';discarding=true;void failure(null,-32600,'Message exceeds 256 KiB');}});
async function close(cancel=false){if(closing)return;closing=true;if(cancel)for(const controller of active.values())controller.abort();await queue;await host.dispose();process.stdin.destroy();}
process.stdin.on('end',()=>void close());process.stdin.on('error',()=>void close(true));process.on('SIGINT',()=>void close(true));process.on('SIGTERM',()=>void close(true));process.stdout.on('error',()=>void close(true));
