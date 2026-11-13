// SPDX-License-Identifier: BSD-3-Clause
// Compiled artifacts remain outside the app; see README.md for build commands.
import {createServer} from 'node:http';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium,webkit,devices} from '@playwright/test';
const root=resolve(process.argv[2]??'/tmp/brickwright-cad-constraint-bench');
const output=resolve(process.argv[3]??'/tmp/cad-constraint-browser-results.json');
const worker=`
const started=performance.now();
(async()=>{
 try {
  if(new URL(location.href).searchParams.get('backend')==='wasm'){
   const {compileStreaming}=await import('./bench.mjs');
   const app=await compileStreaming(fetch('./bench.wasm'));const instance=await app.instantiate({});instance.invokeMain();
  }else {importScripts('./bench.js');}
  if(typeof globalThis.cadConstraintBenchmark!=='function')throw Error('Benchmark export missing');
  postMessage({ready:true,startupMs:performance.now()-started});
  onmessage=({data})=>{try{const t=performance.now();const result=JSON.parse(globalThis.cadConstraintBenchmark(data.kind,data.size,data.samples));postMessage({result,workerRoundtripMs:performance.now()-t});}catch(e){postMessage({error:String(e)});}};
 }catch(e){postMessage({error:String(e)});}
})();`;
const allowed=new Set(['bench.js','bench.wasm','bench.mjs']);
const server=createServer(async(req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname.slice(1);
 if(name==='worker.js'){res.setHeader('Content-Type','text/javascript');res.end(worker);return;}
 if(!name){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Local constraint benchmark</title>');return;}
 if(!allowed.has(name)){res.writeHead(404);res.end();return;}
 try{res.setHeader('Content-Type',name.endsWith('.wasm')?'application/wasm':'text/javascript');res.end(await readFile(join(root,name)));}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const results={recordedAt:new Date().toISOString(),runtime:process.version,platform:process.platform,arch:process.arch,dart:'3.12.2',solverCommit:'13f2b04925443a75b6766c969b10aefc65978a0e',samples:7,warmups:2,artifacts:{},runs:[]};
for(const name of allowed)results.artifacts[name]=(await stat(join(root,name))).size;
try{
 for(const [name,type,options] of [['chromium',chromium,{}],['ipad-webkit',webkit,devices['iPad Pro 11']]]){
  const browser=await type.launch({headless:true});
  try {const page=await browser.newPage(options);await page.goto(url);const userAgent=await page.evaluate(()=>navigator.userAgent);
   for(const backend of ['js','wasm'])for(const [kind,size] of [['linear-chain',10],['linear-chain',100],['linear-chain',500],['circle-line',1],['circle-line',10],['circle-line',50],['free-chain',10],['free-chain',50],['free-chain',100]]){
    const run=await page.evaluate(({backend,kind,size})=>new Promise(resolve=>{
      const t=performance.now(),w=new Worker(`/worker.js?backend=${backend}`);let startupMs;
      const timer=setTimeout(()=>{w.terminate();resolve({error:'30-second worker deadline exceeded'});},30000);
      const done=value=>{clearTimeout(timer);w.terminate();resolve(value);};
      w.onerror=e=>done({error:e.message});w.onmessage=({data})=>{if(data.error)return done(data);if(data.ready){startupMs=data.startupMs;w.postMessage({kind,size,samples:7});}else done({...data,startupMs,totalRequestMs:performance.now()-t});};
    }),{backend,kind,size});
    const record={browser:name,browserVersion:browser.version(),userAgent,backend,kind,size,...run};results.runs.push(record);console.log(JSON.stringify(record));
   }
  }finally{await browser.close();}
 }
}finally{server.close();await writeFile(output,JSON.stringify(results,null,2)+'\n');}
console.log(`Saved ${output}`);
