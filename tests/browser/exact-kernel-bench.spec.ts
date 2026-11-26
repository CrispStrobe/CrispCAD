// SPDX-License-Identifier: BSD-3-Clause
// Exact-kernel latency, memory and main-thread blocking per browser (Playwright WebKit with the
// iPad Pro 11 profile is the iPad proxy). Builds experiments/exact-kernel/browser-bench with Vite,
// serves it cross-origin isolated (for measureUserAgentSpecificMemory), and runs the same exact
// requests twice: in a module worker, as the editor does, and on the page's own thread, as the
// in-thread fallback (and every host before the worker move) does. Opt-in, as it takes minutes:
//   EXACT_BENCH=1 npx playwright test tests/browser/exact-kernel-bench.spec.ts
// writes experiments/exact-kernel/results/browser-bench-<project>.json.
import {expect,test} from '@playwright/test';
import {createServer} from 'node:http';
import type {Server} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createCadSession,createCommandRunner} from '@brickwright/cad-core';
import type {CadDocument,ExactCommandRequest} from '@brickwright/cad-core';
import {createInThreadExactHost,exactKernelIdentity} from '@brickwright/cad-exact';

test.skip(!process.env.EXACT_BENCH,'set EXACT_BENCH=1 to run the exact-kernel browser bench');
const site='test-results/exact-bench-site';
let server:Server,origin='';
const types:Record<string,string>={'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm'};

test.beforeAll(async()=>{
 execFileSync('npx',['vite','build','--config','experiments/exact-kernel/browser-bench/vite.config.ts'],{stdio:'inherit',env:{...process.env,EXACT_BENCH_OUT:join(process.cwd(),site)}});
 server=createServer(async(request,response)=>{
  const path=normalize(decodeURIComponent(new URL(request.url!,'http://x').pathname)).replace(/^(\.\.[/\\])+/,'');
  try{
   const body=await readFile(join(site,path==='/'?'index.html':path));
   response.writeHead(200,{'content-type':types[extname(path)]??'text/html','cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp','cache-control':'no-store'});
   response.end(body);
  }catch{response.writeHead(404);response.end();}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();origin=`http://127.0.0.1:${typeof address==='object'&&address?address.port:0}`;
});
test.afterAll(()=>new Promise<void>(resolve=>server?.close(()=>resolve())));

/** Documents with one exact feature each, built in Node; the browser recomputes their display. */
async function featureDocuments(){
 const host=createInThreadExactHost(),out:{label:string;request:ExactCommandRequest}[]=[];
 const box=()=>{const session=createCadSession(undefined,{kernels:[exactKernelIdentity]});session.add({kind:'box',size:[20,30,10]},{name:'Block'});return session;};
 const feature=async(label:string,session:ReturnType<typeof box>,command:string)=>{
  const result=await createCommandRunner(session,{exact:host}).runAsync(command);
  if(!result.edited)throw new Error(`${command}: ${result.output}`);
  const document=structuredClone(session.state.document) as CadDocument;
  const id=document.roots.find(root=>document.nodes[root].kind==='exact-feature')!;
  delete (document.nodes[id] as {display?:unknown}).display;
  out.push({label,request:{operation:'feature-display',document,bodies:[id]}});
 };
 // The closed-form qualification parts (tests/exact-features.test.ts).
 await feature('fillet r2, all edges of a 20×30×10 box',box(),'fillet 2 Block');
 await feature('chamfer 2, top face',box(),'chamfer 2 Block --face +z');
 await feature('shell 2, open top',box(),'shell 2 Block --open +z');
 // A plate with 48 holes, chamfered on its front face: the top and bottom keep every hole.
 const plate=createCadSession(undefined,{kernels:[exactKernelIdentity]});
 const holes=Array.from({length:48},(_,i)=>`move([${4+i%8*6}, ${4+Math.floor(i/8)*6}, 1.5], cylinder(2, 6, 64))`).join(', ');
 plate.addCode({version:1,language:'brickwright-cad-script',parameters:{},source:`return subtract(move([25, 19, 1.5], box(50, 38, 3)), ${holes});`},'Block');
 await feature('chamfer 0.5, plate with 48 holes',plate,'chamfer 0.5 Block --face -y');
 // The same plate with every top edge rounded, hole rims included: the linear memory grows.
 const rims=createCadSession(undefined,{kernels:[exactKernelIdentity]});
 rims.addCode({version:1,language:'brickwright-cad-script',parameters:{},source:`return subtract(move([25, 19, 1.5], box(50, 38, 3)), ${holes});`},'Block');
 await feature('fillet 0.5, top edges and 48 hole rims',rims,'fillet 0.5 Block --face +z');
 return out;
}

test('exact kernel: first use, features, memory and main-thread blocking, worker against in-thread',async({browser},testInfo)=>{
 test.setTimeout(1_800_000);
 const features=await featureDocuments();
 const measureSession=createCadSession();measureSession.add({kind:'box',size:[10,20,30]},{name:'Block'});
 const first={label:'first use: load + measure exact of a box',request:{operation:'measure' as const,document:measureSession.state.document,bodies:[]}};
 // Everything twice (cold, then warm), except the large rim fillet, which runs once at the end.
 const repeated=features.slice(0,-1),requests=[first,...repeated,...repeated.map(f=>({...f,label:`${f.label} (again)`})),features.at(-1)!];
 const runs:Record<string,unknown>={};
 for(const mode of ['worker','main'] as const){
  // A fresh page per mode, so each pays the first load (compiled modules are not shared).
  const {viewport,userAgent,deviceScaleFactor,isMobile,hasTouch}=testInfo.project.use;
  const context=await browser.newContext({viewport,userAgent,deviceScaleFactor,isMobile,hasTouch});const page=await context.newPage();
  await page.goto(origin+'/');await expect(page.locator('#state')).toHaveText('ready');
  runs[mode]=await page.evaluate(([m,r])=>(window as unknown as {exactBench:(m:string,r:unknown)=>Promise<unknown>}).exactBench(m,r),[mode,requests] as const);
  await context.close();
 }
 const result={project:testInfo.project.name,date:new Date().toISOString(),runs};
 console.log(JSON.stringify(result,null,1));
 await testInfo.attach('exact-kernel-bench.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 await writeFile(`experiments/exact-kernel/results/browser-bench-${testInfo.project.name}.json`,JSON.stringify(result,null,2)+'\n');
 for(const mode of ['worker','main'])for(const step of (runs[mode] as {steps:{label:string;error?:string}[]}).steps)expect(step.error,`${mode}: ${step.label}`).toBeUndefined();
});

test('exact features in the editor: latency and main-thread blocking with the exact worker',async({page},testInfo)=>{
 test.setTimeout(1_200_000);
 const session=createCadSession();
 session.add({kind:'box',size:[20,30,10]},{name:'Block',transform:{position:[0,0,5],rotation:[0,0,0],scale:[1,1,1]}});
 const {serializeDocument}=await import('@brickwright/cad-core');
 await page.addInitScript(([key,document])=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(key,document);sessionStorage.setItem('seeded','1');}},['brickwright-cad:standalone:v1',serializeDocument(session.state.document)] as const);
 await page.goto('/');
 const root=page.locator('#cad-root');await expect(root).toHaveAttribute('data-state','ready',{timeout:300_000});
 await page.getByRole('button',{name:'Terminal',exact:true}).click();
 const terminal=page.getByRole('region',{name:'CAD terminal',exact:true}),input=terminal.getByRole('combobox',{name:'CAD command'}),entries=terminal.locator('.terminal-entry');
 const steps=[];
 for(const [label,command] of [['first use: fillet r2, all edges (load + run)','fillet 2 Block'],['undo','undo'],['chamfer 2, top face','chamfer 2 Block --face +z'],['undo','undo'],['shell 2, open top','shell 2 Block --open +z'],['undo','undo'],['fillet r2, all edges (warm)','fillet 2 Block']]){
  const before=await entries.count();
  // The same 0 ms timer probe as the bench page, installed in the editor's page.
  await page.evaluate(()=>{const w=window as unknown as {probe:{last:number;maxGap:number;blocked:number;running:boolean}};w.probe={last:performance.now(),maxGap:0,blocked:0,running:true};const tick=()=>{const p=w.probe,now=performance.now(),gap=now-p.last;p.last=now;if(gap>p.maxGap)p.maxGap=gap;if(gap>50)p.blocked+=gap-50;if(p.running)setTimeout(tick,0);};setTimeout(tick,0);});
  const started=Date.now();
  if(command==='undo'){
   // Undo the feature: its source body is a top-level object again.
   await page.getByRole('button',{name:'Undo',exact:true}).click();
   await expect(page.getByTestId('object-name').filter({hasText:/^Block$/})).toBeVisible({timeout:300_000});
  }else{
   await input.fill(command);await input.press('Enter');
   // The transcript echoes the command first; the exact result line ends with the kernel timing.
   await expect.poll(async()=>(await entries.count())>before&&/WASM memory|rror/.test((await entries.last().textContent())??''),{timeout:300_000}).toBe(true);
  }
  await expect(root).toHaveAttribute('data-state','ready',{timeout:300_000});
  const wallMs=Date.now()-started;
  const main=await page.evaluate(()=>{const p=(window as unknown as {probe:{maxGap:number;blocked:number;running:boolean}}).probe;p.running=false;return {maxGapMs:Math.round(p.maxGap),blockedMs:Math.round(p.blocked)};});
  const text=(await entries.last().textContent())??'';
  const timing=/load (\d+) ms · run (\d+) ms · WASM memory (\d+) MiB/.exec(text);
  steps.push({label,wallMs,...(timing?{loadMs:+timing[1],runMs:+timing[2],wasmMiB:+timing[3]}:{}),main});
 }
 const result={project:testInfo.project.name,date:new Date().toISOString(),userAgent:await page.evaluate(()=>navigator.userAgent),steps};
 console.log(JSON.stringify(result,null,1));
 await writeFile(`experiments/exact-kernel/results/browser-editor-${testInfo.project.name}.json`,JSON.stringify(result,null,2)+'\n');
});

// Heavy exact jobs through the editor (the exact-check debug page on the plain preview server, so,
// as in the product, the page is not cross-origin isolated and smlibwasm has no probe worker):
// what the default tablet limits refuse, and what the same jobs cost without limits or under a low
// memory ceiling. Writes experiments/exact-kernel/results/browser-guards-<project>.json.
test('heavy exact jobs in the editor: refusal, time, memory and the worker afterwards',async({page},testInfo)=>{
 test.setTimeout(3_600_000);
 const cases=[
  {label:'200-hole rim fillet, tablet limits',query:'holes=200',command:'fillet 0.5 Plate --face +z'},
  {label:'200-hole shell, tablet limits',query:'holes=200',command:'shell 0.5 Plate --open +z'},
  {label:'25-hole rim fillet, tablet limits',query:'holes=25',command:'fillet 0.5 Plate --face +z'},
  {label:'100-hole shell, tablet limits',query:'holes=100',command:'shell 0.5 Plate --open +z'},
  {label:'200-hole rim fillet, no limits',query:'holes=200&exact-limits=none&timeout-s=600',command:'fillet 0.5 Plate --face +z'},
  {label:'200-hole shell, no limits',query:'holes=200&exact-limits=none&timeout-s=600',command:'shell 0.5 Plate --open +z'},
  {label:'200-hole rim chamfer, 80 MiB memory ceiling',query:'holes=200&exact-limits=none&memory-mib=80&timeout-s=600',command:'chamfer 0.5 Plate --face +z'},
 ];
 const steps=[];
 for(const {label,query,command} of cases){
  await page.goto(`/exact-check.html?${query}`);
  const root=page.locator('#exact-check-editor');await expect(root).toHaveAttribute('data-state',/^(ready|error)$/,{timeout:300_000});
  const terminal=page.getByRole('region',{name:'CAD terminal',exact:true}),input=terminal.getByRole('combobox',{name:'CAD command'}),entries=terminal.locator('.terminal-entry');
  const idleWorkers=page.workers().length;
  await page.evaluate(()=>{const w=window as unknown as {probe:{last:number;maxGap:number;running:boolean}};w.probe={last:performance.now(),maxGap:0,running:true};const tick=()=>{const p=w.probe,now=performance.now(),gap=now-p.last;p.last=now;if(gap>p.maxGap)p.maxGap=gap;if(p.running)setTimeout(tick,0);};setTimeout(tick,0);});
  const started=Date.now();
  await input.fill(command);await input.press('Enter');
  await expect.poll(async()=>/WASM memory|rror|too much|Shelling a body|out of memory|did not finish|failed/.test((await entries.last().textContent())??''),{timeout:900_000}).toBe(true);
  const wallMs=Date.now()-started;
  const maxGapMs=await page.evaluate(()=>{const p=(window as unknown as {probe:{maxGap:number;running:boolean}}).probe;p.running=false;return Math.round(p.maxGap);});
  const text=((await entries.last().textContent())??'').replace(/\s+/g,' ').trim();
  const timing=/load (\d+) ms · run (\d+) ms · WASM memory (\d+) MiB/.exec(text);
  await page.waitForTimeout(500);
  const outcome=timing?'built':/too much|Shelling a body/.test(text)?'refused':/out of memory/.test(text)?'out of memory':/did not finish/.test(text)?'timed out':'failed';
  steps.push({label,query,command,outcome,wallMs,...(timing?{loadMs:+timing[1],runMs:+timing[2],wasmMiB:+timing[3]}:{}),maxMainThreadGapMs:maxGapMs,exactWorkerAlive:page.workers().length>idleWorkers,message:text.slice(0,400)});
  console.log(JSON.stringify(steps.at(-1)));
  // Written after every case, so a run that stops early keeps what it measured.
  const result={project:testInfo.project.name,date:new Date().toISOString(),userAgent:await page.evaluate(()=>navigator.userAgent),note:'shared, loaded Apple M1; Chromium (the ipad project emulates the iPad viewport and user agent only)',steps};
  await writeFile(`experiments/exact-kernel/results/browser-guards-${testInfo.project.name}.json`,JSON.stringify(result,null,2)+'\n');
 }
 expect(steps.filter(s=>s.label.includes('tablet limits')&&s.label.startsWith('200')).map(s=>s.outcome)).toEqual(['refused','refused']);
});
